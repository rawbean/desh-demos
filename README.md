# DeepSeek Harness 集成 Demo

## DeepSeek Harness

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）是 DeepSeek 开源的 Agent Harness。它基于 [Cordis](https://github.com/cordiverse/cordis)，采用 **Everything is a Plugin** 架构：模型、工具、技能、会话、沙箱、存储、循环、调度和 UI 均可通过插件替换或扩展。

- 官网：https://deepseek.com/harness/
- 源码：https://github.com/deepseek-ai/deepseek-harness
- 文档：https://deepseek-harness.github.io/deepseek-harness/
- 状态：Developer Preview，API 和插件接口可能发生破坏性变更

本项目不使用 dsh 自带 Web UI，而是通过 SDK 驱动 dsh Runtime，构建自己的控制面。控制面负责 Runtime 生命周期、配置、任务、会话、权限、事件流和可观测性；dsh 负责 Agent 执行。

```text
自定义控制面（Web/API）
        │
        │ @deepseek-ai/dsh-sdk-client
        │ stdio JSON-RPC
        ▼
DeepSeek Harness Runtime
        │
        ├── Model / Session / Agent Loop
        └── Tools / Skills / MCP / Sandbox
```

每个主题都是独立项目，自带完整代码、依赖、配置、测试和 Dockerfile，并构建为独立镜像。Demo 之间不共享代码、容器、网络、存储或运行状态。

## 技术选型

- Runtime：Node.js
- 语言：TypeScript
- 包管理：pnpm
- SDK：`@deepseek-ai/dsh-sdk-client`
- Runtime：`@deepseek-ai/dsh`
- 控制面 API：Fastify
- 控制面 UI：React + Vite
- 实时事件：SSE
- 元数据存储：SQLite（Demo 阶段）
- 测试：Vitest
- 代码质量：ESLint + Prettier
- 隔离：Docker

SDK 通过 stdio JSON-RPC 启动并管理完整 dsh Runtime，可创建会话、发送 Prompt、接收结果、事件和通知。它不直接注册到 Cordis Context；Runtime 的能力组合仍由 `cordis.yml` 决定。

## Demo 清单

- [x] `01-runtime-lifecycle`：启动、健康检查、复用和关闭 dsh Runtime。
- [x] `02-task-execution`：通过 SDK 提交 Prompt 并获取最终结果。
- [x] `03-event-stream`：实时展示 Agent、模型、工具和通知事件。
- [x] `04-session-management`：创建、继续、终止和查询会话。
- [ ] `05-model-provider`：配置并切换模型 Provider。
- [ ] `06-cordis-composition`：加载并切换 `cordis.yml` 能力组合。
- [ ] `07-plugin-lifecycle`：开发插件并验证注册、依赖注入、启停和卸载。
- [ ] `08-custom-service`：通过 Cordis `ctx` 提供和消费自定义 Service。
- [ ] `09-plugin-events`：监听和拦截 Agent、LLM、Tool 事件。
- [ ] `10-custom-tool`：通过插件注册模型可调用的 Tool。
- [ ] `11-custom-model-adapter`：通过插件接入自定义模型 Provider。
- [ ] `12-workspace-sandbox`：隔离工作区、文件、Shell、网络和资源。
- [ ] `13-human-approval`：审批或拒绝高风险工具调用。
- [ ] `14-skill-loading`：加载本地 Skill 并验证指令与资源注入。
- [ ] `15-mcp-integration`：发现并调用独立 MCP Server 的工具。
- [ ] `16-task-scheduling`：实现队列、并发限制、取消、超时和重试。
- [ ] `17-observability`：记录状态、事件、耗时、Token 和错误。
- [ ] `18-runtime-recovery`：验证 Runtime 崩溃重启和会话恢复。

## 目录

```text
dsh-demos/
├── demos/
│   ├── 01-runtime-lifecycle/
│   │   ├── src/
│   │   ├── tests/
│   │   ├── package.json
│   │   ├── pnpm-lock.yaml
│   │   ├── pnpm-workspace.yaml
│   │   ├── Makefile
│   │   ├── Dockerfile
│   │   └── README.md
│   ├── 02-task-execution/
│   ├── 03-event-stream/
│   ├── 04-session-management/
│   ├── 05-model-provider/
│   ├── 06-cordis-composition/
│   ├── 07-plugin-lifecycle/
│   ├── 08-custom-service/
│   ├── 09-plugin-events/
│   ├── 10-custom-tool/
│   ├── 11-custom-model-adapter/
│   ├── 12-workspace-sandbox/
│   ├── 13-human-approval/
│   ├── 14-skill-loading/
│   ├── 15-mcp-integration/
│   ├── 16-task-scheduling/
│   ├── 17-observability/
│   └── 18-runtime-recovery/
└── README.md
```

每个 Demo 可以单独复制到其他仓库运行。即使出现少量重复代码，也不抽取根目录公共包，避免升级或修改一个 Demo 时影响其他 Demo。

## Demo 统一标准

- 独立源码、依赖、lockfile、配置、测试、README、Makefile 和 Dockerfile。
- 不共享代码、容器、网络、Volume 或运行状态。
- 每个 Demo 使用独立容器名和默认宿主机端口，允许同时运行。
- dsh SDK 与 Runtime 锁定相同版本。
- README 只暴露 Make 命令，不直接要求执行 pnpm、docker 或 curl。
- README 中每条执行命令都必须用行尾注释说明用途。
- README 必须列出项目文件，并说明每个文件的职责。
- README 必须包含主题核心代码片段及其职责说明。
- Makefile 至少提供 `configure`、`install`、`verify`、`image`、`run` 和 `smoke`。
- Docker 使用非 root、只读文件系统、最小权限和资源限制。
- 单元测试、类型检查、构建和真实容器冒烟测试全部通过后，才标记完成。
- 冒烟测试必须覆盖主题核心路径，并自动停止和删除容器。

## Docker 约束

- 一个 Demo 对应一个独立镜像和临时容器。
- 容器内同时运行该 Demo 的控制面和 SDK 启动的 dsh Runtime。
- 容器使用独立网络和临时文件系统，不复用其他 Demo 的 Volume。
- 使用非 root 用户。
- 不使用 `privileged` 或宿主机网络。
- 不挂载 Docker Socket、用户主目录和凭据目录。
- API Key 仅在运行时注入。
- 输入目录只读，输出限定到专用目录。
- Shell、文件系统和外网访问默认关闭，按 Demo 显式启用。
- 设置 CPU、内存、进程数和超时限制。

统一运行方式：

```bash
make -C demos/01-runtime-lifecycle configure  # 创建该 Demo 的本地环境配置
make -C demos/01-runtime-lifecycle run        # 构建并前台运行该 Demo 容器
```

外部依赖优先使用 Demo 内置 Mock；容器退出后不保留状态。确需验证持久化时，只挂载该 Demo 自己的专用目录。

## 实施顺序

先完成 `01`—`04` 的 SDK 基础链路，再按编号逐项实现其余集成能力。
