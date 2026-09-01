# 05 Model Provider

演示控制面查询、选择 Provider/Model 路由，并在切换时安全关闭旧 Harness、用新配置创建并启动新 Harness。

## 设计

- `ModelCatalog` 是应用拥有的路由白名单。生产模式从环境读取一个 DeepSeek 路由；Mock 模式提供 `mock-primary/mock-blue` 与 `mock-secondary/mock-green` 两条确定性路由。
- 两条 Mock 路由都映射到 SDK 已安装的 `deepseek-official` 适配器，但保留独立的控制面 Provider 标识，并使用不同模型名驱动不同响应。
- `RuntimeManager` 串行化启动、运行登记、切换和关闭。Prompt 活跃时切换返回 `409`，不会关闭正在工作的子进程。
- 成功切换会依次关闭旧 Harness、保存新路由、创建并启动新 Harness；`generation` 递增可观察地证明进程代际变化。
- Fastify 提供配置查询、切换和同步 Prompt API。输入仅接受白名单内完整的 Provider/Model 组合。

## SDK 0.1.2-alpha.2 限制

已实际检查 `@deepseek-ai/dsh-sdk-client` 的发布类型：`DeepSeekHarnessOptions` 在构造时接收可选 `provider` 与 `model`，`DeepSeekHarness` 仅公开 `start()`、`run()`、`session()`、`close()` 和底层 `client`。该 alpha 版本没有 Provider/Model 枚举或在线修改 API，也没有 wire-level cancel。因此：

1. 可选路由必须由应用配置维护，而不是从 SDK 查询。
2. Provider/Model 不能在现有 Harness 上原地修改，必须 `close()` 后重建。
3. 活跃 Prompt 期间拒绝切换，避免通过关闭 Runtime 模拟取消。

## 核心代码

安全切换先检查活动请求，再关闭并替换 SDK 所拥有的 Runtime：

```ts
if (this.activeRuns > 0) throw new RuntimeBusyError();
this.state = "switching";
const previous = this.harness;
this.harness = undefined;
if (previous) await previous.close();
this.route = { ...route };
await this.startUnlocked();
```

SDK 构造参数使用路由解析后的适配器与模型：

```ts
const harness = this.factory({
  ...this.baseOptions,
  provider: this.route.sdkProvider,
  model: this.route.model,
});
```

## 接口

- `GET /health`：服务健康状态及当前 Runtime 状态。
- `GET /config`：当前路由、Runtime 代际、活动请求及可选路由。
- `PUT /config`：以 `{ provider, model }` 切换白名单路由。
- `POST /prompts`：以 `{ prompt }` 同步运行一次 SDK Prompt，并返回回答与对应 Runtime 状态。

## 文件

- `src/model-config.ts`：路由类型、白名单和 SDK 基础配置。
- `src/runtime-manager.ts`：Harness 生命周期、互斥切换与活动请求保护。
- `src/mock-provider.ts`：按模型名返回不同结果的 OpenAI 兼容 SSE Mock。
- `src/app.ts`、`src/server.ts`：HTTP API、配置组装和信号关闭。
- `tests/`：验证 API、重建顺序、代际变化、输入校验和忙碌保护。
- `Dockerfile`、`Makefile`：非 root 受限镜像、独立网络和确定性容器 smoke。

## 本地与容器

```bash
make configure                                      # 首次创建本地环境文件，不覆盖已有配置
make install                                        # 按独立 lockfile 安装依赖
make format                                         # 格式化该 Demo
make lint                                           # 运行 ESLint
make test                                           # 运行单元与 API 测试
make typecheck                                      # 执行严格类型检查
make build                                          # 编译生产 JavaScript
make verify                                         # 执行格式、Lint、测试、类型和构建全套检查
make image                                          # 构建独立容器镜像
make run                                            # 在独立网络以前台受限容器运行
make up                                             # 在独立网络以后台受限容器运行
make health                                         # 查询服务与 Runtime 健康状态
make config                                         # 查询当前及可选 Provider/Model 路由
make prompt PROMPT='简短回答'                       # 使用当前路由发送 Prompt
make switch PROVIDER=deepseek-official MODEL=deepseek-v4-flash # 安全切换白名单路由
make down                                           # 删除 Demo 容器与独立网络
make smoke                                          # 用两条 Mock 路由验证回答、状态及 Harness 代际变化
```

默认监听 `3005`。容器使用非 root 用户、只读根文件系统、无 Linux capabilities、`no-new-privileges`、独立网络、临时可写目录以及 CPU、内存、PID 限制。Mock smoke 不需要真实 API Key，也不会产生模型费用。
