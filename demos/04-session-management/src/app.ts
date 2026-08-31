import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { DeepSeekHarnessOptions } from "@deepseek-ai/dsh-sdk-client";
import { registerMockProvider } from "./mock-provider.js";
import {
  SessionBusyError,
  SessionManager,
  SessionManagerClosedError,
  SessionNotFoundError,
  SessionTerminatedError,
} from "./session-manager.js";

interface TurnBody {
  prompt?: unknown;
}

export interface BuildAppOptions {
  harnessOptions?: DeepSeekHarnessOptions;
  manager?: SessionManager;
  logger?: boolean;
  enableMockProvider?: boolean;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  const manager =
    options.manager ?? new SessionManager(options.harnessOptions ?? {});

  if (options.enableMockProvider) registerMockProvider(app);

  app.get("/", async () => ({
    demo: "04-session-management",
    endpoints: [
      "GET /health",
      "GET /sessions",
      "POST /sessions",
      "GET /sessions/:id",
      "POST /sessions/:id/turns",
      "DELETE /sessions/:id",
    ],
  }));

  app.get("/health", async () => ({ status: "ok" }));

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
      if (
        typeof request.body?.prompt !== "string" ||
        request.body.prompt.trim().length === 0
      ) {
        return reply
          .code(400)
          .send({ error: "prompt must be a non-empty string" });
      }

      try {
        return await manager.continue(request.params.id, request.body.prompt);
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
  if (error instanceof SessionManagerClosedError) {
    return reply.code(503).send({ error: message });
  }
  return reply.code(502).send({ error: message });
}
