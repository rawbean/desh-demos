import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { MockStore, registerMockProvider } from "./mock-provider.js";
import { listPlugins } from "./plugin-definitions.js";
import {
  RuntimeBusyError,
  RuntimeManager,
  UnknownPluginError,
} from "./runtime-manager.js";

interface PluginBody {
  id?: unknown;
}

interface RunBody {
  prompt?: unknown;
  sessionId?: unknown;
}

export interface AppOptions {
  runtime?: RuntimeManager;
  logger?: boolean;
  enableMockProvider?: boolean;
  mockStore?: MockStore;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  const runtime = options.runtime ?? createRuntime();
  const mockStore = options.mockStore ?? new MockStore();

  if (
    options.enableMockProvider ??
    process.env.ENABLE_MOCK_PROVIDER === "true"
  ) {
    registerMockProvider(app, mockStore);
  }

  app.get("/", async () => ({
    demo: "07-plugin-lifecycle",
    sdkVersion: "0.1.2-alpha.2",
    cordisVersion: "4.0.2",
    endpoints: [
      "GET /health",
      "GET /plugins",
      "GET /plugin",
      "PUT /plugin",
      "POST /runtime/start",
      "POST /runtime/stop",
      "POST /runs",
    ],
  }));
  app.get("/health", async () => ({ status: "ok", runtime: runtime.status() }));
  app.get("/plugins", async () => ({ plugins: listPlugins() }));
  app.get("/plugin", async () => runtime.status());

  app.put<{ Body: PluginBody }>("/plugin", async (request, reply) => {
    if (typeof request.body?.id !== "string") {
      return reply.code(400).send({ error: "id must be a string" });
    }
    try {
      return await runtime.switchTo(request.body.id);
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post("/runtime/start", async (_request, reply) => {
    try {
      return await runtime.start();
    } catch (error) {
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });

  app.post("/runtime/stop", async (_request, reply) => {
    try {
      return await runtime.stop();
    } catch (error) {
      return handleError(error, reply);
    }
  });

  app.post<{ Body: RunBody }>("/runs", async (request, reply) => {
    const prompt = request.body?.prompt;
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      return reply
        .code(400)
        .send({ error: "prompt must be a non-empty string" });
    }
    if (
      request.body.sessionId !== undefined &&
      typeof request.body.sessionId !== "string"
    ) {
      return reply.code(400).send({ error: "sessionId must be a string" });
    }
    try {
      const result = await runtime.run(
        prompt.trim(),
        request.body.sessionId ?? randomUUID(),
      );
      return {
        sessionId: result.sessionId,
        finalResponse: result.finalResponse,
        eventCount: result.events.length,
        plugin: runtime.status().plugin.id,
        mockObservation: mockStore.latest() ?? null,
      };
    } catch (error) {
      request.log.error({ error }, "run failed");
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });

  app.addHook("onClose", async () => runtime.close());
  return app;
}

function createRuntime(): RuntimeManager {
  return new RuntimeManager(process.env.DEFAULT_PLUGIN ?? "observer", {
    provider: process.env.DSH_PROVIDER ?? "deepseek-official",
    model: process.env.DSH_MODEL ?? "deepseek-v4-flash",
    cwd: process.env.DSH_WORKSPACE ?? process.cwd(),
    dshHome: process.env.DSH_HOME ?? "/tmp/dsh-home",
    maxTokens: positiveInteger(process.env.DSH_MAX_TOKENS, 512),
    initializeTimeoutMs: positiveInteger(
      process.env.DSH_INITIALIZE_TIMEOUT_MS,
      10_000,
    ),
  });
}

function handleError(error: unknown, reply: FastifyReply) {
  if (error instanceof UnknownPluginError) {
    return reply.code(404).send({ error: error.message });
  }
  if (error instanceof RuntimeBusyError) {
    return reply.code(409).send({ error: error.message });
  }
  return reply.code(502).send({ error: errorMessage(error) });
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
