import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { DeepSeekHarnessOptions } from "@deepseek-ai/dsh-sdk-client";
import { registerMockProvider } from "./mock-provider.js";
import {
  RuntimeCrashTimeoutError,
  RuntimeManager,
  RuntimeUnavailableError,
} from "./runtime-manager.js";
import {
  SessionBusyError,
  SessionManager,
  SessionManagerClosedError,
  SessionNotFoundError,
  SessionTerminatedError,
} from "./session-manager.js";

interface TurnBody {
  prompt?: unknown;
  expectedResponse?: unknown;
}

export interface BuildAppOptions {
  harnessOptions?: DeepSeekHarnessOptions;
  runtime?: RuntimeManager;
  manager?: SessionManager;
  logger?: boolean;
  enableMockProvider?: boolean;
  enableCrashEndpoint?: boolean;
  crashToken?: string;
}

export interface RecoveryApp extends FastifyInstance {
  recoveryRuntime: RuntimeManager;
}

export function buildApp(options: BuildAppOptions = {}): RecoveryApp {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 64 * 1024,
  }) as unknown as RecoveryApp;
  const runtime =
    options.runtime ?? new RuntimeManager(options.harnessOptions ?? {});
  const manager = options.manager ?? new SessionManager(runtime);
  app.recoveryRuntime = runtime;

  if (options.enableMockProvider) registerMockProvider(app);

  app.get("/", async () => ({
    demo: "18-runtime-recovery",
    endpoints: [
      "GET /health",
      "GET /runtime",
      "POST /runtime/crash (test-only, protected)",
      "POST /recover",
      "GET /recover/status",
      "GET /sessions",
      "POST /sessions",
      "GET /sessions/:id",
      "POST /sessions/:id/turns",
      "DELETE /sessions/:id",
    ],
  }));

  app.get("/health", async () => ({
    status: runtime.status().state === "running" ? "ok" : "degraded",
    runtime: runtime.status(),
  }));

  app.get("/runtime", async () => runtime.status());
  app.get("/recover/status", async () => manager.recoveryStatus());

  app.post("/recover", async (_request, reply) => {
    try {
      return await runtime.recover();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  if (options.enableCrashEndpoint) {
    app.post("/runtime/crash", async (request, reply) => {
      if (
        !options.crashToken ||
        request.headers["x-runtime-crash-token"] !== options.crashToken
      ) {
        return reply.code(403).send({ error: "invalid runtime crash token" });
      }
      try {
        return await runtime.crashForTest();
      } catch (error) {
        return sendError(reply, error);
      }
    });
  }

  app.get("/sessions", async () => ({ sessions: manager.list() }));

  app.post("/sessions", async (_request, reply) => {
    try {
      return reply.code(201).send(manager.create());
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>(
    "/sessions/:id",
    async (request, reply) => {
      try {
        return manager.get(request.params.id);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: TurnBody }>(
    "/sessions/:id/turns",
    async (request, reply) => {
      const prompt = request.body?.prompt;
      const expectedResponse = request.body?.expectedResponse;
      if (typeof prompt !== "string" || prompt.trim().length === 0) {
        return reply
          .code(400)
          .send({ error: "prompt must be a non-empty string" });
      }
      if (
        expectedResponse !== undefined &&
        typeof expectedResponse !== "string"
      ) {
        return reply
          .code(400)
          .send({ error: "expectedResponse must be a string when provided" });
      }
      try {
        return await manager.continue(
          request.params.id,
          prompt,
          expectedResponse as string | undefined,
        );
      } catch (error) {
        request.log.error({ error }, "session turn failed");
        return sendError(reply, error);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/sessions/:id",
    async (request, reply) => {
      try {
        return manager.terminate(request.params.id);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.addHook("onClose", async () => {
    await manager.close();
  });

  return app;
}

function sendError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof SessionNotFoundError) {
    return reply.code(404).send({ error: message });
  }
  if (
    error instanceof SessionBusyError ||
    error instanceof SessionTerminatedError
  ) {
    return reply.code(409).send({ error: message });
  }
  if (
    error instanceof RuntimeUnavailableError ||
    error instanceof SessionManagerClosedError
  ) {
    return reply.code(503).send({ error: message });
  }
  if (error instanceof RuntimeCrashTimeoutError) {
    return reply.code(504).send({ error: message });
  }
  return reply.code(502).send({ error: message });
}
