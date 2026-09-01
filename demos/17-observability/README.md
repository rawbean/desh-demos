# Demo 17 — Observability

This standalone Node 24 demo turns the SDK notification pipeline from Demo 03
into bounded, queryable observability data. It persists tasks, traces, sanitized
events, duration, token usage, category counts, and errors with the built-in
`node:sqlite` driver.

## Run

```bash
make install # 按锁文件安装依赖
make verify # 运行完整质量门禁
make smoke # 运行确定性容器全链路验证
```

For a real provider, create `.env`, set `DEEPSEEK_API_KEY`, and start the
service on port `3017`:

```bash
make configure # 首次创建本地 .env，不覆盖已有配置
make up # 以后台受限容器启动服务
make health # 查询服务健康状态
```

The API accepts tasks at `POST /tasks` and returns `202` with task and trace
IDs. Poll `GET /tasks/:taskId` until it is `completed` or `failed`. Trace data
is available from `GET /traces/:traceId`, `GET /traces/:traceId/events` (with
an optional `limit` query), and `GET /traces/:traceId/metrics`. These API calls
have no Make targets, so this README does not prescribe direct client commands.

## Core code

Errors are sanitized before persistence. This function's responsibility is to
redact common credential forms and bound stored error size:

```ts
export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(
      /((?:api[-_]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, 512);
}
```

## Data and safety boundaries

- Prompts, final model text, tool arguments/results, and raw notification params
  are never persisted. Events contain only category, type, SDK method, timestamp,
  duration, and numeric usage fields.
- Errors redact common bearer/API-key/token/secret/password forms and are
  truncated to 512 characters.
- At most `EVENT_LIMIT` events (default and hard API maximum: 200) are retained
  per trace. Query limits cannot exceed that configured bound.
- The image runs as an unprivileged user with a read-only root filesystem,
  dropped capabilities, `no-new-privileges`, resource limits, and dedicated
  tmpfs mounts. SQLite lives at `/tmp/observability/observability.db`.

## Alpha token-event limitation

The `0.1.2-alpha.2` SDK does not expose a stable, separately typed token event.
This demo therefore scans notification metadata for OpenAI-style
`prompt_tokens`, `completion_tokens`, and `total_tokens` (plus camel-case
variants) and deduplicates identical usage triplets within one run. In the
current alpha notification projection, streamed provider usage preserves
`total_tokens` but drops its prompt/completion split, so those two metrics are
zero even though the Mock sends both. Metrics are best-effort: a provider or
future SDK build that omits all usage from notifications will report zero even
if billing occurred. The bundled Mock invokes DSH's real built-in `todo_write`
tool; container smoke verifies the returned tool-result round, all four event
categories, and the exact observed total of 43 tokens.
