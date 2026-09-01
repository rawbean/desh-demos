# Demo 10：Runtime 自定义模型工具

本 Demo 固定使用 `@deepseek-ai/dsh-sdk-client@0.1.2-alpha.2`、
`@deepseek-ai/dsh-tools@0.1.2-alpha.2` 与 `@deepseek-ai/cordis@4.0.2`，
展示如何把自定义模型工具作为真正的 DSH Runtime Cordis 插件加载。

`src/plugins/custom-tool.ts` 使用真实 `defineTool()` API 定义
`deterministic_score`，并通过 `ctx.tools.register()` 注册。输入 schema 要求
`label: string`、`values: integer[]` 和枚举 `mode: "sum" | "weighted"`；
`defineTool` 在执行函数前校验模型参数。工具纯计算且无外部副作用，相同输入始终
返回相同的整数分数与 fingerprint。

## 核心代码

Cordis 插件用 `defineTool()` 声明工具并交给 Runtime 的 tool registry；执行函数
只按输入计算分数，因此结果可重复验证：

```ts
ctx.tools.register(
  defineTool({
    name: TOOL_NAME,
    // schema and presentation omitted
    async execute(args): Promise<ScoreResult> {
      const score = args.values.reduce(
        (total, value, index) =>
          total + value * (args.mode === "weighted" ? index + 1 : 1),
        0,
      );
      return {
        label: args.label,
        mode: args.mode,
        score,
        fingerprint: `${args.label}:${args.mode}:${args.values.join(",")}:${score}`,
      };
    },
  }),
);
```

## 验证链路

`POST /runs` 会启动真实 SDK/DSH/Cordis Runtime，并应用运行时解析的本地 patch：

1. patch 通过绝对 `file:` URL 加载编译后的 Cordis 插件。
2. OpenAI-compatible Mock LLM 必须先看到 `deterministic_score` schema，才会
   实际返回一个 `tool_calls`，参数固定为
   `{"label":"sdk","values":[3,1,4],"mode":"weighted"}`。
3. Runtime 校验输入并执行工具，确定性得到 `score=17` 和
   `sdk:weighted:3,1,4:17`。
4. Mock 在第二次模型请求的 `tool` message 中验证完整结果，最终回答
   `verified custom tool: score=17; fingerprint=sdk:weighted:3,1,4:17`。
5. API 同时返回完整 `toolEvents` 和 `sdkProof`。集成测试与 smoke 都要求 SDK
   事件中真实存在 `tool/call` 和 `tool/result`，而不只检查 Mock 请求次数。

## API

- `GET /health`：服务与 Runtime 状态。
- `GET /runtime`：Runtime 状态和解析后的 patch 路径。
- `POST /runtime/start`、`POST /runtime/stop`：管理 Runtime。
- `POST /runs`：提交 `{ "prompt": "...", "sessionId": "可选" }`。

默认监听端口 `3010`。

## 本地运行

需要 Node.js 24、pnpm 11；容器验证还需要 Docker。

```sh
make configure # 首次创建本地 .env，不覆盖已有配置
make install # 按锁文件安装依赖
make verify # 运行完整质量门禁
make smoke # 运行确定性容器全链路验证
```

真实模型运行前在 `.env` 设置 `DEEPSEEK_API_KEY`，然后执行：

```sh
make run # 以前台受限容器运行服务
make run-api PROMPT="Call deterministic_score once." # 通过服务 API 发起一次运行
```

不要提交 `.env` 或真实密钥。`make smoke` 使用本地 Mock，不访问外部模型。

## 验证标准

`make verify` 依次执行 Prettier 格式检查、ESLint、测试、严格 TypeScript
typecheck 和 build。测试包含：

- Cordis 插件注册与确定性结果；
- 非整数数组输入触发 `ToolArgsError`，证明校验发生在工具执行前；
- patch 解析为实际插件的绝对 `file:` URL；
- 真实 SDK 全链路产生 Mock `tool_calls`、`tool/call`、`tool/result` 和最终答案。

`make smoke` 还构建并启动生产镜像，通过 HTTP 重跑全链路，然后用
`docker inspect` 检查非 root 用户、只读根文件系统、`cap-drop ALL`、
`no-new-privileges` 和 PID 限制。

## 容器安全边界

镜像使用独立 `demo` 用户。Makefile 只为 `/tmp` 与 `/workspace` 提供
`noexec,nosuid` tmpfs，限制 CPU、内存和 PID，并使用独立 Docker network。
应用不把密钥写入镜像；生产凭据仅应在运行时注入。

## Alpha 限制

- DSH、SDK 和 tools 均为 `0.1.2-alpha.2`；插件 patch、事件名和 schema DSL
  仍可能在后续 alpha 变化，升级依赖后必须重新执行完整验证。
- Mock 证明本地 SDK/Runtime/Cordis/tool loop 的协议链路，但不能替代真实
  DeepSeek 服务的网络、鉴权、配额与模型选择工具的行为测试。
- 参数 DSL 当前只验证声明的 JSON 类型和枚举；本 Demo 没有声明数组长度或整数
  范围等业务约束。
- 本地插件必须先编译，Runtime 加载的是 `dist/plugins/custom-tool.js`。
