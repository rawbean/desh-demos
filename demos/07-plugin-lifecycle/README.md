# Demo 07：Plugin Lifecycle

本 Demo 使用 `@deepseek-ai/dsh-sdk-client@0.1.2-alpha.2` 和
`@deepseek-ai/cordis@4.0.2`，验证本地 Cordis 插件的注册、依赖注入、启动、
清理/卸载，以及切换插件时重建 DSH Runtime。

## 验证方式

`probe-consumer` 先用 `ctx.plugin()` 注册并声明
`inject = ["lifecycleProbe"]`，它会等待 `probe-provider` 通过 `ctx.provide()`
提供服务后才启动。停止时依次调用两个真实 `Fiber.dispose()`，journal 应为：

```text
provider-start → consumer-start → consumer-stop → provider-stop
```

SDK 当前只支持启动参数 `profile` 和 `patches`，不提供向子进程远程调用
`ctx.plugin()` 的 API。本 Demo 因此提供两条真实证据链，而非伪造控制面状态：

- Cordis 单元测试直接断言 registry、Fiber `ACTIVE`、注入服务和卸载事件。
- `observer.patch.yml` / `enforcer.patch.yml` 真实修改 Runtime system prompt；
  确定性 OpenAI-compatible Mock 检查 Runtime 发出的 marker，以及本地注入服务
  生成并实际送入 Runtime 的 `LOCAL_CORDIS_PROBE`。

切换运行中的插件会关闭旧 `DeepSeekHarness`、卸载旧 Fiber，再使用新 patch 和
新 Context 创建 Runtime；`generation` 增加。活动 run 期间切换返回 409。

## 核心代码

`PluginHost` 先注册依赖方再注册 Provider，并等待两个 Fiber 激活；其职责是验证
Cordis 的依赖注入与插件生命周期，而不是在控制面伪造状态：

```ts
const consumer = ctx.plugin(probeConsumer, config);
const provider = ctx.plugin(probeProvider, config);
await Promise.all([provider.await(), consumer.await()]);
```

## API

- `GET /plugins`：查询可选插件。
- `GET /plugin`：查询当前插件、generation、Cordis 状态和 lifecycle journal。
- `PUT /plugin`：提交 `{ "id": "observer" | "enforcer" }`。
- `POST /runtime/start`、`POST /runtime/stop`：启动和完整清理。
- `POST /runs`：提交 `{ "prompt": "..." }` 执行真实 SDK 子进程链路。
- `GET /health`：健康检查。

## 使用

要求 Node.js 24、pnpm 11；smoke 还要求 Docker。

```sh
make configure # 首次创建本地 .env，不覆盖已有配置
make install # 按锁文件安装依赖
make verify # 运行完整质量门禁
make image # 构建生产容器镜像
make up # 以后台受限容器启动服务（http://127.0.0.1:3007）
make plugins # 查询可选插件
make current # 查询当前插件与 Runtime 代际
make select PLUGIN=enforcer # 切换插件并按需重建 Runtime
make runtime-stop # 停止 Runtime 并清理插件
make smoke # 运行无需真实 API Key 的确定性容器全链路验证
make down # 停止容器并清理网络
```

真实模型运行需在 `.env` 设置 `DEEPSEEK_API_KEY`；兼容服务可设置
`DEEPSEEK_BASE_URL`、`DSH_PROVIDER`、`DSH_MODEL`。不要提交 `.env`。

## 工程与容器

`src/plugins/` 保存 provider、consumer 和服务契约，`patches/` 保存真实 Runtime
patch。`config/plugins.json` 是服务启动时实际读取并校验的插件清单（patch
路径必须位于 `patches/` 内）；`tests/` 覆盖 Cordis、失败清理、Runtime 重建、
查询/切换 API 和真实 SDK + Mock 集成链路。

镜像多阶段构建并以非 root 用户运行。Makefile 使用只读根文件系统，drop 全部
capabilities，启用 `no-new-privileges`，限制 CPU、内存和 PID，仅为 `/tmp`、
`/workspace` 分配 `noexec,nosuid` tmpfs，并使用独立网络。

## 限制

- 本地 Context 与 DSH 子进程是两个真实但独立的 Cordis 容器；Runtime 插件配置
  只能通过 startup patch 注入。
- 切换会丢弃旧 Runtime 的进程内状态，generation 变化代表新实例边界。
- Mock 验证配置和探针已到达模型请求，但不替代真实 DeepSeek 模型测试。
- patch 依赖当前 `sdk` profile 的 `system-prompt` entry id；升级后应检查
  dump-config。
