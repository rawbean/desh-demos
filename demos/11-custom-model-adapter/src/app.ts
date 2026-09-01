import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { EventStore } from "./event-store.js";
import {
  MODEL,
  PROVIDER,
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
  maxPromptLength?: number;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  const runtime = options.runtime ?? new RuntimeManager(runtimeOptions());
  const eventFile =
    process.env.DSH_ADAPTER_EVENT_FILE ??
    "/tmp/dsh-custom-adapter-events.jsonl";
  const events =
    options.events ??
    new EventStore(
      eventFile,
      positiveInteger(process.env.DSH_EVENT_LIMIT, 500),
    );
  const maxPromptLength =
    options.maxPromptLength ??
    positiveInteger(process.env.DSH_MAX_PROMPT_LENGTH, 20_000);

  app.get("/", async () => ({
    demo: "11-custom-model-adapter",
    provider: PROVIDER,
    model: MODEL,
    endpoints: [
      "GET /health",
      "GET /runtime",
      "POST /runtime/start",
      "POST /runtime/stop",
      "POST /runs",
      "GET /events",
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
        (notification) => events.addSdk(notification),
      );
      const collected = await events.list();
      const adapterEvents = collected.filter(
        (event) => event.source === "runtime-adapter",
      );
      return {
        sessionId,
        provider: PROVIDER,
        model: MODEL,
        finalResponse: result.finalResponse,
        assertions: {
          adapterRegistered: adapterEvents.some(
            (event) => event.event === "registered",
          ),
          adapterStreamed: adapterEvents.some(
            (event) => event.event === "stream-start",
          ),
          adapterCompleted: adapterEvents.some(
            (event) => event.event === "stream-complete",
          ),
          sdkNotified: collected.some((event) => event.source === "sdk"),
        },
        events: collected,
      };
    } catch (error) {
      if (error instanceof RuntimeBusyError) {
        return reply.code(409).send({ error: error.message });
      }
      request.log.error({ error }, "run failed");
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });

  app.get("/events", async () => ({ events: await events.list() }));
  app.addHook("onClose", async () => runtime.close());
  return app;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
