# Demo 11：Custom Model Adapter

本 Demo 在真实 dsh Runtime 子进程中加载 Cordis 插件。插件继承
`@deepseek-ai/dsh-llm` 的 `LlmAdapter`，注册独立 provider route，并由 SDK
初始化参数选择该 route 完成确定性流式回答。

```text
POST /runs
  └─ DeepSeekHarness SDK
       └─ initialize(provider=demo-custom-adapter, model=deterministic-v1)
            └─ dsh Runtime
                 └─ Cordis plugin
                      └─ LlmRuntime route registry
                           └─ DeterministicAdapter.stream()
                                └─ custom-adapter-ok
```

smoke 不注册 Fastify provider Mock，也不请求 OpenAI-compatible HTTP
端点。成功必须同时出现 SDK 通知以及 Runtime 插件写出的
`registered`、`stream-start`、`chunk`、`stream-complete` 事件。

## 实际类型契约

工程固定使用 `@deepseek-ai/dsh-llm@0.1.2-alpha.2`。该发布版的声明显示：

- `LlmAdapter` 是抽象类，唯一必需方法是
  `stream(options: GenerateOptions): AsyncIterable<StreamChunk>`。
- Runtime 注册入口是
  `ctx.llm.registerAdapter(providers: string[], adapter: LlmAdapter)`。
- `GenerateOptions.provider` 选择已注册 adapter；SDK initialize 的
  `provider`、`model` 会进入该路径。
- stream 必须输出 provider-neutral chunk；本实现依次输出
  `block-start`、三个 `text-delta`、`block-end`、`usage`、`finish`。
- adapter 必须响应 `AbortSignal`。本实现会输出 `aborted` terminal
  finish，不执行外部 I/O。

插件还实现 `providerInfo`、`listModels`、`resolveModel`，暴露 provider
显示信息、文本能力、context window 和默认 token 上限。

## 核心代码

Adapter 的职责是把 provider 调用转换为 DSH 的中立流式 chunk；插件随后把它
注册到固定 provider route：

```js
async *stream(options) {
  yield { type: "block-start", index: 0, blockType: "text" };
  for (const text of ["custom-", "adapter-", "ok"]) {
    yield { type: "text-delta", index: 0, text };
  }
  yield { type: "finish", reason: { kind: "stop" } };
}

ctx.llm.registerAdapter([PROVIDER], adapter);
```

## 确定性证据

`patches/custom-model-adapter.patch.yml` 将
`plugins/custom-model-adapter/index.js` 插入 `sdk` profile。插件仅记录
provider、model、消息数量、chunk 序号等结构化元数据，不记录 prompt、
消息内容、环境变量或凭据。事件文件权限为 `0600`，HTTP 响应受
`DSH_EVENT_LIMIT` 限制。SDK 通知也只保留 method、session id、状态、
事件类型与序号，不返回通知中的 prompt、system prompt 或工具定义。

固定 route 与结果：

- provider：`demo-custom-adapter`
- model：`deterministic-v1`
- 回答：`custom-adapter-ok`

## API

- `GET /health`：服务健康与 Runtime 状态。
- `GET /runtime`：状态、活动 run、启动时间、provider/model/patch。
- `POST /runtime/start`、`POST /runtime/stop`：Runtime 生命周期。
- `POST /runs`：提交 `{ "prompt": "..." }`，返回最终回答、断言与事件。
- `GET /events`：最近的 SDK 与 Runtime adapter 事件。

为避免重置共享事件文件时产生竞争，一次只允许一个 run；冲突返回
`409`。prompt 默认最多 20000 字符。

## 使用

要求 Node.js 24、pnpm 11；运行 smoke 还要求 Docker。

```sh
make configure # 首次创建本地 .env，不覆盖已有配置
make install # 按锁文件安装依赖
make verify # 运行完整质量门禁
make smoke # 运行确定性容器全链路验证
```

启动常驻容器：

```sh
make up # 以后台受限容器启动服务
make health # 查询服务健康状态
make run-api PROMPT="任意输入" # 通过服务 API 发起一次运行
make events # 查询最近一次运行事件
make down # 停止容器并清理网络
```

默认宿主与容器端口均为 `3011`。本 Demo 不需要模型 API Key。

## 目录

- `plugins/custom-model-adapter/`：真实 Runtime Cordis 插件和 adapter。
- `patches/`：向 `sdk` profile 注入插件的 patch。
- `src/runtime-manager.ts`：以固定 provider/model 启动 SDK Runtime。
- `src/app.ts`：API、run 编排和全链路断言。
- `src/event-store.ts`：合并 SDK 通知与 Runtime 插件证据。
- `tests/`：adapter 契约及控制面测试。
- `Dockerfile`、`Makefile`：安全镜像、验证与真实全链路 smoke。

## 容器安全

运行阶段使用非 root 用户、只读根文件系统、drop 全部 capabilities、
`no-new-privileges`、CPU/内存/PID 限制。仅 `/tmp` 与 `/workspace` 是
`noexec,nosuid` tmpfs。镜像不复制 `.env`、源码测试或开发依赖。

## alpha.2 限制

- provider route 注册是进程内 API；SDK 没有直接查询自定义 adapter
  实例的接口，因此使用 SDK 通知和插件 `0600` JSONL 构成两条证据链。
- `listModels` 是 advisory，模型不在列表中不会自动阻止 dispatch；
  本 Demo 仍固定 initialize 的 model，adapter 的 `resolveModel` 保留精确 id。
- adapter 抛错会被 `LlmRuntime` 归一化为 terminal failure chunk，而不是
  直接从 stream 抛给 SDK 调用方。
- `llm/stream` 是 waterfall 扩展点，不是独立 before/after 事件。
- alpha 子进程依赖包含原生模块，pnpm 需明确允许其安装脚本；工程只允许
  锁文件中 Runtime 所需的六个包执行 build。
