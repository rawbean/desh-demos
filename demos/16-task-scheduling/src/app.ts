import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { registerMockProvider } from "./mock-provider.js";
import { createRuntime, RuntimeManager } from "./runtime-manager.js";
import {
  TaskNotFoundError,
  TaskScheduler,
  type SubmitOptions,
} from "./task-scheduler.js";

interface TaskBody {
  prompt?: unknown;
  timeoutMs?: unknown;
  maxAttempts?: unknown;
  retryDelayMs?: unknown;
}

interface TaskParams {
  taskId: string;
}

interface CancelQuery {
  forceRuntime?: string;
}

export interface AppOptions {
  runtime?: RuntimeManager;
  scheduler?: TaskScheduler;
  maxPromptLength?: number;
  logger?: boolean;
  enableMockProvider?: boolean;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  const runtime = options.runtime ?? createRuntime();
  const scheduler =
    options.scheduler ??
    new TaskScheduler(runtime, {
      concurrency: positiveInteger(process.env.DSH_QUEUE_CONCURRENCY, 2),
      defaultTimeoutMs: positiveInteger(
        process.env.DSH_TASK_TIMEOUT_MS,
        30_000,
      ),
      defaultMaxAttempts: positiveInteger(process.env.DSH_MAX_ATTEMPTS, 3),
      defaultRetryDelayMs: positiveInteger(process.env.DSH_RETRY_DELAY_MS, 100),
    });
  const maxPromptLength =
    options.maxPromptLength ??
    positiveInteger(process.env.DSH_MAX_PROMPT_LENGTH, 20_000);

  if (
    options.enableMockProvider ??
    process.env.ENABLE_MOCK_PROVIDER === "true"
  ) {
    registerMockProvider(app);
  }

  app.get("/", async () => ({
    demo: "16-task-scheduling",
    cancellation:
      "queued tasks are removed; running tasks are logically cancelled unless forceRuntime=true",
    endpoints: [
      "GET /health",
      "GET /runtime",
      "POST /runtime/start",
      "POST /runtime/stop",
      "GET /tasks",
      "POST /tasks",
      "GET /tasks/:taskId",
      "DELETE /tasks/:taskId",
    ],
  }));

  app.get("/health", async () => ({
    status: "ok",
    runtime: runtime.status(),
    queue: scheduler.status(),
  }));
  app.get("/runtime", async () => runtime.status());
  app.get("/tasks", async () => ({
    queue: scheduler.status(),
    tasks: scheduler.list(),
  }));

  app.post("/runtime/start", async (request, reply) => {
    try {
      return await runtime.start();
    } catch (error) {
      request.log.error({ error }, "runtime start failed");
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });

  app.post<{ Querystring: { force?: string } }>(
    "/runtime/stop",
    async (request, reply) => {
      try {
        return await runtime.stop(request.query.force === "true");
      } catch (error) {
        return reply.code(409).send({ error: errorMessage(error) });
      }
    },
  );

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
    const parsed = parseTaskOptions(request.body);
    if ("error" in parsed) return reply.code(400).send(parsed);
    try {
      const task = scheduler.submit(normalized, parsed.options);
      return reply.code(202).header("location", `/tasks/${task.id}`).send(task);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.get<{ Params: TaskParams }>("/tasks/:taskId", async (request, reply) => {
    try {
      return scheduler.get(request.params.taskId);
    } catch (error) {
      return handleTaskError(error, reply);
    }
  });

  app.delete<{ Params: TaskParams; Querystring: CancelQuery }>(
    "/tasks/:taskId",
    async (request, reply) => {
      if (
        request.query.forceRuntime !== undefined &&
        request.query.forceRuntime !== "true" &&
        request.query.forceRuntime !== "false"
      ) {
        return reply
          .code(400)
          .send({ error: "forceRuntime must be true or false" });
      }
      try {
        return await scheduler.cancel(
          request.params.taskId,
          request.query.forceRuntime === "true",
        );
      } catch (error) {
        if (error instanceof TaskNotFoundError) {
          return reply.code(404).send({ error: error.message });
        }
        return reply.code(502).send({ error: errorMessage(error) });
      }
    },
  );

  app.addHook("onClose", async () => {
    await scheduler.close();
    await runtime.close();
  });
  return app;
}

function parseTaskOptions(
  body: TaskBody,
): { options: SubmitOptions } | { error: string } {
  const options: SubmitOptions = {};
  for (const key of ["timeoutMs", "maxAttempts", "retryDelayMs"] as const) {
    const value = body[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || (value as number) <= 0) {
      return { error: `${key} must be a positive integer` };
    }
    options[key] = value as number;
  }
  return { options };
}

function handleTaskError(error: unknown, reply: FastifyReply) {
  if (error instanceof TaskNotFoundError) {
    return reply.code(404).send({ error: error.message });
  }
  throw error;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
