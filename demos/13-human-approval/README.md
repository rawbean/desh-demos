# Demo 13：Human Approval

本 Demo 展示 dsh Runtime 内部真实的 approval/permission 链路。确定性模型先
调用一个被标记为高风险的模拟工具，`tools/pre-execute` 返回 `ask`，Runtime
再将请求交给 `ctx.approval`。自定义 answerer 根据
`DEMO_APPROVAL=allow|reject` 返回一次性允许或拒绝。

```text
SDK run
  └─ mock model emits high_risk_workspace_delete
       └─ Runtime tools/pre-execute → ask
            └─ ApprovalService.request()
                 ├─ session: approval/asked
                 ├─ custom approval/request answerer
                 │    └─ allow → allowed-once
                 │       reject → rejected
                 └─ session: approval/decided
                      ├─ allow：执行无副作用模拟工具
                      └─ reject：工具体不执行
```

工具名称刻意表达风险，但实现只返回确定性 JSON，**不会删除文件或执行 shell
命令**。allow smoke 证明工具体执行；reject smoke 证明审批拒绝后工具体没有
执行。

## 真实 Runtime 证据

`patches/human-approval.patch.yml` 把编译后的 Cordis 插件插入 `sdk`
profile。插件要求 Runtime 已组合 `tools`、`approval` 和
`permissionPresets` 三个服务：

- `tools/pre-execute` 只针对 `high_risk_workspace_delete` 返回 `ask`。
- `approval/request` 自定义 answerer 返回 `allowed-once` 或 `rejected`。
- answerer 调用 `permissionPresets.current(session)`，证明 permission 服务
  实际可用，而不是在 HTTP 层模拟审批。
- SDK 的 `RunResult.events` 必须同时包含 `approval/asked` 和
  `approval/decided`，并且二者 id 相同、outcome 符合配置。
- Runtime 插件另写权限为 `0600` 的最小事件日志，用来证明 answerer 是否
  运行以及工具体是否执行；不记录 prompt、凭据或环境变量。

## 核心代码

第一个 hook 负责把指定工具升级为审批请求，第二个 Runtime 内 answerer 根据受控
模式返回一次性裁决：

```ts
ctx.on("tools/pre-execute", async (exec, next) => {
  if (exec.name !== TOOL_NAME) return next();
  return {
    kind: "ask",
    reason: "simulated destructive workspace deletion requires approval",
  };
});

ctx.on("approval/request", async (request, next) => {
  if (request.toolName !== TOOL_NAME) return next();
  return outcomeFor(mode);
});
```

## 确定性场景

- `DEMO_APPROVAL=allow`：answerer 返回 `allowed-once`，工具执行，最终回答含
  `approval-allowed`。
- `DEMO_APPROVAL=reject`：answerer 返回 `rejected`，工具被 Runtime 阻止，
  最终回答含 `approval-rejected`。
- 其他值或缺失值：启动失败，避免含糊的默认放行。

## 使用

要求 Node.js 24、pnpm 11；容器 smoke 还要求 Docker。

```sh
make configure # 首次创建本地 .env，不覆盖已有配置
make install # 按锁文件安装依赖
make verify # 运行完整质量门禁
make smoke # 运行确定性容器全链路验证
```

`make smoke` 分别启动 allow/reject 容器并检查确定性结果，同时检查非 root
用户、只读根文件系统、`cap-drop ALL` 与 `no-new-privileges`。

启动单个常驻容器：

```sh
DEMO_APPROVAL=allow make up # 以后台受限容器启动服务
make health # 查询服务健康状态
make run-api # 通过服务 API 发起一次运行
make events # 查询最近一次运行事件
make down # 停止容器并清理网络
```

默认宿主和容器端口均为 `3013`。Demo 使用进程内 OpenAI-compatible mock
provider，不需要真实模型 API Key。

## API

- `GET /health`：HTTP 与 Runtime 状态。
- `GET /runtime`：Runtime 生命周期、活动 run、审批模式与 patch 路径。
- `POST /runtime/start`、`POST /runtime/stop`：Runtime 生命周期。
- `POST /runs`：提交 `{ "prompt": "..." }`，返回最终回答、SDK 审批事件、
  插件证据与断言。
- `GET /events`：最近的 Runtime 插件最小证据。

一次只允许一个 run；并发冲突返回 `409`。prompt 最大 20000 字符。

## 目录

- `src/plugins/human-approval.ts`：高风险模拟工具、`ask` 策略与自定义
  answerer。
- `patches/`：向真实 `sdk` profile 插入插件的 patch 模板。
- `src/runtime-manager.ts`：patch 物化与 SDK Runtime 生命周期。
- `src/mock-provider.ts`：确定性工具调用模型端点。
- `src/app.ts`：HTTP 控制面和全链路断言。
- `tests/`：配置、Runtime 管理和 allow/reject 真实集成测试。
- `Dockerfile`、`Makefile`：生产镜像、全门禁与安全容器 smoke。

## alpha.2 限制

本 Demo **不宣称 SDK 支持人工审批的双向 RPC**。
`@deepseek-ai/dsh-sdk-client@0.1.2-alpha.2` 可以观察 Runtime 投影出的 session
事件，因此能看到 `approval/asked` 与 `approval/decided`；但它没有“收到审批
问题后再由 SDK 客户端回传人工答案”的高层 API。本 Demo 的 answerer 是与
Runtime 同进程组合的 Cordis 插件，环境变量只用于自动、确定性裁决。

其他限制：

- `allowed-once` 仅授权当前请求，不形成持久授权。
- `approval/request` 是 Runtime 内的 waterfall 扩展点；无 answerer、answerer
  抛错或返回非法值时会 fail closed 为 `unavailable`。
- session 必须处于开放 turn，审批审计对才能安全写入。
- permission preset 只证明当前 Runtime 组合和有效 preset；本 Demo 不通过
  SDK 修改 preset。
- alpha Runtime 含原生依赖；`pnpm-workspace.yaml` 仅允许锁文件所需的六个
  安装脚本执行。

## 容器安全

运行镜像使用非 root 用户、只读根文件系统、drop 全部 capabilities、
`no-new-privileges`、CPU/内存/PID 限制。只有 `/tmp` 和 `/workspace` 是
`noexec,nosuid` tmpfs；镜像不复制 `.env`、测试、源码或开发依赖。
