import Fastify, { type FastifyInstance } from "fastify";
import { registerMockProvider } from "./mock-provider.js";
import {
  RuntimeBusyError,
  RuntimeManager,
  type RuntimeStatus,
} from "./runtime-manager.js";
import {
  TaskNotFoundError,
  TaskStreamService,
  type TaskSubmission,
} from "./task-stream.js";

interface TaskBody {
  prompt?: unknown;
}

interface TaskParams {
  taskId: string;
}

interface EventQuery {
  after?: string;
}

export interface AppOptions {
  runtime?: RuntimeManager;
  maxPromptLength?: number;
  eventHistoryLimit?: number;
  heartbeatMs?: number;
  logger?: boolean;
  enableMockProvider?: boolean;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  const runtime = options.runtime ?? new RuntimeManager(runtimeOptions());
  const tasks = new TaskStreamService(
    runtime,
    options.eventHistoryLimit ??
      positiveInteger(process.env.DSH_EVENT_HISTORY_LIMIT, 1000),
  );
  const maxPromptLength =
    options.maxPromptLength ??
    positiveInteger(process.env.DSH_MAX_PROMPT_LENGTH, 20_000);
  const heartbeatMs =
    options.heartbeatMs ??
    positiveInteger(process.env.DSH_SSE_HEARTBEAT_MS, 15_000);

  if (
    options.enableMockProvider ??
    process.env.ENABLE_MOCK_PROVIDER === "true"
  ) {
    registerMockProvider(app);
  }

  app.get("/", async () => ({
    demo: "03-event-stream",
    endpoints: [
      "GET /health",
      "GET /runtime",
      "POST /runtime/start",
      "POST /runtime/stop",
      "POST /tasks",
      "GET /tasks/:taskId",
      "GET /tasks/:taskId/events",
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

  app.post("/runtime/stop", async (request, reply) => {
    try {
      return await runtime.stop();
    } catch (error) {
      if (error instanceof RuntimeBusyError) {
        return reply.code(409).send({ error: error.message });
      }
      request.log.error({ error }, "runtime stop failed");
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });

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

    const submission: TaskSubmission = tasks.submit(normalized);
    return reply.code(202).send(submission);
  });

  app.get<{ Params: TaskParams }>("/tasks/:taskId", async (request, reply) => {
    try {
      return tasks.get(request.params.taskId);
    } catch (error) {
      if (error instanceof TaskNotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get<{ Params: TaskParams; Querystring: EventQuery }>(
    "/tasks/:taskId/events",
    async (request, reply) => {
      const afterEventId = parseEventId(
        request.query.after ?? request.headers["last-event-id"],
      );
      if (afterEventId === undefined) {
        return reply.code(400).send({
          error: "after/Last-Event-ID must be a non-negative integer",
        });
      }
      try {
        tasks.get(request.params.taskId);
      } catch (error) {
        if (error instanceof TaskNotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        throw error;
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      reply.raw.write("retry: 2000\n\n");

      let closed = false;
      let subscribed = false;
      let terminalSeen = false;
      let unsubscribe: () => void = () => undefined;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
      };
      const writeEvent = (event: {
        id: number;
        category: string;
        type: string;
      }) => {
        if (closed || reply.raw.destroyed) return;
        reply.raw.write(`id: ${event.id}\n`);
        reply.raw.write(`event: ${event.category}\n`);
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === "task.completed" || event.type === "task.failed") {
          terminalSeen = true;
          if (subscribed) {
            cleanup();
            reply.raw.end();
          }
        }
      };
      const heartbeat = setInterval(() => {
        if (!closed && !reply.raw.destroyed) {
          reply.raw.write(`: heartbeat ${Date.now()}\n\n`);
        }
      }, heartbeatMs);
      heartbeat.unref();

      try {
        const subscription = tasks.subscribe(
          request.params.taskId,
          afterEventId,
          writeEvent,
        );
        unsubscribe = subscription.unsubscribe;
        subscribed = true;
        if (
          terminalSeen ||
          subscription.snapshot.state === "completed" ||
          subscription.snapshot.state === "failed"
        ) {
          cleanup();
          reply.raw.end();
        }
      } catch (error) {
        cleanup();
        reply.raw.end();
        throw error;
      }

      if (!closed) {
        request.raw.socket.once("close", cleanup);
        reply.raw.once("close", cleanup);
      }
    },
  );

  app.addHook("onClose", async () => {
    await runtime.close();
  });

  return app;
}

function runtimeOptions() {
  return {
    profile: process.env.DSH_PROFILE ?? "sdk",
    provider: process.env.DSH_PROVIDER ?? "deepseek-official",
    model: process.env.DSH_MODEL ?? "deepseek-v4-flash",
    cwd: process.env.DSH_WORKSPACE ?? process.cwd(),
    dshHome: process.env.DSH_HOME ?? "/tmp/dsh-home",
    maxTokens: positiveInteger(process.env.DSH_MAX_TOKENS, 2048),
    initializeTimeoutMs: positiveInteger(
      process.env.DSH_INITIALIZE_TIMEOUT_MS,
      10_000,
    ),
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseEventId(
  value: string | string[] | undefined,
): number | undefined {
  if (value === undefined) return 0;
  if (Array.isArray(value) || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { RuntimeStatus };
