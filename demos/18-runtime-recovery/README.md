# 18 — Runtime Recovery

这个独立示例组合了 runtime 生命周期和 session 控制面，并针对 DSH
`0.1.2-alpha.2` 实际验证 Transport/子进程崩溃后的能力边界。

## 结论（先读）

恢复会关闭失效 Harness，并**新建** `DeepSeekHarness` 和 runtime 子进程；新进程继续使用相同
`sessionId`、`DSH_HOME` 和 workspace。控制面可以可靠恢复 session 的 id、turnCount、
终止状态及 `recoveryGeneration`。

但是当前 alpha.2 **不能恢复模型上下文**。真实子进程集成测试的确定性证据是：

1. 第一轮 Mock 模型返回 `remembered:blue`；
2. SIGKILL runtime 子进程，状态变为 `running -> crashed`；
3. 新建 Harness，以相同 session id 和 DSH_HOME 恢复；
4. 第二轮返回空字符串，而不是 `context-ok`；
5. Mock provider 的请求计数仍为 1，且从未看到第一轮 assistant memory。

因此 API 将该 probe 标成 `contextContinuity: "lost"`；它不会伪造
`context-ok`。`expectedResponse` 只比较真实返回值并记录证据，不会修改模型输出。

## 状态模型

Runtime 的恢复主路径：

```text
running -> crashed -> recovering -> running
                                \-> failed
```

恢复实现复用同一个 transition Promise，关闭旧 Harness 后只启动一个新实例；其职责
是串行化并发恢复请求并维护恢复代际：

```ts
this.recoveryGeneration += 1;
this.setState("recovering");
const oldHarness = this.harness;
this.harness = undefined;
const task = (async () => {
  if (oldHarness) await oldHarness.close().catch(() => undefined);
  return this.launchFresh();
})();
this.transition = task;
```

启动和关闭还会短暂出现 `stopped`、`starting`、`stopping`。公开的 SDK notification
subscription 在 Transport 关闭时失败，manager 据此检测空闲期崩溃；运行中的
`TransportClosedError` 也会立即触发同一状态转换。所有并发恢复请求共享一个恢复任务，
每次实际恢复尝试只创建一个新 Harness。

Session 控制面状态为：

```text
active <-> running
   |          |
   +------> suspended   (runtime crashed/failed)
                  |
                  +----> active (runtime recovered)
any non-running -------> terminated
```

崩溃中的 in-flight turn 在控制面保持忙碌保护，不能并发执行或终止。终止操作幂等，
terminated session 永远不能继续。

## API

- `GET /health`
- `GET /runtime`
- `POST /runtime/crash`：仅当 `ENABLE_RUNTIME_CRASH_ENDPOINT=true` 时注册，且必须提供
  `x-runtime-crash-token`
- `POST /recover`
- `GET /recover/status`
- `POST /sessions`
- `GET /sessions`
- `GET /sessions/:id`
- `POST /sessions/:id/turns`
- `DELETE /sessions/:id`

Turn body：

```json
{
  "prompt": "What did I ask you to remember?",
  "expectedResponse": "context-ok"
}
```

`expectedResponse` 可省略。省略时 continuity 始终为 `unverified`，避免把普通模型回答误报
为上下文恢复证明。

## 本地运行

```bash
make install # 按锁文件安装依赖
make verify # 运行完整质量门禁
make configure # 首次创建本地 .env，不覆盖已有配置
# 填写 .env 中的 DEEPSEEK_API_KEY
make run # 以前台受限容器运行服务
```

服务默认监听 `3018`。常用控制命令：

```bash
make session-create # 创建新 Session
make runtime-status # 查询 Runtime 状态
make crash CRASH_TOKEN=... # 触发受令牌保护的测试崩溃
make recover # 恢复失效 Runtime
make recovery-status # 查询恢复与连续性统计
```

生产环境不要启用 crash endpoint。alpha.2 没有公开的故障注入 API；本示例仅在被显式启用、
token 校验通过时，对该固定版本 SDK 内部拥有的子进程发送 SIGKILL。崩溃检测本身不依赖
这个内部字段。

## 验证

`make verify` 门禁包含格式检查、ESLint、单元测试、真实 alpha.2 子进程恢复集成测试、
TypeScript 类型检查和构建。测试覆盖：

- 启动、崩溃、成功恢复和失败恢复；
- 并发恢复只创建一个新 Harness；
- session 并发 turn、崩溃挂起、恢复、终止与终止后拒绝；
- crash API 默认不存在，启用后仍要求 token；
- 相同 sessionId + DSH_HOME 的真实上下文恢复结论。

`make smoke` 还会构建并运行安全容器，执行完整的记忆 → SIGKILL → 恢复 → context-lost
链路，并检查非 root 用户、只读 rootfs、cap-drop、no-new-privileges、PID 限制、tmpfs
和 init。

## 限制

- 控制面 metadata 保存在 API 进程内存中；本示例恢复的是它拥有的 runtime 子进程，
  不是 API 进程重启。
- alpha.2 的同 session id / DSH_HOME 恢复不会继续模型上下文，且本次验证中恢复后 prompt
  没有再次到达 provider。
- 没有自动重试用户 turn，避免不确定的重复执行；恢复后由调用方明确发起下一轮。
- crash 注入依赖 alpha.2 内部实现，只用于测试，不能作为 SDK 公共 API 使用。
