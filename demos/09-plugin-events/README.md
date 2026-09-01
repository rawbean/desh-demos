# Demo 09：Plugin Events

本 Demo 在真实 dsh Runtime 子进程中加载本地 Cordis 插件，监听并拦截 Agent、LLM、Tool 生命周期；HTTP 控制面同时接收 SDK `session.event` 等通知，统一分类并暴露两条证据链。

```text
POST /runs ── SDK ──> dsh Runtime ──> Agent / LLM / Tool
    │                         │                │
    │                         └─ 本地 Cordis 插件拦截并写 JSONL
    └─ onNotification 接收 session.event ─────┘
                         │
                         └─ GET /events 与 run 结果
```

锁定 `@deepseek-ai/dsh` 和 `@deepseek-ai/dsh-sdk-client` `0.1.2-alpha.2`，两者必须保持同版本。

## 真实 Hook

`patches/plugin-events.patch.yml` 用 patch `insert` 加载 `plugins/event-probe/index.js`。相对插件路径由当前 DSH 版本锚定到 patch 文件目录，不是控制面内模拟 Hook。

- Agent 监听：`agent/status`，记录 `idle`/`running` 状态。
- Agent 拦截：`agent/request` waterfall，把本次模型请求的 `maxTokens` 改为 `DSH_PLUGIN_MAX_TOKENS`（默认 321）。
- LLM 拦截：`llm/stream` waterfall 包装真实流，记录请求与完整消费的 chunk 数。
- Tool 拦截：`tools/post-execute` waterfall 在成功的 `todo_write` 后把模型可见结果替换成 `PLUGIN_TOOL_INTERCEPTED`。
- Tool 监听：`tools/result` 记录最终冻结结果。

插件只写结构化标量，不记录 Prompt、模型内容、工具参数或 API Key。事件文件位于 `/tmp`，权限为 `0600`，控制面按 `DSH_EVENT_LIMIT` 限制内存结果。

## 核心代码

Runtime 插件使用 waterfall hook 接受下游结果，并只对成功的 `todo_write`
替换模型可见内容；职责是展示 Tool 拦截而不绕过真实执行管线：

```js
ctx.on("tools/post-execute", async (exec, result, next) => {
  const decision = await next();
  if (exec.name !== "todo_write" || result.isError) return decision;
  return {
    kind: "accept",
    content: [{ type: "text", text: "PLUGIN_TOOL_INTERCEPTED" }],
  };
});
```

## 确定性 Mock

Mock 仍经过 SDK、Runtime、真实插件和真实 `todo_write`：

1. 首次模型请求固定返回一次 `todo_write` 调用。
2. Agent 拦截必须让 provider 收到 `max_tokens=321`。
3. Tool 拦截必须让第二次请求包含 `PLUGIN_TOOL_INTERCEPTED`。
4. Mock 仅在工具调用恰好一次且两项拦截均生效时返回 `plugin-events-ok`。
5. smoke 同时要求 Agent/LLM/Tool 插件事件、SDK `session.event` 和三类控制面计数均存在。

因此成功结果不能由 HTTP 控制面单独伪造。

## API

- `GET /health`：服务和 Runtime 状态。
- `GET /runtime`：Runtime、活动 run 与 patch 路径。
- `POST /runtime/start`、`POST /runtime/stop`：显式管理 Runtime；活动 run 时停止返回 `409`。
- `POST /runs`：提交 `{ "prompt": "..." }`，同步返回最终回答、分类计数、断言和事件。
- `GET /events`：读取最近一次 run 的合并事件。
- `GET /mock-state`：仅用于 Mock 验证 provider 实际观察到的拦截结果。

事件的 `source` 为 `runtime-plugin` 或 `sdk`，`category` 为 `agent`、`llm`、`tool`、`notification`。SDK 的 `session.event.params.event.type` 会展开后分类，原始 `method` 和 `params` 保留在 `data`。

## 目录

- `src/app.ts`：API、run 编排和可验证断言。
- `src/runtime-manager.ts`：带 patch 启动真实 SDK Runtime。
- `src/event-store.ts`：读取插件 JSONL、归类 SDK 通知并合并事件。
- `src/mock-provider.ts`：强制一次工具调用的 OpenAI-compatible SSE Mock。
- `plugins/event-probe/`：Runtime 内真实 Cordis 插件。
- `patches/`：向 `sdk` profile 插入插件的 overlay。
- `tests/`：控制面和分类单元测试。
- `Dockerfile`、`Makefile`：安全容器、验证和全链路 smoke。

## 使用

```sh
make configure # 首次创建本地 .env，不覆盖已有配置
make install # 按锁文件安装依赖
make verify # 运行完整质量门禁
make image # 构建生产容器镜像
make up # 以后台受限容器启动服务
make health # 查询服务健康状态
make run-api PROMPT="使用 todo_write 完成一项任务" # 通过服务 API 发起一次运行
make events # 查询最近一次运行事件
make down # 停止容器并清理网络
```

真实模型需要在 `.env` 配置 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DSH_PROVIDER` 和 `DSH_MODEL`。`.env` 不进入镜像。
`DSH_MAX_PROMPT_LENGTH` 限制输入长度（默认 20000），`DSH_EVENT_LIMIT` 限制每次响应保留的合并事件数（默认 500）。

确定性全链路验证不需要真实 Key：

```sh
make smoke # 运行确定性容器全链路验证
```

## 容器边界

生产阶段以非 root 用户运行，根文件系统只读，drop 全部 capabilities，启用 `no-new-privileges`，限制 CPU、内存和 PID。仅 `/tmp` 与 `/workspace` 是 `noexec,nosuid` tmpfs。默认使用独立 `dsh-demo-09-net` 网络和宿主端口 3009，smoke 退出时删除容器与网络。

## 当前 alpha 的边界

- alpha.2 没有独立的 “LLM before/after” emit 事件；有证据的最近实现是官方类型声明明确标注为 waterfall 的 `llm/stream`。插件在调用 `next()` 前记录拦截，在迭代结束后记录完成，覆盖同一次真实流的前后时点。
- Tool 的可变更扩展点名为 `tools/post-execute`，最终只读通知名为 `tools/result`；本 Demo 分别用于拦截与监听。
- Agent 的模型配置拦截点是 `agent/request`；它不能修改模型消息。Demo 修改允许替换的 `LlmCallConfig.maxTokens`，Mock 在 provider 边界验证该变化。
- 插件与控制面属于不同进程。alpha.2 SDK 不提供自定义 Cordis 事件透传，所以使用同一容器内权限受限的 JSONL 作为最近的跨进程桥；SDK 原生通知仍独立通过 `onNotification` 收集。
- 为避免重置共享证据文件时产生竞争，控制面一次只允许一个 run；并发请求返回 `409`。
