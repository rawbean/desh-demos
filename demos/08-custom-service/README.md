# Demo 08：自定义 Cordis Service

本 Demo 基于 `@deepseek-ai/dsh-sdk-client@0.1.2-alpha.2` 与
`@deepseek-ai/cordis@4.0.2`，演示两个真正运行在 DSH Runtime 内的 Cordis
插件如何通过依赖注入协作：

- Provider 插件继承 `Service`，以 `super(ctx, "customGreeting")` 注册
  `customGreeting` 服务。Cordis 内部由 `ctx.reflect.provide()` 持有该实例，并在
  Provider fiber 卸载时自动撤销。
- Consumer 导出 `inject = ["customGreeting", "tools"]`。Cordis 只会在两个服务
  都可用时激活它，然后注册模型可调用的 `custom_service_greet` 工具。
- 工具调用注入的 `ctx.customGreeting.greet()`，再用
  `ctx.emit("custom-service/consumed", result)` 发出 Runtime 内事件。Consumer
  的监听器同步确认事件，并把 `eventObserved` 连同 Provider 实例标识和调用序号
  放进工具结果。

这不是 HTTP 控制面的注入模拟。`config/custom-service.json` 保存服务配置，
`patches/custom-service.patch.yml` 在 SDK 启动前被解析为仅含绝对 `file:` URL
的私有运行时 patch，DSH 子进程直接加载 `dist/plugins/provider.js` 与
`dist/plugins/consumer.js`。

## 核心代码

Consumer 声明依赖后注册工具；执行函数从 Cordis context 取得 Provider 服务，
并同步发出事件以验证消费链路：

```ts
export const inject = ["customGreeting", "tools"];

const result = ctx.customGreeting.greet(args.name);
ctx.emit("custom-service/consumed", result);
return { ...result, eventObserved: latestEvent === result };
```

## 全链路

`POST /runs` 经过以下链路：

1. SDK 启动真实 DSH/Cordis Runtime 并应用本地 patch。
2. 确定性 OpenAI-compatible Mock 只有在模型请求中看到
   `custom_service_greet` schema 后，才发出该工具调用。
3. DSH 的 Agent loop 调用 Consumer 工具；Consumer 从 Cordis context 取得
   Provider 服务实例并触发 Cordis event。
4. Mock 在下一次模型请求的 `tool` message 中检查问候语、Provider 实例标识、
   调用序号与 `event=true`，然后返回
   `sdk-observed: injected-service=true; event=true`。
5. HTTP 响应同时给出 SDK `finalResponse`、事件数量/类型、通知数量和 Mock
   观测值。

集成测试和容器 smoke 因此都会在工具 schema 缺失、Consumer 未被注入、服务未
执行、事件未被监听或工具结果未回到模型时失败。

## API

- `GET /health`：服务和 Runtime 状态。
- `GET /runtime`：Runtime 状态与解析后 patch 路径。
- `POST /runtime/start`、`POST /runtime/stop`：显式管理 Runtime。
- `POST /runs`：提交 `{ "prompt": "...", "sessionId": "可选" }`，运行 SDK
  全链路。

默认监听 `3008`。

## 使用

```sh
make configure # 首次创建本地 .env，不覆盖已有配置
make install # 按锁文件安装依赖
make verify # 运行完整质量门禁
make image # 构建生产容器镜像
make run # 以前台受限容器运行服务
```

另一个终端可执行：

```sh
make runtime # 查询 Runtime 状态
make run-api PROMPT="Call custom_service_greet exactly once for SDK." # 通过服务 API 发起一次运行
```

确定性本地/CI 验证：

```sh
make smoke # 运行确定性容器全链路验证
```

`make verify` 依次执行 Prettier 检查、ESLint、测试、严格 TypeScript 检查和构建。
测试命令会先构建插件，因为独立 DSH 子进程加载的是编译后的 JavaScript。

## 配置

先复制 `.env.example` 为 `.env`。真实模型运行至少需要
`DEEPSEEK_API_KEY`；smoke 会覆盖为本地 Mock，不访问外部模型。

| 变量             | 默认值                  | 含义                          |
| ---------------- | ----------------------- | ----------------------------- |
| `PORT`           | `3008`                  | HTTP 端口                     |
| `DSH_PROVIDER`   | `deepseek-official`     | DSH provider                  |
| `DSH_MODEL`      | `deepseek-v4-flash`     | 模型                          |
| `DSH_HOME`       | `/tmp/dsh-demo-08-home` | Runtime 状态及解析 patch 目录 |
| `DSH_WORKSPACE`  | 当前目录                | SDK session 工作区            |
| `DSH_MAX_TOKENS` | `512`                   | 最大输出 token                |

不要提交包含真实密钥的 `.env`。

## 容器边界

镜像以 `demo` 非 root 用户运行。Makefile 以只读根文件系统启动容器，drop 全部
capabilities，启用 `no-new-privileges`，限制 CPU、内存和 PID，仅给 `/tmp` 与
`/workspace` 提供 `noexec,nosuid` tmpfs，并使用独立网络。smoke 还会通过
`docker inspect` 断言这些关键限制没有被移除。

## 限制

- 确定性 Mock 验证真实 SDK、DSH、Cordis、工具和事件链路，但不替代真实
  DeepSeek 凭据、网络和模型行为测试。
- 本 Demo 固定到 DSH `0.1.2-alpha.2` 与 Cordis `4.0.2` 的插件/API 契约；升级
  后应重新检查 `Service`、命名 `inject` 导出和 `defineTool` schema。
- 本地插件必须先编译。运行时 patch 之所以在 `DSH_HOME` 生成，是为了让宿主和
  只读容器都能用各自正确的绝对模块 URL；模板本身不包含机器路径。
