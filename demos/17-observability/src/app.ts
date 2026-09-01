import Fastify, { type FastifyInstance } from "fastify";
import { registerMockProvider } from "./mock-provider.js";
import { NotFoundError, ObservabilityStore } from "./observability-store.js";
import { RuntimeManager } from "./runtime-manager.js";
import { TaskService } from "./task-service.js";

interface TaskBody {
  prompt?: unknown;
}

interface IdParams {
  id: string;
}

interface EventQuery {
  limit?: string;
}

export interface AppOptions {
  runtime?: RuntimeManager;
  store?: ObservabilityStore;
  databasePath?: string;
  eventLimit?: number;
  maxPromptLength?: number;
  enableMockProvider?: boolean;
  logger?: boolean;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 64 * 1024,
  });
  const eventLimit = Math.min(
    options.eventLimit ?? positiveInteger(process.env.EVENT_LIMIT, 200),
    200,
  );
  const store =
    options.store ??
    new ObservabilityStore(
      options.databasePath ??
        process.env.OBSERVABILITY_DB ??
        "/tmp/observability/observability.db",
      eventLimit,
    );
  const runtime = options.runtime ?? new RuntimeManager(runtimeOptions());
  const tasks = new TaskService(runtime, store);
  const maxPromptLength =
    options.maxPromptLength ??
    positiveInteger(process.env.MAX_PROMPT_LENGTH, 20_000);

  if (
    options.enableMockProvider ??
    process.env.ENABLE_MOCK_PROVIDER === "true"
  ) {
    registerMockProvider(app);
  }

  app.get("/", async () => ({
    demo: "17-observability",
    endpoints: [
      "POST /tasks",
      "GET /tasks/:id",
      "GET /traces/:id",
      "GET /traces/:id/events",
      "GET /traces/:id/metrics",
    ],
  }));

  app.get("/health", async () => ({
    status: "ok",
    runtime: runtime.status(),
    database: "ready",
  }));

  app.post<{ Body: TaskBody }>("/tasks", async (request, reply) => {
    const prompt = request.body?.prompt;
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      return reply
        .code(400)
        .send({ error: "prompt must be a non-empty string" });
    }
    const normalized = prompt.trim();
    if (normalized.length > maxPromptLength) {
      return reply.code(400).send({
        error: `prompt must contain at most ${maxPromptLength} characters`,
      });
    }
    return reply.code(202).send(tasks.submit(normalized));
  });

  app.get<{ Params: IdParams }>("/tasks/:id", async (request, reply) => {
    try {
      return store.getTask(request.params.id);
    } catch (error) {
      return notFound(error, reply);
    }
  });

  app.get<{ Params: IdParams }>("/traces/:id", async (request, reply) => {
    try {
      return store.getTrace(request.params.id);
    } catch (error) {
      return notFound(error, reply);
    }
  });

  app.get<{ Params: IdParams; Querystring: EventQuery }>(
    "/traces/:id/events",
    async (request, reply) => {
      const limit = parseLimit(request.query.limit, eventLimit);
      if (limit === undefined) {
        return reply
          .code(400)
          .send({ error: `limit must be an integer from 1 to ${eventLimit}` });
      }
      try {
        return { events: store.getEvents(request.params.id, limit), limit };
      } catch (error) {
        return notFound(error, reply);
      }
    },
  );

  app.get<{ Params: IdParams }>(
    "/traces/:id/metrics",
    async (request, reply) => {
      try {
        return store.getMetrics(request.params.id);
      } catch (error) {
        return notFound(error, reply);
      }
    },
  );

  app.addHook("onClose", async () => {
    await runtime.close();
    store.close();
  });
  return app;
}

function runtimeOptions() {
  return {
    profile: process.env.DSH_PROFILE ?? "sdk",
    provider: process.env.DSH_PROVIDER ?? "deepseek-official",
    model: process.env.DSH_MODEL ?? "deepseek-v4-flash",
    cwd: process.env.DSH_WORKSPACE ?? process.cwd(),
    dshHome: dshHome(),
    maxTokens: positiveInteger(process.env.DSH_MAX_TOKENS, 2048),
    initializeTimeoutMs: positiveInteger(
      process.env.DSH_INITIALIZE_TIMEOUT_MS,
      10_000,
    ),
  };
}

function dshHome(): string {
  return process.env.DSH_HOME ?? "/tmp/dsh-home";
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseLimit(
  value: string | undefined,
  maximum: number,
): number | undefined {
  if (value === undefined) return Math.min(100, maximum);
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum
    ? parsed
    : undefined;
}

function notFound(
  error: unknown,
  reply: { code(status: number): { send(body: unknown): unknown } },
) {
  if (error instanceof NotFoundError) {
    return reply.code(404).send({ error: error.message });
  }
  throw error;
}
