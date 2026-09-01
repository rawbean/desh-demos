import Fastify, { type FastifyInstance } from "fastify";
import {
  harnessBaseOptions,
  ModelCatalog,
  UnknownModelRouteError,
} from "./model-config.js";
import { registerMockProvider } from "./mock-provider.js";
import {
  RuntimeBusyError,
  RuntimeManager,
  type RuntimeStatus,
} from "./runtime-manager.js";

interface PromptBody {
  prompt?: unknown;
}

interface ConfigBody {
  provider?: unknown;
  model?: unknown;
}

export interface AppOptions {
  catalog?: ModelCatalog;
  runtime?: RuntimeManager;
  maxPromptLength?: number;
  logger?: boolean;
  enableMockProvider?: boolean;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  const catalog = options.catalog ?? new ModelCatalog();
  const runtime =
    options.runtime ??
    new RuntimeManager(catalog.initial(), harnessBaseOptions());
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
    demo: "05-model-provider",
    endpoints: ["GET /health", "GET /config", "PUT /config", "POST /prompts"],
  }));

  app.get("/health", async () => ({
    status: "ok",
    runtime: runtime.status(),
  }));

  app.get("/config", async () => ({
    active: runtime.status(),
    available: catalog.list(),
  }));

  app.put<{ Body: ConfigBody }>("/config", async (request, reply) => {
    const provider = request.body?.provider;
    const model = request.body?.model;
    if (typeof provider !== "string" || typeof model !== "string") {
      return reply.code(400).send({
        error: "provider and model must both be strings",
      });
    }

    try {
      return await runtime.switchTo(catalog.resolve(provider, model));
    } catch (error) {
      if (error instanceof UnknownModelRouteError) {
        return reply.code(400).send({ error: error.message });
      }
      if (error instanceof RuntimeBusyError) {
        return reply.code(409).send({ error: error.message });
      }
      request.log.error({ error }, "provider/model switch failed");
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });

  app.post<{ Body: PromptBody }>("/prompts", async (request, reply) => {
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

    try {
      const result = await runtime.run(normalized);
      return {
        sessionId: result.sessionId,
        answer: result.finalResponse,
        runtime: runtime.status(),
      };
    } catch (error) {
      request.log.error({ error }, "prompt failed");
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });

  app.addHook("onClose", async () => {
    await runtime.close();
  });

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

export type { RuntimeStatus };
