import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const name = "dsh-demo-plugin-event-probe";
export const inject = ["agents", "llm", "tools"];

export function apply(ctx, config = {}) {
  const eventFile =
    config.eventFile ??
    process.env.DSH_PLUGIN_EVENT_FILE ??
    "/tmp/dsh-plugin-events.jsonl";
  const maxTokens = positiveInteger(
    config.maxTokens ?? process.env.DSH_PLUGIN_MAX_TOKENS,
    321,
  );

  mkdirSync(dirname(eventFile), { recursive: true });

  const record = (hook, phase, data = {}) => {
    appendFileSync(
      eventFile,
      `${JSON.stringify({
        source: "runtime-plugin",
        hook,
        phase,
        timestamp: new Date().toISOString(),
        ...data,
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  };

  ctx.on(
    "agent/status",
    ({ status }) => record("agent/status", "observed", { status }),
    { global: true },
  );

  ctx.on(
    "agent/request",
    async (payload, next) => {
      const request = await next();
      record("agent/request", "intercepted", {
        turn: payload.turn,
        step: payload.step,
        originalMaxTokens: request.maxTokens ?? null,
        replacementMaxTokens: maxTokens,
      });
      return { ...request, maxTokens };
    },
    { global: true },
  );

  ctx.on(
    "llm/stream",
    (options, next) => {
      record("llm/stream", "intercepted", {
        provider: options.provider,
        model: options.model,
        maxTokens: options.maxTokens ?? null,
      });
      return observeStream(next(), record);
    },
    { global: true },
  );

  ctx.on(
    "tools/post-execute",
    async (exec, result, next) => {
      const decision = await next();
      if (exec.name !== "todo_write" || result.isError) return decision;
      record("tools/post-execute", "intercepted", {
        name: exec.name,
        callId: String(exec.callId),
        replacement: "PLUGIN_TOOL_INTERCEPTED",
      });
      return {
        kind: "accept",
        content: [{ type: "text", text: "PLUGIN_TOOL_INTERCEPTED" }],
      };
    },
    { global: true },
  );

  ctx.on(
    "tools/result",
    (exec, result) => {
      record("tools/result", "observed", {
        name: exec.name,
        callId: String(exec.callId),
        isError: result.isError,
      });
    },
    { global: true },
  );

  record("plugin", "started", { maxTokens });
}

async function* observeStream(stream, record) {
  let chunks = 0;
  for await (const chunk of stream) {
    chunks += 1;
    yield chunk;
  }
  record("llm/stream", "completed", { chunks });
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
