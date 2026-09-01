# Demo 15：stdio MCP 集成

本 Demo 使用真实 `@deepseek-ai/dsh-mcp-client@0.1.2-alpha.2` Cordis
插件，把一个完全本地、无需联网的 stdio MCP Server 接入 DSH Runtime。服务默认监听
`3015`。

## 完整链路

`src/mcp-server.ts` 基于 MCP TypeScript SDK 暴露 `calculate` 工具。Runtime
启动时解析 `patches/mcp-client.patch.yml`，由真实 MCP Client 插件启动该子进程、
完成 initialize 与 `tools/list`，并向模型注册命名空间工具
`mcp__demo__calculate`。

内置 OpenAI-compatible Mock LLM 只在实际看到该命名空间工具后才返回
`tool_calls`，固定调用 `{"left":19,"right":23}`。MCP Server 返回
`{"sum":42,"proof":"19+23=42"}`，Mock 在下一轮模型请求中验证工具结果，最终回答
`verified MCP tool: 19+23=42`。

`POST /runs` 同时返回：

- `mockObservation`：证明模型发现并调用的是 `mcp__demo__calculate`；
- `mcpEvents`：MCP 子进程的 started、initialized、tools-listed 和 tool-called；
- `sdkProof` 与 `toolEvents`：证明 SDK 结果中存在 `tool/call`、`tool/result` 和包含
  最终文本的回答事件。

## 核心代码

stdio Server 的 request handler 校验工具名与整数参数，返回 MCP 文本及结构化结果；
它的职责是提供被 Runtime MCP Client 发现和调用的真实进程边界：

```ts
server.setRequestHandler(CallToolRequestSchema, (request) => {
  if (request.params.name !== RAW_TOOL_NAME) {
    return { isError: true, content: [{ type: "text", text: "unknown tool" }] };
  }
  const args = request.params.arguments;
  const left = args?.left;
  const right = args?.right;
  if (!Number.isInteger(left) || !Number.isInteger(right)) {
    return {
      isError: true,
      content: [{ type: "text", text: "left and right must be integers" }],
    };
  }
  const result = {
    sum: Number(left) + Number(right),
    proof: `${left}+${right}=${Number(left) + Number(right)}`,
  };
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result,
  };
});
```

## API

- `GET /health`：应用和 Runtime 状态；
- `GET /runtime`：初始化状态、patch 路径和预期工具名；
- `GET /mcp-events`：本地 MCP Server 生命周期与调用记录；
- `POST /runtime/start`、`POST /runtime/stop`：显式启动和停止 Runtime；
- `POST /runs`：提交 `{ "prompt": "...", "sessionId": "可选" }`。

停止 Runtime 或关闭 HTTP 服务会释放 Cordis 插件；MCP Client 随后关闭 stdio
transport 并清理子进程。停止接口会返回 `childCleaned`，集成测试还通过 PID
存活检查验证子进程确实消失。

## 本地验证

需要 Node.js 24、pnpm 11；容器 smoke 还需要 Docker。

```sh
make configure # 首次创建本地 .env，不覆盖已有配置
make install # 按锁文件安装依赖
make verify # 运行完整质量门禁
make smoke # 运行确定性容器全链路验证
```

`make verify` 依次执行 Prettier、ESLint、单元/真实 SDK 集成测试、严格 TypeScript
检查和生产 build。`make smoke` 构建生产镜像，在无外部模型网络请求的情况下重跑
完整 HTTP → SDK → Cordis → stdio MCP → 工具 → Mock LLM 链路，并检查：

- MCP initialize、工具发现、调用、结果、最终回答与子进程清理；
- 容器使用非 root 用户和只读根文件系统；
- `cap-drop ALL`、`no-new-privileges` 与 PID 限制。

真实模型运行时先在 `.env` 设置密钥，然后：

```sh
make run # 以前台受限容器运行服务
make run-api PROMPT="Use the demo calculator." # 通过服务 API 发起一次运行
```

不要提交 `.env` 或真实密钥。

## Alpha 限制

- DSH、SDK 与 MCP Client 都是 `0.1.2-alpha.2`，Cordis patch 结构、事件名称和工具
  映射契约仍可能变化，升级后必须重新执行完整验证。
- 当前 alpha MCP Client 只桥接 `tools`；本 Demo 不宣称支持 MCP resources、
  prompts、sampling、roots、elicitation 或 task-based execution。
- Demo 仅覆盖 stdio transport 和文本/结构化工具结果；没有覆盖
  Streamable HTTP、断线重连、图片/音频/embedded resource 投影。
- Mock 验证本地 Runtime 协议与工具循环，不替代真实 DeepSeek 服务的鉴权、配额、
  网络和具体模型工具选择行为测试。
- 生产系统不应把不受信任的命令、参数或环境变量直接写入 MCP patch；本 Demo 的
  command、server 路径、cwd 与事件路径均由应用生成，不接收 HTTP 输入。
