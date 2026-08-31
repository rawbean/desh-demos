# 02 Task Execution

通过 `@deepseek-ai/dsh-sdk-client` 提交一次 Prompt，并返回 dsh Agent 完成整个 Turn 后的最终回答。

本 Demo 用于证明控制面能够完成最小任务闭环：

```text
HTTP 请求 → SDK run() → dsh Runtime → 模型 → Agent idle → 最终回答
```

它不验证事件实时推送和会话复用，这两项分别由 `03-event-stream` 和 `04-session-management` 覆盖。

当前锁定 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-sdk-client` 的 `0.1.2-alpha.2`，两者必须保持同版本。

## 配置

- `DEEPSEEK_API_KEY`：DeepSeek API Key。
- `DEEPSEEK_BASE_URL`：DeepSeek API 地址或兼容代理地址。
- `DSH_PROVIDER`：Provider ID。
- `DSH_MODEL`：模型 ID。
- `DSH_MAX_TOKENS`：单次模型输出上限。

## 代码文件清单

- `src/server.ts`：创建 Fastify 控制面，读取 dsh 配置，提供健康检查与任务提交接口，并在退出时关闭 Runtime。
- `src/task-executor.ts`：封装 `DeepSeekHarness`，校验 Prompt、调用 SDK `run()`，并整理最终回答和执行统计。
- `src/mock-provider.ts`：提供测试专用的 DeepSeek Chat Completions SSE 接口，用于无费用的确定性容器测试。
- `tests/task-executor.test.ts`：验证任务提交、空输入拦截和 Runtime 关闭行为。
- `Makefile`：统一封装安装、测试、构建、容器启停、任务调用和冒烟测试。
- `Dockerfile`：构建非 root、独立运行的控制面与 dsh Runtime 镜像。
- `.env.example`：声明 DeepSeek 地址、凭据、Provider、模型和 Token 上限。
- `package.json`：声明运行脚本及 SDK、Runtime、Fastify 等依赖。
- `pnpm-lock.yaml`：固定完整依赖版本和完整性。
- `pnpm-workspace.yaml`：声明依赖构建许可和预览版安装策略。
- `tsconfig.json`：启用严格 TypeScript 编译并输出生产代码。

## 核心代码

### 执行任务

```ts
const result = await this.harness.run(input)

return {
  sessionId: result.sessionId,
  finalResponse: result.finalResponse,
  eventCount: result.events.length,
  notificationCount: result.notifications.length,
}
```

`run()` 会按需启动 Runtime、提交 Prompt，并等待整个 Agent 进入 `idle`。`finalResponse` 是该执行区间最后一条已提交的 Assistant 文本，`sessionId` 可用于定位本次任务产生的会话。

### 暴露控制面接口

```ts
app.post('/tasks', async (request, reply) => {
  return await executor.execute(request.body.prompt)
})
```

控制面负责校验输入并将 SDK 结果转换为稳定的 HTTP 响应。空 Prompt 返回 `400`，Runtime 或模型错误返回 `502`。

### 确保 Runtime 被回收

```ts
app.addHook('onClose', async () => {
  await executor.close()
})
```

控制面退出时调用 SDK `close()`，避免遗留 dsh 子进程。

## Cases

### Case 1：成功执行

提交有效 Prompt，预期返回非空 `sessionId`、模型最终回答、事件数量、通知数量和执行耗时。这证明控制面已打通 SDK 到 dsh Runtime 的完整任务链路。

### Case 2：拒绝无效输入

提交空 Prompt，预期在调用 SDK 前返回 `400`。这证明控制面不会为无效请求启动模型任务。

### Case 3：确定性容器冒烟测试

`make smoke` 会在同一容器内启用测试专用 DeepSeek Mock，通过 `DEEPSEEK_BASE_URL` 接入 dsh，要求最终回答严格为 `task-ok`。该 Case 验证真实 SDK、Runtime、HTTP 和 SSE 链路，不调用外部模型，也不产生费用。

Mock 只有设置 `ENABLE_MOCK_PROVIDER=true` 时才启用，正常运行默认关闭。

## 运行真实模型

```bash
make configure                         # 创建本地环境配置（已存在时不覆盖）
make up                                # 构建镜像并在后台启动独立容器
make health                            # 检查控制面是否可用
make task PROMPT='用一句话介绍 dsh'     # 提交一次真实模型任务
make down                              # 停止并删除 Demo 容器
```

## 自动验证

```bash
make install  # 按 lockfile 安装依赖
make verify   # 执行单元测试、类型检查和构建
make smoke    # 使用容器内 Mock 验证完整任务链路并自动删除容器
```

## 接口

- `GET /health`：控制面健康检查。
- `POST /tasks`：提交 `{ "prompt": "..." }` 并等待最终结果。

