# 03 Event Stream

通过 `@deepseek-ai/dsh-sdk-client` 提交 Prompt，并把 dsh Runtime 的 Agent、模型、工具及通用通知实时转换为控制面 SSE 事件。

```text
POST /tasks → SDK run(onNotification) → Runtime
                    │
                    └→ 分类、有限回放、SSE → 控制面客户端
```

当前锁定 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-sdk-client` 的 `0.1.2-alpha.2`，两者必须保持同版本。

## 设计

- `RuntimeManager`：复用一个 SDK 所有的 Runtime 子进程，串联启动/停止并阻止在任务执行中普通停止。
- `TaskStreamService`：为每个任务预生成 Session ID，异步执行 Prompt，保存有限事件历史并管理订阅者。
- `classifyNotification`：根据真实 SDK 线协议，将 `session.event` 内的事件类型归入 Agent、模型、工具或通用通知。
- Fastify API：校验 Prompt 长度，返回 `202` 任务句柄，并提供任务状态、Runtime 生命周期和 SSE 端点。
- SSE：发送递增 `id`，支持 `Last-Event-ID` 或 `after` 回放；连接断开、任务结束或服务关闭时清理订阅与心跳。

SDK 0.1.2-alpha.2 只直接发送 `session.event`、`session.status`、`subagent.started` 和 `subagent.finished`。模型和工具事件是 `session.event` 的内层类型，控制面据此分类：

- Agent：`turn/*`、`step/*`、`session.status`、`subagent.*`
- 模型：`request/*`、`assistant/*`
- 工具：`tool/call`、`tool/result`
- 通知：任务生命周期及其余 SDK 通知

## 代码文件清单

- `src/server.ts`：读取环境配置、创建应用并处理控制面退出信号。
- `src/app.ts`：组装 Fastify 路由，提供任务、Runtime 状态和 SSE 事件接口。
- `src/runtime-manager.ts`：持有 SDK Runtime，协调启动、任务执行、活动计数和安全停止。
- `src/task-stream.ts`：管理异步任务、有限事件历史、SSE 订阅、断点回放和完成状态。
- `src/event-types.ts`：解析 SDK 通知并分类为 Agent、模型、工具或通用事件。
- `src/mock-provider.ts`：提供测试专用 DeepSeek SSE 响应和确定性工具调用。
- `tests/app.test.ts`：验证 HTTP 参数、状态码和任务接口行为。
- `tests/runtime-manager.test.ts`：验证 Runtime 生命周期和活动任务保护。
- `tests/task-stream.test.ts`：验证任务执行、事件发布、回放和订阅清理。
- `tests/event-types.test.ts`：验证各类 SDK 事件的分类规则。
- `Makefile`：统一封装安装、质量检查、容器操作、任务调用、事件读取和冒烟测试。
- `Dockerfile`：构建独立、受限的控制面与 dsh Runtime 镜像。
- `.env.example`：声明 DeepSeek、Prompt、事件历史和 SSE 心跳配置。
- `package.json`：声明脚本及 SDK、Runtime、Fastify、测试和代码质量依赖。
- `pnpm-lock.yaml`：固定完整依赖版本和完整性。
- `pnpm-workspace.yaml`：声明依赖构建许可和预览版安装策略。
- `eslint.config.js`：定义 TypeScript 静态检查规则。
- `.prettierignore`：声明不参与格式检查的生成文件。
- `tsconfig.json`：启用严格 TypeScript 编译并输出生产代码。

## 核心代码

### 在提交 Prompt 时实时观察通知

```ts
return await harness.run(prompt, {
  sessionId,
  onNotification: (notification) => publish(notification),
});
```

`RuntimeManager.run()` 先保证 Runtime 已启动，再让 SDK 在等待 Agent 回到 `idle` 的同时逐条回调通知。显式 Session ID 让任务提交响应和后续 SSE 事件始终指向同一会话。

### 分类 SDK 事件

```ts
if (eventType?.startsWith("tool/")) {
  return { category: "tool", type: eventType };
}
if (eventType?.startsWith("assistant/") || eventType?.startsWith("request/")) {
  return { category: "model", type: eventType };
}
```

分类器不猜测不存在的 SDK 方法，而是读取 `session.event.params.event.type`，保留原始 `method` 与 `params` 供控制面完整展示。

### 回放并清理 SSE 连接

```ts
const subscription = tasks.subscribe(taskId, afterEventId, writeEvent);
request.raw.once("close", cleanup);
reply.raw.once("close", cleanup);
```

新连接先回放事件 ID 大于断点的有限历史，再接收实时事件。`cleanup` 是幂等的，会移除订阅并停止心跳，避免断连后继续占用内存。

## 配置

- `DEEPSEEK_API_KEY`：DeepSeek API Key，仅在容器运行时注入。
- `DEEPSEEK_BASE_URL`：DeepSeek API 或兼容代理地址。
- `DSH_PROVIDER`、`DSH_MODEL`：Runtime 使用的 Provider 与模型。
- `DSH_MAX_TOKENS`：单次模型输出上限。
- `DSH_INITIALIZE_TIMEOUT_MS`：Runtime 初始化超时。
- `DSH_MAX_PROMPT_LENGTH`：Prompt 最大字符数。
- `DSH_EVENT_HISTORY_LIMIT`：每个任务保留的最大事件数。
- `DSH_SSE_HEARTBEAT_MS`：SSE 心跳间隔。

`ENABLE_MOCK_PROVIDER=true` 只用于测试路径。容器冒烟测试会让内置兼容 Provider 先请求一次 `todo_write`，再返回 `event-stream-ok`，不需要真实 API Key，也不产生模型费用。

## 接口

- `GET /health`：控制面健康和 Runtime 摘要。
- `GET /runtime`：查询 Runtime 状态与活动任务数。
- `POST /runtime/start`：显式启动 Runtime。
- `POST /runtime/stop`：无活动任务时停止 Runtime。
- `POST /tasks`：提交 `{ "prompt": "..." }`，返回任务、Session 和事件地址。
- `GET /tasks/:taskId`：查询任务状态、最终回答和分类计数。
- `GET /tasks/:taskId/events`：SSE 事件流；支持 `Last-Event-ID` 和 `after`。

## Cases

### Case 1：实时观察完整 Turn

提交 Prompt 后连接任务的 SSE 地址，预期依次看到 Agent 状态、模型请求/输出、可选工具调用及任务完成通知。任务状态最终包含 `finalResponse` 和各类别计数。

### Case 2：断线回放与清理

客户端携带最后一个事件 ID 重连，只回放更大的事件。客户端主动断开时，服务端移除 listener 和 heartbeat；完成或失败事件会正常结束流。

### Case 3：拒绝无效操作

空 Prompt、超长 Prompt 和非法事件断点返回 `400`；未知任务返回 `404`；任务活跃时停止 Runtime 返回 `409`。

### Case 4：确定性容器冒烟

内置 Mock 通过真实 SDK、dsh Runtime、工具执行、HTTP 与 SSE 链路，验证四种事件分类及最终回答。临时容器和独立网络在结束后自动删除。

## 运行真实模型

```bash
make configure                                      # 创建本地环境配置（已存在时不覆盖）
make up                                             # 构建镜像并在独立网络后台启动容器
make health                                         # 检查控制面和 Runtime 摘要
make task PROMPT='用 todo_write 规划两步并总结'      # 提交一次真实模型任务
make events TASK_ID='<task-id>'                     # 实时读取并在完成后结束 SSE
make task-status TASK_ID='<task-id>'                # 查询任务最终回答与分类计数
make runtime-stop                                   # 无活动任务时停止 SDK Runtime
make down                                           # 删除 Demo 容器和独立网络
```

也可以前台运行：

```bash
make run  # 构建并以前台受限容器运行，退出后删除独立网络
```

## 自动验证

```bash
make install  # 按独立 lockfile 安装依赖
make format   # 使用 Prettier 格式化该 Demo
make lint     # 运行 ESLint 静态检查
make verify   # 执行格式检查、Lint、单测、类型检查和构建
make image    # 构建该 Demo 的独立镜像
make smoke    # 用容器内 Mock 验证 SDK、Runtime、工具、HTTP 与 SSE 并自动清理
```
