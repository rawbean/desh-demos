# 04 Session Management

通过 `@deepseek-ai/dsh-sdk-client` 实现会话控制面：创建、继续、终止、单条查询和列表查询，并验证同一会话的多轮上下文连续。

```text
控制面 Session ID → SDK run(prompt, { sessionId }) → 同一 dsh Session
```

当前锁定 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-sdk-client` 的 `0.1.2-alpha.2`。该版本没有独立的远端“删除会话”协议，因此终止是控制面的逻辑终止：终止后的 ID 永久拒绝新 Turn；Runtime 子进程由控制面统一持有，并只在服务关闭时通过 SDK `close()` 安全回收。

会话元数据保存在进程内，容器退出后不保留。Agent 对话上下文由同一 Runtime 内的 dsh Session 持有。

## 状态与错误

- `active`：可以提交下一轮。
- `running`：正在执行一轮；同一会话的重叠请求和终止请求返回 `409`。
- `error`：上一轮失败，`lastError` 保存原因；可以再次提交以重试。
- `terminated`：逻辑终止，后续 Turn 返回 `409`。
- 未知 Session 返回 `404`，空 Prompt 返回 `400`，Runtime/模型错误返回 `502`。

## 代码文件清单

- `src/server.ts`：读取环境配置、创建应用并处理控制面退出信号。
- `src/app.ts`：组装 Fastify 会话路由，将领域错误转换为明确的 HTTP 状态码。
- `src/session-manager.ts`：管理会话 ID、状态、轮次、上下文续接、逻辑终止和 SDK Runtime。
- `src/mock-provider.ts`：提供测试专用 DeepSeek SSE 响应，用于确定性验证多轮上下文。
- `tests/app.test.ts`：验证会话 HTTP 接口、输入校验和错误状态码。
- `tests/session-manager.test.ts`：验证创建、续接、并发保护、终止和 Runtime 回收。
- `Makefile`：统一封装安装、质量检查、容器操作、会话调用和冒烟测试。
- `Dockerfile`：构建独立、受限的控制面与 dsh Runtime 镜像。
- `.env.example`：声明 DeepSeek、模型、Token 和会话控制配置。
- `package.json`：声明脚本及 SDK、Runtime、Fastify、测试和格式化依赖。
- `pnpm-lock.yaml`：固定完整依赖版本和完整性。
- `pnpm-workspace.yaml`：声明依赖构建许可和预览版安装策略。
- `.prettierignore`：声明不参与格式检查的生成文件。
- `tsconfig.json`：启用严格 TypeScript 编译并输出生产代码。

## 核心代码

### 复用 Session ID

```ts
const result = await this.harness.run(input, { sessionId: id });
session.turnCount += 1;
```

控制面为每个会话生成稳定 ID，并在每轮调用中传给 SDK。dsh Runtime 因而把新 Prompt 追加到同一会话，而不是创建无上下文的新会话。

### 阻止并发覆盖与终止后续写入

```ts
if (session.state === "running") {
  throw new SessionBusyError(`session ${id} already has a running turn`);
}
if (session.state === "terminated") {
  throw new SessionTerminatedError(`session ${id} is terminated`);
}
```

状态检查保证同一会话同一时刻只有一个 Turn，避免响应顺序和上下文顺序不一致；逻辑终止是幂等操作。

### 安全回收 Runtime

```ts
app.addHook("onClose", async () => {
  await manager.close();
});
```

`SessionManager` 只创建一个 SDK Harness，供全部会话复用。Fastify 关闭时仅调用一次 `close()`，由 SDK 完成 Runtime 的 shutdown、EOF、SIGTERM/SIGKILL 回收阶梯。

## 接口

- `GET /health`：健康检查。
- `POST /sessions`：创建会话，返回 `201`。
- `GET /sessions`：查询全部会话。
- `GET /sessions/:id`：查询单个会话。
- `POST /sessions/:id/turns`：提交 `{ "prompt": "..." }` 并等待本轮结束。
- `DELETE /sessions/:id`：逻辑终止会话。

## 运行真实模型

```bash
make configure                                      # 创建本地环境配置（已存在时不覆盖）
make up                                             # 构建镜像并后台启动独立容器
make health                                         # 检查控制面健康状态
make session-create                                 # 创建一个新会话
make session-turn SESSION_ID='<id>' PROMPT='记住蓝色' # 在指定会话执行第一轮
make session-turn SESSION_ID='<id>' PROMPT='我让你记住什么？' # 在同一会话验证上下文
make session-get SESSION_ID='<id>'                  # 查询指定会话状态
make session-list                                   # 查询全部会话
make session-terminate SESSION_ID='<id>'             # 逻辑终止指定会话
make down                                           # 停止容器并删除独立网络
```

## 自动验证

```bash
make install  # 按独立 lockfile 安装依赖
make verify   # 执行格式检查、单元测试、类型检查和构建
make image    # 构建非 root、只读文件系统兼容镜像
make run      # 构建并前台运行受限容器
make smoke    # 用容器内 Mock 验证两轮上下文、终止和拒绝后续 Turn
```

Mock 仅在 `ENABLE_MOCK_PROVIDER=true` 时启用。`make smoke` 在同一容器中运行真实 SDK、dsh Runtime、HTTP 控制面和确定性模型 Mock，不需要真实 API Key，不产生模型费用，并自动删除容器与独立网络。
