# Demo 12：Workspace Sandbox

本 Demo 通过真实 `DeepSeekHarness` SDK 启动 DSH `sdk` profile，并让固定
Mock LLM 发起四个真实工具调用，验证 workspace 文件策略与默认能力拒绝。
它不在 HTTP 控制面预判路径；工作区内/外写入都进入 DSH 工具流水线和
`@deepseek-ai/dsh-fs-sandbox`。

```text
Mock LLM tool_calls
  ├─ write(/workspace/inside-proof.txt)  -> Created file
  ├─ write(/etc/...outside-proof.txt)    -> FS_SANDBOX_DENIED
  ├─ bash(...)                           -> DSH ToolRuntime guard denies
  └─ web_search(...)                     -> DSH ToolRuntime guard denies
       └─ SDK tool/call + tool/result events
```

## 真实策略链

DSH `sdk` profile 已组合：

- `@deepseek-ai/dsh-sandbox-policy`，本 Demo 固定
  `DSH_PERMISSION_MODE=workspace-write`；
- `@deepseek-ai/dsh-fs-sandbox`，在可信文件系统 seam 内对 `write` /
  `edit` 重新规范化路径并实施 `FS_SANDBOX_DENIED`；
- `@deepseek-ai/dsh-tool-fs`，向模型提供真实 `read`、`write`、`edit`
  工具；
- `@deepseek-ai/dsh-tools`，执行 `tools/pre-execute`、单调 guard、工具
  body 和 `tools/result` 流水线。

`patches/workspace-sandbox.patch.yml` 通过真实 Cordis patch 插入
`src/plugins/capability-deny.ts` 的编译产物。插件调用
`ctx.tools.guard()`，默认拒绝 `bash` / `pwsh` 和 `web_search` /
`web_fetch`。Mock 仍然固定调用 `bash`、`web_search`，所以结果证明拒绝
发生在 DSH ToolRuntime 执行管线，而不是因为 schema 被隐藏。

`POST /runs` 返回四组证据：

- `toolEvents`：SDK 返回的原始 `tool/call` 与 `tool/result` 事件；
- `sdkProof`：从事件中归纳的四项策略结果；
- `mockObservation`：Mock provider 在第二轮实际看到的工具结果；
- `artifactProof`：工作区文件内容存在，而外部目标不存在。

## 核心代码

本地策略插件通过真实 `ToolRuntime` guard 拒绝默认高风险能力；文件写入边界仍由
`dsh-fs-sandbox` 的 `workspace-write` 策略负责：

```ts
const DENIALS: Readonly<Record<string, string>> = {
  bash: "demo policy denies Shell by default",
  pwsh: "demo policy denies Shell by default",
  web_search: "demo policy denies network tools by default",
  web_fetch: "demo policy denies network tools by default",
};

ctx.tools.guard((execution) => DENIALS[execution.name]);
```

## 边界声明

`dsh-fs-sandbox` 是**可信进程内的路径策略围栏，不是内核安全边界**。
它缩小但不消除解析到系统调用之间的 TOCTOU；对抗性同进程插件、宿主
进程或内核不在其威胁模型内。需要运行不可信代码时应使用容器、
microVM 或远程执行世界。

另外，DSH `SandboxMode` 只描述文件效果：

- 读取不被 `dsh-fs-sandbox` 拒绝；本 Demo 验证的是真实写入/变更围栏；
- 它不表达网络策略，也不等价于“禁止启动 shell”；
- 本 Demo 的 Shell 与 web 工具默认拒绝由真实 `ToolRuntime` guard
  提供，属于能力策略而非内核隔离；
- `make smoke` 额外以 Docker `--network none` 验证容器外网不可达，这才
  是本 Demo 的网络边界。常规 `make up` 为了提供 HTTP API 使用独立
  bridge 网络，因此不应被当作外网隔离部署。

## 使用

要求 Node.js 24、pnpm 11；容器 smoke 还要求 Docker。

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
make run-api # 通过服务 API 发起一次运行
make down # 停止容器并清理网络
```

默认端口为 `3012`。

## API

- `GET /`：Demo 元数据与边界声明。
- `GET /health`：服务和 Runtime 状态。
- `GET /runtime`：workspace、固定策略、patch 与活动 run。
- `POST /runtime/start`、`POST /runtime/stop`：Runtime 生命周期。
- `POST /runs`：提交 `{ "prompt": "..." }`；Mock 模式下 prompt 不改变
  固定四次工具调用。

## 验证门禁

`make verify` 依次执行 format check、ESLint、单元/真实 SDK 集成测试、
独立 typecheck 和 build。集成测试要求：

1. Mock 确实收到 `write`、`bash`、`web_search` schema；
2. 四个固定调用产生恰好四个 SDK `tool/call` 和四个 `tool/result`；
3. 工作区内 `write` 成功并留下确定内容；
4. `/etc` 目标由 `workspace-write` 返回沙箱拒绝标记；
5. Shell 与 web 调用被 DSH 单调 guard 拒绝。

`make smoke` 构建生产镜像，并验证非 root、只读根文件系统、drop 全部
capabilities、`no-new-privileges`、CPU/内存/PID 限制、`noexec,nosuid`
临时卷及 `NetworkMode=none`。Mock provider 与 Runtime 都在同一容器的
loopback 上通信，所以 smoke 无需外网。

## 目录

- `src/mock-provider.ts`：固定四次工具调用的 OpenAI-compatible Mock。
- `src/plugins/capability-deny.ts`：真实 DSH ToolRuntime guard。
- `src/runtime-manager.ts`：patch 物化与 SDK Runtime 生命周期。
- `src/app.ts`：HTTP API 和 SDK/文件双证据。
- `patches/`：Cordis 工具策略 patch。
- `tests/`：控制面、patch、guard 与真实 SDK 集成测试。
- `Dockerfile`、`Makefile`：独立构建、全门禁与安全容器 smoke。
