import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { processExists, readMcpEvents } from "./mcp-events.js";
import { MockObservationStore, registerMockProvider } from "./mock-provider.js";
import {
  createRuntime,
  PUBLIC_TOOL_NAME,
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
  let prepared = false;

  if (
    options.enableMockProvider ??
    process.env.ENABLE_MOCK_PROVIDER === "true"
  ) {
    registerMockProvider(app, mockStore);
  }

  app.get("/", async () => ({
    demo: "15-mcp-integration",
    transport: "stdio",
    expectedTool: PUBLIC_TOOL_NAME,
    sdkVersion: "0.1.2-alpha.2",
    endpoints: [
      "GET /health",
      "GET /runtime",
      "GET /mcp-events",
      "POST /runtime/start",
      "POST /runtime/stop",
      "POST /runs",
    ],
  }));

  app.get("/health", async () => ({ status: "ok", runtime: runtime.status() }));
  app.get("/runtime", async () => runtime.status());
  app.get("/mcp-events", async () => ({
    events: await readMcpEvents(runtime.mcpEventFile),
  }));

  app.post("/runtime/start", async (_request, reply) => {
    try {
      await prepareEventFile();
      return await runtime.start();
    } catch (error) {
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });

  app.post("/runtime/stop", async (_request, reply) => {
    try {
      const eventsBefore = await readMcpEvents(runtime.mcpEventFile);
      const childPid = eventsBefore.find(
        (event) => event.event === "started",
      )?.pid;
      const status = await runtime.stop();
      const childCleaned =
        childPid === undefined ? true : await waitForExit(childPid, 2_000);
      return {
        ...status,
        childPid: childPid ?? null,
        childCleaned,
        mcpEvents: await readMcpEvents(runtime.mcpEventFile),
      };
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
      await prepareEventFile();
      mockStore.reset();
      const sessionId = request.body.sessionId ?? randomUUID();
      const { result, notifications } = await runtime.run(
        prompt.trim(),
        sessionId,
      );
      const mcpEvents = await readMcpEvents(runtime.mcpEventFile);
      const eventTypes = result.events.map((event) => event.type);
      const finalResponseInSdkEvents = result.events.some((event) =>
        JSON.stringify(event).includes(result.finalResponse),
      );
      return {
        sessionId: result.sessionId,
        finalResponse: result.finalResponse,
        expectedTool: PUBLIC_TOOL_NAME,
        eventTypes,
        toolEvents: result.events.filter(
          (event) => event.type === "tool/call" || event.type === "tool/result",
        ),
        notificationCount: notifications.length,
        mockObservation: mockStore.latest(),
        mcpEvents,
        sdkProof: {
          discovered:
            mockStore.latest().discoveredNamespacedTool &&
            mcpEvents.some((event) => event.event === "tools-listed"),
          toolCall: eventTypes.includes("tool/call"),
          toolResult: eventTypes.includes("tool/result"),
          finalAnswer: finalResponseInSdkEvents,
        },
      };
    } catch (error) {
      request.log.error({ error }, "run failed");
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });

  app.addHook("onClose", async () => runtime.close());
  return app;

  async function prepareEventFile(): Promise<void> {
    if (prepared || runtime.status().state === "running") return;
    await rm(runtime.mcpEventFile, { force: true });
    prepared = true;
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !processExists(pid);
}

function handleRuntimeError(error: unknown, reply: FastifyReply) {
  if (error instanceof RuntimeBusyError) {
    return reply.code(409).send({ error: error.message });
  }
  return reply.code(502).send({ error: errorMessage(error) });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
