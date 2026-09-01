import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { listCompositions } from "./compositions.js";
import { MockObservationStore, registerMockProvider } from "./mock-provider.js";
import {
  RuntimeBusyError,
  RuntimeManager,
  UnknownCompositionError,
} from "./runtime-manager.js";

interface CompositionBody {
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
  mockStore?: MockObservationStore;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  const runtime = options.runtime ?? createRuntime();
  const mockStore = options.mockStore ?? new MockObservationStore();

  if (
    options.enableMockProvider ??
    process.env.ENABLE_MOCK_PROVIDER === "true"
  ) {
    registerMockProvider(app, mockStore);
  }

  app.get("/", async () => ({
    demo: "06-cordis-composition",
    sdkVersion: "0.1.2-alpha.2",
    endpoints: [
      "GET /health",
      "GET /compositions",
      "GET /composition",
      "PUT /composition",
      "POST /runtime/start",
      "POST /runtime/stop",
      "POST /runs",
    ],
  }));

  app.get("/health", async () => ({ status: "ok", runtime: runtime.status() }));
  app.get("/compositions", async () => ({ compositions: listCompositions() }));
  app.get("/composition", async () => runtime.status());

  app.put<{ Body: CompositionBody }>("/composition", async (request, reply) => {
    if (typeof request.body?.id !== "string") {
      return reply.code(400).send({ error: "id must be a string" });
    }
    try {
      return await runtime.configure(request.body.id);
    } catch (error) {
      return handleRuntimeError(error, reply);
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
      return handleRuntimeError(error, reply);
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
    const sessionId = request.body.sessionId ?? randomUUID();
    try {
      const result = await runtime.run(prompt.trim(), sessionId);
      return {
        sessionId: result.sessionId,
        finalResponse: result.finalResponse,
        eventCount: result.events.length,
        composition: runtime.status().composition.id,
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
  return new RuntimeManager(process.env.DEFAULT_COMPOSITION ?? "focused", {
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

function handleRuntimeError(error: unknown, reply: FastifyReply) {
  if (error instanceof UnknownCompositionError) {
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
