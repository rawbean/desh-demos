import { randomUUID } from "node:crypto";
import { access, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { MockObservationStore, registerMockProvider } from "./mock-provider.js";
import {
  RuntimeBusyError,
  RuntimeManager,
  type RuntimeStatus,
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
    registerMockProvider(app, mockStore, runtime.workspace);
  }

  app.get("/", async () => ({
    demo: "12-workspace-sandbox",
    sdkVersion: "0.1.2-alpha.2",
    port: 3012,
    policyBoundary:
      "DSH fs is a trusted-code path policy fence, not a kernel boundary",
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

    const insidePath = join(runtime.workspace, "inside-proof.txt");
    await rm(insidePath, { force: true });
    const sessionId = request.body.sessionId ?? randomUUID();
    try {
      const { result, notifications } = await runtime.run(
        prompt.trim(),
        sessionId,
      );
      const eventText = JSON.stringify(result.events);
      const insideContent = await readFile(insidePath, "utf8").catch(
        () => null,
      );
      const outsideExists = await access(
        "/etc/dsh-demo-12-outside-proof.txt",
      ).then(
        () => true,
        () => false,
      );
      return {
        sessionId: result.sessionId,
        finalResponse: result.finalResponse,
        eventCount: result.events.length,
        eventTypes: result.events.map((event) => event.type),
        toolEvents: result.events.filter(
          (event) => event.type === "tool/call" || event.type === "tool/result",
        ),
        sdkProof: {
          toolCalls: result.events.filter((event) => event.type === "tool/call")
            .length,
          toolResults: result.events.filter(
            (event) => event.type === "tool/result",
          ).length,
          workspaceWrite: eventText.includes("Created file"),
          outsideDenied: eventText.includes(
            "[sandbox: file access denied under workspace-write mode]",
          ),
          shellDenied: eventText.includes(
            "demo policy denies Shell by default",
          ),
          networkToolDenied: eventText.includes(
            "demo policy denies network tools by default",
          ),
        },
        artifactProof: {
          insidePath,
          insideContent,
          outsidePath: "/etc/dsh-demo-12-outside-proof.txt",
          outsideExists,
        },
        notificationCount: notifications.length,
        mockObservation: mockStore.latest(),
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
  const dshHome = process.env.DSH_HOME ?? "/tmp/dsh-demo-12-home";
  const workspace = process.env.DSH_WORKSPACE ?? "/tmp/dsh-demo-12-workspace";
  process.env.DSH_PERMISSION_MODE = "workspace-write";
  return new RuntimeManager(
    {
      profile: process.env.DSH_PROFILE ?? "sdk",
      provider: process.env.DSH_PROVIDER ?? "deepseek-official",
      model: process.env.DSH_MODEL ?? "deepseek-v4-flash",
      cwd: workspace,
      dshHome,
      maxTokens: positiveInteger(process.env.DSH_MAX_TOKENS, 768),
      initializeTimeoutMs: positiveInteger(
        process.env.DSH_INITIALIZE_TIMEOUT_MS,
        10_000,
      ),
    },
    dshHome,
    workspace,
  );
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

export type { RuntimeStatus };
