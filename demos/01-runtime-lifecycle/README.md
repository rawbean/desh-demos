# 01 Runtime Lifecycle

通过 `@deepseek-ai/dsh-sdk-client` 管理 dsh Runtime 子进程，验证：

- 启动与初始化握手
- 重复启动保持幂等，不创建额外 Runtime
- 正常关闭并回收子进程
- 关闭后创建新的 Runtime
- 初始化失败后的状态和清理

本 Demo 不发送 Prompt，不验证模型回答。

当前锁定 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-sdk-client` 的 `0.1.2-alpha.2`，两者必须保持同版本。
由于该预览版刚发布，项目将 pnpm 的 `minimumReleaseAge` 设为 `0`；实际版本和完整性仍由 lockfile 固定。

## 配置

- `DEEPSEEK_API_KEY`：DeepSeek API Key。
- `DEEPSEEK_BASE_URL`：DeepSeek API 地址，默认 `https://api.deepseek.com`，可替换为兼容代理地址。
- `DSH_PROVIDER`：Provider ID。
- `DSH_MODEL`：模型 ID。

以上变量通过 Docker 注入控制面，并由 SDK 启动的 dsh Runtime 子进程继承。

## 代码文件清单

- `src/server.ts`：创建 Fastify 控制面，读取 dsh 配置，暴露 Runtime 生命周期接口，并处理进程退出信号。
- `src/runtime-manager.ts`：封装 `DeepSeekHarness` 的启动、复用、停止、失败清理和状态转换。
- `tests/runtime-manager.test.ts`：验证启动幂等、停止幂等、重新启动、多 Manager 并存和初始化失败清理。
- `Makefile`：统一封装安装、测试、构建、容器启停、Runtime 操作和冒烟测试。
- `Dockerfile`：构建非 root、只读文件系统兼容的控制面与 dsh Runtime 镜像。
- `.env.example`：声明 DeepSeek 地址、凭据、Provider、模型和初始化超时。
- `package.json`：声明运行脚本及 SDK、Runtime、Fastify 等依赖。
- `pnpm-lock.yaml`：固定完整依赖版本和完整性。
- `pnpm-workspace.yaml`：声明依赖构建许可和预览版安装策略。
- `tsconfig.json`：启用严格 TypeScript 编译并输出生产代码。

## 核心代码

### 创建 Runtime

```ts
const runtime = new RuntimeManager({
  profile: process.env.DSH_PROFILE ?? 'sdk',
  provider: process.env.DSH_PROVIDER ?? 'deepseek-official',
  model: process.env.DSH_MODEL ?? 'deepseek-v4-flash',
  cwd: process.env.DSH_WORKSPACE ?? process.cwd(),
  dshHome: process.env.DSH_HOME ?? '/tmp/dsh-home',
})
```

控制面选择 SDK Profile、Provider、模型、工作区和 dsh 数据目录。`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL` 等变量由 Runtime 子进程直接继承。

### 启动幂等

```ts
async start(): Promise<RuntimeStatus> {
  if (this.state === 'running') return this.status()

  const harness = this.factory(this.options)
  this.harness = harness
  this.state = 'starting'

  await harness.start()
  this.state = 'running'
  return this.status()
}
```

`harness.start()` 启动 dsh 子进程并完成 JSON-RPC 初始化握手。Runtime 已运行时直接返回状态，避免重复创建进程；实际实现还合并并发启动请求，并在失败后执行清理。

该验证用于证明控制面启动接口具备幂等性：面对 HTTP 重试、重复点击或并发请求，始终只有一个活动 Runtime，不会产生重复子进程、资源泄漏或多条 JSON-RPC 连接。只有完成 `stop` 后，再次启动才允许创建新 Runtime。它不验证会话连续性，会话复用由 `04-session-management` 覆盖。

幂等范围不是整个 Host，而是一个逻辑 Runtime 对应的 `RuntimeManager`：

```text
Host
├── RuntimeManager A → Runtime A
└── RuntimeManager B → Runtime B
```

同一 Manager 同时最多拥有一个活动 Runtime；不同 Manager 可以在同一 Host 分别运行。实际控制面可以使用 `runtimeId` 将请求路由到对应 Manager，并分别隔离工作区、Session 目录、凭据和资源。

### Case 1：同一 Manager 重复启动

连续两次调用 `runtime.start()`，第二次直接返回已有状态。预期只调用一次 SDK `start()`，且两次响应中的 `startedAt` 相同。该 Case 证明同一逻辑 Runtime 不会因为请求重试而产生重复进程。

### Case 2：同一 Host 运行多个 Runtime

```ts
const managerA = new RuntimeManager(options, () => harnessA)
const managerB = new RuntimeManager(options, () => harnessB)

await Promise.all([managerA.start(), managerB.start()])
```

两个 Manager 分别创建并持有自己的 Runtime。预期 `harnessA.start()` 与 `harnessB.start()` 各执行一次，且两个 Manager 都进入 `running`。该 Case 证明幂等约束不是 Host 级单例限制。

当前 HTTP 接口只暴露一个默认 Manager；多 `runtimeId` 的控制面路由不属于本 Demo。上述两个边界均由单元测试覆盖：

```bash
make test  # 验证单 Manager 幂等和多 Manager 并存
```

### 关闭 Runtime

```ts
this.state = 'stopping'
await harness.close()
this.harness = undefined
this.state = 'stopped'
```

`harness.close()` 请求 Runtime 正常退出并回收子进程。关闭后的 SDK 实例不可复用，再次启动会创建新实例。

### 暴露控制面接口

```ts
app.get('/runtime', async () => runtime.status())
app.post('/runtime/start', async () => runtime.start())
app.post('/runtime/stop', async () => runtime.stop())
```

Fastify 只负责将生命周期能力暴露为 HTTP API，实际进程管理集中在 `RuntimeManager`。

## 运行

```bash
make configure  # 从模板创建本地环境配置（已存在时不覆盖）
make up         # 构建镜像并在后台启动独立容器
```

## 验证

```bash
make health          # 检查控制面及 Runtime 当前状态
make runtime-start   # 启动 dsh Runtime 并完成 SDK 握手
make runtime-status  # 查询 Runtime 生命周期状态
make runtime-start   # 再次启动，验证幂等且未创建额外 Runtime
make runtime-stop    # 关闭 Runtime 并回收子进程
make down            # 停止并删除 Demo 容器
```

第二次启动返回相同的 `startedAt`，证明启动请求幂等且未创建额外 Runtime。停止后状态应为 `stopped`。

也可以执行完整冒烟测试；容器会在测试结束后自动删除：

```bash
make smoke  # 自动构建、启动、验证复用与关闭，并删除容器
```

## 接口

- `GET /health`：控制面和 Runtime 状态。
- `GET /runtime`：Runtime 状态。
- `POST /runtime/start`：启动并完成 SDK 初始化握手。
- `POST /runtime/stop`：关闭并回收 Runtime。

## 本地测试

```bash
make install  # 按 lockfile 安装依赖
make verify   # 依次执行单元测试、类型检查和构建
```

