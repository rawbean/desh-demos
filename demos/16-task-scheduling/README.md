# 16 Task Scheduling

基于 Demo 03 的异步提交模式，在 `@deepseek-ai/dsh-sdk-client` Runtime 前增加进程内 FIFO 调度器，提供并发限制、取消、超时、失败重试和状态查询。服务端口为 `3016`。

```text
POST /tasks → FIFO ready queue → concurrency slots → SDK run → dsh Runtime
                     ↑                  │
                     └──── retry ───────┘
```

当前锁定 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-sdk-client` 的 `0.1.2-alpha.2`。

## 语义边界

- FIFO 指“进入 ready 队列的顺序”：首次提交按接收顺序启动；失败重试等待 `retryDelayMs` 后进入队尾，不会越过已就绪任务。
- 并发限制统计尚未 settle 的真实 `SDK run`，而不是仅统计 API 状态。因此逻辑取消或超时不会提前释放槽位，底层调用结束后才会启动下一个任务，不会隐性超过并发上限。
- 队列是可靠的进程内队列：任务在进程存活期间不会因取消、超时或失败重试而重复结算；它不是持久化队列，进程或容器重启会丢失任务。需要跨重启保证时应接入数据库或消息队列。
- SDK `0.1.2-alpha.2` 没有 run 级 wire cancel。`queued` 任务可真正移出执行路径；`running` 默认仅逻辑取消，状态立即变为 `cancelled`，后续结果或错误被忽略。
- `DELETE /tasks/:id?forceRuntime=true` 是明确的可选强停：关闭共享 Runtime 子进程。它可能中断同一 Runtime 上所有运行任务，不是单任务取消；这些任务会按各自失败重试策略处理。仅在接受该影响范围时使用。
- 超时同样是逻辑超时：状态变为 `timed_out` 并忽略迟到结果，但槽位保留到底层调用 settle。超时不自动重试，避免一个仍在执行的调用与其重试副本并存。
- 仅普通执行失败会重试，最多执行 `maxAttempts` 次；每次错误保存在 `errors`，最终失败的 `error` 保留最后一次错误。

## 核心代码

调度器只在真实未结算调用数低于并发上限时从 FIFO ready 队列取任务；职责是保证
取消或超时不会提前释放 SDK 执行槽位：

```ts
private pump(): void {
  while (this.active < this.options.concurrency) {
    const id = this.ready.shift();
    if (!id) return;
    const task = this.tasks.get(id);
    if (!task || task.state !== "queued") continue;
    this.startAttempt(task);
  }
}
```

## 接口

- `GET /health`：服务、Runtime 与队列摘要。
- `GET /runtime`：Runtime 状态和真实活动调用数。
- `POST /runtime/start`：提前启动 Runtime。
- `POST /runtime/stop`：无活动调用时安全停止；`?force=true` 可强停共享 Runtime。
- `GET /tasks`：队列统计与全部任务状态。
- `POST /tasks`：提交任务，返回 `202` 和 `Location`。请求：

```json
{
  "prompt": "总结当前目录",
  "timeoutMs": 30000,
  "maxAttempts": 3,
  "retryDelayMs": 100
}
```

- `GET /tasks/:taskId`：查询任务、尝试次数、时间、结果和错误历史。
- `DELETE /tasks/:taskId`：取消 queued 或逻辑取消 running。
- `DELETE /tasks/:taskId?forceRuntime=true`：逻辑取消目标并强停共享 Runtime。

终态为 `completed`、`failed`、`cancelled` 或 `timed_out`。重复取消终态任务是幂等查询，不会改变结果。

## 配置

- `DSH_QUEUE_CONCURRENCY`：并发槽位，默认 `2`。
- `DSH_TASK_TIMEOUT_MS`：默认任务超时，默认 `30000`。
- `DSH_MAX_ATTEMPTS`：默认最大尝试次数，默认 `3`。
- `DSH_RETRY_DELAY_MS`：默认失败重试延迟，默认 `100`。
- `DSH_MAX_PROMPT_LENGTH`：Prompt 字符上限，默认 `20000`。
- `DSH_PROVIDER`、`DSH_MODEL`、`DSH_MAX_TOKENS`、`DSH_INITIALIZE_TIMEOUT_MS`：Runtime 配置。
- `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`：Provider 凭证和地址，仅在运行时注入。

## 运行

```bash
make configure # 首次创建本地 .env，不覆盖已有配置
make up # 以后台受限容器启动服务
make submit PROMPT='总结当前目录' # 提交异步任务
make status TASK_ID='<task-id>' # 查询指定任务状态
make cancel TASK_ID='<task-id>' # 取消指定任务
make down # 停止容器并清理网络
```

`make force-cancel TASK_ID=...` 演示共享 Runtime 强停。镜像使用非 root 用户、只读根文件系统、临时可写目录、移除 capabilities、`no-new-privileges`、资源限制和独立网络。

## 验证

```bash
make install # 按锁文件安装依赖
make verify # 运行完整质量门禁
make image # 构建生产容器镜像
make smoke # 运行确定性容器全链路验证
```

单测使用可控 `TaskRunner`，确定性验证 FIFO 启动顺序、并发上限、queued/running 取消差异、超时槽位、失败重试和最终错误。`make smoke` 在安全容器内运行真实 SDK 与 dsh Runtime，通过内置 Mock Provider 验证 HTTP 提交到最终状态的核心链路，并用 `trap` 自动删除容器和网络，不需要真实 API Key。

## 文件

- `src/task-scheduler.ts`：FIFO、并发槽位、取消、超时、重试和状态快照。
- `src/runtime-manager.ts`：复用 SDK Runtime，协调并发运行和安全/强制停止。
- `src/app.ts`、`src/server.ts`：Fastify API、配置和退出清理。
- `src/mock-provider.ts`：容器 smoke 使用的确定性 DeepSeek 兼容 SSE Provider。
- `tests/`：调度器、API 和 Runtime 生命周期测试。
- `Makefile`、`Dockerfile`：全门禁、独立镜像、安全运行和自动清理 smoke。
