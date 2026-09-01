# Demo 06：Cordis Composition

本 Demo 基于 `@deepseek-ai/dsh-sdk-client@0.1.2-alpha.2` 的 `profile` 与 `patches` 启动参数，展示同一个 `sdk` profile 如何叠加本地 Cordis patch，形成可查询、可切换、行为可验证的能力组合。

## 组合

- `focused`：替换 system prompt persona，并禁用 `tool-todo`。
- `planner`：替换 system prompt persona，启用 `tool-todo`，且禁止多个进行中的 todo。

两个定义位于 `profiles/`，实际 Cordis overlay 位于 `patches/`。patch 直接命中 SDK profile 的 `system-prompt` 与 `tool-todo` entry，而不是在 HTTP 控制面模拟配置。

```yaml
- id: system-prompt
  name: "@deepseek-ai/dsh-system-prompt"
  config:
    persona: CORDIS_PROFILE=focused. Answer directly and do not create todo items.
- id: tool-todo
  name: "@deepseek-ai/dsh-tool-todo"
  disabled: true
```

SDK 的 `sdk` profile 在该版本声明 `patchReload: "startup"`。因此切换组合时，`RuntimeManager.configure()` 先关闭旧 `DeepSeekHarness` 子进程，再使用新 patch 路径创建并启动新实例；`generation` 会增加。存在活动 run 时切换返回 409，避免中途改变能力。

```ts
await this.stop();
this.composition = next;
if (wasRunning) await this.start();
return { ...this.status(), rebuilt: wasRunning };
```

## API

- `GET /compositions`：查询所有本地组合及能力。
- `GET /composition`：查询当前组合、运行状态和 generation。
- `PUT /composition`：用 `{ "id": "focused" | "planner" }` 重配置。
- `POST /runs`：用 `{ "prompt": "..." }` 运行真实 SDK 链路。
- `POST /runtime/start`、`POST /runtime/stop`：显式管理 Runtime。

确定性 Mock 是 OpenAI-compatible SSE provider。它检查 DSH 实际发出的 system message 与 tool schema：`focused` 必须得到 `profile=focused;todo=false`，`planner` 必须得到 `profile=planner;todo=true`。测试与容器 smoke 同时断言响应差异和 `generation=2`，因此不是控制面伪造。

## 使用

```sh
make configure # 创建本地 .env（首次运行）
make install # 按锁文件安装依赖
make format # 格式化源码和配置
make lint # 执行 ESLint
make test # 执行单元测试和真实 SDK Mock 全链路测试
make typecheck # 执行严格 TypeScript 检查
make build # 编译到 dist
make verify # 顺序执行格式、lint、test、typecheck、build
make image # 构建非 root 容器镜像
make run # 前台运行受限容器，默认端口 3006
make up # 后台运行受限容器
make compositions # 查询可用组合
make current # 查询当前组合和 generation
make select COMPOSITION=planner # 切换组合并按需重建 Runtime
make run-api PROMPT="demonstrate composition" # 运行当前组合
make smoke # 在独立网络中执行两种组合的容器全链路验证
make down # 停止容器并删除独立网络
```

## 容器边界

容器以非 root 用户运行，根文件系统只读，drop 全部 capabilities，启用 `no-new-privileges`，限制 CPU、内存、PID，并仅为 `/tmp` 与 `/workspace` 提供 `noexec,nosuid` tmpfs。默认使用独立的 `dsh-demo-06-net` 网络与宿主端口 3006。

## 限制

- SDK 0.1.2-alpha.2 没有运行中修改 `patches` 的 API；startup-only profile 只能重建子进程。
- 切换不会迁移旧 Runtime 的进程内状态；调用方应保留自己的 session 标识并理解新实例边界。
- Mock 证明 patch 已改变下游模型请求，但不替代真实 DeepSeek 凭据与模型的兼容性测试。
- patch 按 SDK 0.1.2-alpha.2 的 entry id 编写；升级 DSH 后应先检查 dump-config。
