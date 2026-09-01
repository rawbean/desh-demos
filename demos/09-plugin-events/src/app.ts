import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { EventStore } from "./event-store.js";
import { registerMockProvider, type MockState } from "./mock-provider.js";
import {
  RuntimeBusyError,
  RuntimeManager,
  runtimeOptions,
} from "./runtime-manager.js";

interface RunBody {
  prompt?: unknown;
}

export interface AppOptions {
  runtime?: RuntimeManager;
  events?: EventStore;
  logger?: boolean;
  enableMockProvider?: boolean;
  maxPromptLength?: number;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  const runtime = options.runtime ?? new RuntimeManager(runtimeOptions());
  const events =
    options.events ??
    new EventStore(
      process.env.DSH_PLUGIN_EVENT_FILE ?? "/tmp/dsh-plugin-events.jsonl",
      positiveInteger(process.env.DSH_EVENT_LIMIT, 500),
    );
  const mock: MockState = {
    requests: 0,
    toolCalls: 0,
    agentRequestIntercepted: false,
    toolResultIntercepted: false,
  };
  const maxPromptLength =
    options.maxPromptLength ??
    positiveInteger(process.env.DSH_MAX_PROMPT_LENGTH, 20_000);

  if (
    options.enableMockProvider ??
    process.env.ENABLE_MOCK_PROVIDER === "true"
  ) {
    registerMockProvider(app, mock);
  }

  app.get("/", async () => ({
    demo: "09-plugin-events",
    endpoints: [
      "GET /health",
      "GET /runtime",
      "POST /runtime/start",
      "POST /runtime/stop",
      "POST /runs",
      "GET /events",
      "GET /mock-state",
    ],
  }));

  app.get("/health", async () => ({
    status: "ok",
    runtime: runtime.status(),
  }));
  app.get("/runtime", async () => runtime.status());

  app.post("/runtime/start", async (request, reply) => {
    try {
      return await runtime.start();
    } catch (error) {
      request.log.error({ error }, "runtime start failed");
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });

  app.post("/runtime/stop", async (_request, reply) => {
    try {
      return await runtime.stop();
    } catch (error) {
      if (error instanceof RuntimeBusyError) {
        return reply.code(409).send({ error: error.message });
      }
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });

  app.post<{ Body: RunBody }>("/runs", async (request, reply) => {
    const prompt = request.body?.prompt;
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      return reply
        .code(400)
        .send({ error: "prompt must be a non-empty string" });
    }
    if (prompt.trim().length > maxPromptLength) {
      return reply.code(400).send({
        error: `prompt must contain at most ${maxPromptLength} characters`,
      });
    }

    try {
      await events.reset();
      const sessionId = randomUUID();
      const result = await runtime.run(
        prompt.trim(),
        sessionId,
        (notification) =>
          events.addSdk(notification.method, notification.params),
      );
      await events.syncPlugin();
      return {
        sessionId,
        finalResponse: result.finalResponse,
        counts: events.counts(),
        assertions: assertions(events, mock),
        events: events.list(),
      };
    } catch (error) {
      if (error instanceof RuntimeBusyError) {
        return reply.code(409).send({ error: error.message });
      }
      request.log.error({ error }, "run failed");
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });

  app.get("/events", async () => {
    await events.syncPlugin();
    return { counts: events.counts(), events: events.list() };
  });
  app.get("/mock-state", async () => ({ ...mock }));
  app.addHook("onClose", async () => runtime.close());
  return app;
}

function assertions(events: EventStore, mock: MockState) {
  const list = events.list();
  const has = (hook: string, phase: string) =>
    list.some((event) => event.hook === hook && event.phase === phase);
  return {
    agentObserved: has("agent/status", "observed"),
    agentIntercepted:
      has("agent/request", "intercepted") && mock.agentRequestIntercepted,
    llmIntercepted: has("llm/stream", "intercepted"),
    toolObserved: has("tools/result", "observed"),
    toolIntercepted:
      has("tools/post-execute", "intercepted") &&
      mock.toolResultIntercepted &&
      mock.toolCalls === 1,
    sdkSessionEvents: list.some(
      (event) =>
        event.source === "sdk" && event.data.method === "session.event",
    ),
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
