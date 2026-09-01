import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { MockObservationStore, registerMockProvider } from "./mock-provider.js";
import {
  projectRoot,
  RuntimeBusyError,
  RuntimeManager,
} from "./runtime-manager.js";

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
    demo: "14-skill-loading",
    sdkVersion: "0.1.2-alpha.2",
    cordisVersion: "4.0.2",
    skillPackages: [
      "@deepseek-ai/dsh-skill",
      "@deepseek-ai/dsh-skill-filesystem",
      "@deepseek-ai/dsh-tool-skill",
    ],
    endpoints: [
      "GET /health",
      "GET /runtime",
      "POST /runtime/start",
      "POST /runtime/stop",
      "POST /runs",
    ],
  }));

  app.get("/health", async () => ({ status: "ok", runtime: runtime.status() }));
  app.get("/runtime", async () => runtime.status());

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
      (typeof request.body.sessionId !== "string" ||
        request.body.sessionId.length === 0)
    ) {
      return reply
        .code(400)
        .send({ error: "sessionId must be a non-empty string" });
    }

    try {
      const { result, notifications } = await runtime.run(
        prompt.trim(),
        request.body.sessionId ?? randomUUID(),
      );
      const toolEvents = result.events.filter(
        (event) => event.type === "tool/call" || event.type === "tool/result",
      );
      const observation = mockStore.latest();
      return {
        sessionId: result.sessionId,
        finalResponse: result.finalResponse,
        eventCount: result.events.length,
        eventTypes: result.events.map((event) => event.type),
        toolEvents,
        notificationCount: notifications.length,
        mockObservation: observation,
        sdkProof: {
          toolCall: toolEvents.some((event) => event.type === "tool/call"),
          toolResult: toolEvents.some((event) => event.type === "tool/result"),
          discoveredFromDirectory: observation.sawDiscoveredCatalog,
          loadedSkillBody: observation.sawLoadedBody,
          deterministicInstructionApplied:
            result.finalResponse === "SKILL_LOADED_VERDICT_314159",
        },
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
  const dshHome = process.env.DSH_HOME ?? "/tmp/dsh-demo-14-home";
  return new RuntimeManager(
    {
      profile: process.env.DSH_PROFILE ?? "sdk",
      provider: process.env.DSH_PROVIDER ?? "deepseek-official",
      model: process.env.DSH_MODEL ?? "deepseek-v4-flash",
      cwd: process.env.DSH_WORKSPACE ?? joinWorkspace(),
      dshHome,
      maxTokens: positiveInteger(process.env.DSH_MAX_TOKENS, 256),
      initializeTimeoutMs: positiveInteger(
        process.env.DSH_INITIALIZE_TIMEOUT_MS,
        10_000,
      ),
    },
    dshHome,
  );
}

function joinWorkspace(): string {
  return `${projectRoot}/workspace`;
}

function handleRuntimeError(error: unknown, reply: FastifyReply) {
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
