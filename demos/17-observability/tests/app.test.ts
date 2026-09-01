import type {
  HarnessNotification,
  RunResult,
} from "@deepseek-ai/dsh-sdk-client";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { ObservabilityStore } from "../src/observability-store.js";
import type { RuntimeManager } from "../src/runtime-manager.js";
import { sanitizeError } from "../src/task-service.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("observability API", () => {
  it("redacts and bounds persisted errors", () => {
    const safe = sanitizeError(
      new Error(`Bearer abc123 api_key=top-secret ${"x".repeat(600)}`),
    );
    expect(safe).not.toContain("abc123");
    expect(safe).not.toContain("top-secret");
    expect(safe.length).toBeLessThanOrEqual(512);
  });

  it("exposes completed tasks, traces, events and metrics", async () => {
    const store = new ObservabilityStore(":memory:");
    const runtime = {
      status: () => ({ state: "running", activeRuns: 0 }),
      close: async () => undefined,
      run: async (
        _prompt: string,
        _sessionId: string,
        onNotification: (event: HarnessNotification) => void,
      ) => {
        for (const type of [
          "turn/start",
          "assistant/message",
          "tool/call",
          "other/event",
        ]) {
          onNotification({
            method: "session.event",
            params: {
              sessionId: "session",
              event: {
                type,
                usage:
                  type === "assistant/message"
                    ? {
                        prompt_tokens: 8,
                        completion_tokens: 2,
                        total_tokens: 10,
                      }
                    : undefined,
              },
            },
          } as HarnessNotification);
        }
        return { finalResponse: "not persisted" } as RunResult;
      },
    };
    const app = buildApp({
      runtime: runtime as unknown as RuntimeManager,
      store,
      logger: false,
    });
    apps.push(app);
    const submitted = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { prompt: "secret prompt" },
    });
    expect(submitted.statusCode).toBe(202);
    const ids = submitted.json<{ id: string; traceId: string }>();

    let task: { state: string; durationMs: number | null } | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      task = (
        await app.inject({ method: "GET", url: `/tasks/${ids.id}` })
      ).json();
      if (task?.state === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(task?.state).toBe("completed");
    expect(task?.durationMs).toBeGreaterThan(0);

    const events = (
      await app.inject({ url: `/traces/${ids.traceId}/events` })
    ).json<{ events: Array<{ category: string }> }>();
    expect(new Set(events.events.map((event) => event.category))).toEqual(
      new Set(["agent", "model", "tool", "notification"]),
    );
    expect(JSON.stringify(events)).not.toContain("secret prompt");

    const metrics = (
      await app.inject({ url: `/traces/${ids.traceId}/metrics` })
    ).json<{ totalTokens: number; durationMs: number }>();
    expect(metrics.totalTokens).toBe(10);
    expect(metrics.durationMs).toBeGreaterThan(0);
  });

  it("rejects invalid event limits", async () => {
    const app = buildApp({
      databasePath: ":memory:",
      eventLimit: 10,
      logger: false,
    });
    apps.push(app);
    expect(
      (await app.inject({ url: "/traces/missing/events?limit=11" })).statusCode,
    ).toBe(400);
  });
});
