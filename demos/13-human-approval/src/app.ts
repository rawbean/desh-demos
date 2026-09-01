import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type {
  HarnessNotification,
  RunResult,
} from "@deepseek-ai/dsh-sdk-client";
import { MockObservationStore, registerMockProvider } from "./mock-provider.js";
import { createRuntime, RuntimeBusyError } from "./runtime-manager.js";
import type { RuntimeManager } from "./runtime-manager.js";

interface RunBody {
  prompt?: unknown;
}

interface PluginEvent {
  source: "runtime-plugin";
  event: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface AppOptions {
  runtime?: RuntimeManager;
  logger?: boolean;
  enableMockProvider?: boolean;
  mockStore?: MockObservationStore;
  eventFile?: string;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  const runtime = options.runtime ?? createRuntime();
  const mockStore = options.mockStore ?? new MockObservationStore();
  const eventFile =
    options.eventFile ??
    process.env.DSH_APPROVAL_EVENT_FILE ??
    "/tmp/dsh-human-approval-events.jsonl";

  if (
    options.enableMockProvider ??
    process.env.ENABLE_MOCK_PROVIDER === "true"
  ) {
    registerMockProvider(app, mockStore);
  }

  app.get("/", async () => ({
    demo: "13-human-approval",
    approvalMode: runtime.status().approvalMode,
    sdkVersion: "0.1.2-alpha.2",
    endpoints: [
      "GET /health",
      "GET /runtime",
      "POST /runtime/start",
      "POST /runtime/stop",
      "POST /runs",
      "GET /events",
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
    if (prompt.length > 20_000) {
      return reply
        .code(400)
        .send({ error: "prompt must contain at most 20000 characters" });
    }

    try {
      await writeFile(eventFile, "", { encoding: "utf8", mode: 0o600 });
      const notifications: HarnessNotification[] = [];
      const result = await runtime.run(
        prompt.trim(),
        randomUUID(),
        (notification) => notifications.push(notification),
      );
      const pluginEvents = await readPluginEvents(eventFile);
      return runResponse(
        result,
        notifications,
        pluginEvents,
        mockStore.latest(),
        runtime.status().approvalMode,
      );
    } catch (error) {
      if (error instanceof RuntimeBusyError) {
        return reply.code(409).send({ error: error.message });
      }
      request.log.error({ error }, "approval run failed");
      return reply.code(502).send({ error: errorMessage(error) });
    }
  });

  app.get("/events", async () => ({
    events: await readPluginEvents(eventFile),
  }));
  app.addHook("onClose", async () => runtime.close());
  return app;
}

function runResponse(
  result: RunResult,
  notifications: HarnessNotification[],
  pluginEvents: PluginEvent[],
  mockObservation: ReturnType<MockObservationStore["latest"]>,
  mode: "allow" | "reject",
) {
  const approvalEvents = result.events
    .filter(
      (event) =>
        event.type === "approval/asked" || event.type === "approval/decided",
    )
    .map((event) => ({ type: event.type, data: event.data }));
  const asked = approvalEvents.find((event) => event.type === "approval/asked");
  const decided = approvalEvents.find(
    (event) => event.type === "approval/decided",
  );
  const askedData: Record<string, unknown> = isRecord(asked?.data)
    ? asked.data
    : {};
  const decidedData: Record<string, unknown> = isRecord(decided?.data)
    ? decided.data
    : {};
  const expectedOutcome = mode === "allow" ? "allowed-once" : "rejected";
  const toolExecuted = pluginEvents.some(
    (event) => event.event === "high-risk-tool-executed",
  );

  return {
    sessionId: result.sessionId,
    approvalMode: mode,
    finalResponse: result.finalResponse,
    approvalEvents,
    pluginEvents,
    assertions: {
      sdkObservedAsked: asked !== undefined,
      sdkObservedDecided: decided !== undefined,
      auditPairMatches:
        typeof askedData.id === "string" && askedData.id === decidedData.id,
      expectedOutcome: decidedData.outcome === expectedOutcome,
      customAnswererRan: pluginEvents.some(
        (event) =>
          event.event === "answerer-decided" &&
          event.outcome === expectedOutcome,
      ),
      permissionPluginAvailable: pluginEvents.some(
        (event) =>
          event.event === "answerer-decided" &&
          typeof event.permissionPreset === "string",
      ),
      allowedExecution: mode === "allow" ? toolExecuted : !toolExecuted,
    },
    sdkNotifications: notifications.map(notificationSummary),
    mockObservation,
  };
}

async function readPluginEvents(file: string): Promise<PluginEvent[]> {
  try {
    return (await readFile(file, "utf8"))
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as PluginEvent];
        } catch {
          return [];
        }
      })
      .slice(-200);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}

function notificationSummary(
  notification: HarnessNotification,
): Record<string, unknown> {
  const event = isRecord(notification.params.event)
    ? notification.params.event
    : {};
  return {
    method: notification.method,
    eventType: typeof event.type === "string" ? event.type : undefined,
  };
}

function handleRuntimeError(error: unknown, reply: FastifyReply) {
  if (error instanceof RuntimeBusyError) {
    return reply.code(409).send({ error: error.message });
  }
  return reply.code(502).send({ error: errorMessage(error) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
