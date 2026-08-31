import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { RuntimeManager, type HarnessRuntime } from "../src/runtime-manager.js";

const apps: Array<ReturnType<typeof buildApp>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function createApp() {
  const harness: HarnessRuntime = {
    start: vi.fn(async () => undefined),
    run: vi.fn(async (_input, options) => {
      const notification = {
        method: "session.event",
        params: {
          sessionId: options.sessionId,
          event: {
            type: "assistant/message",
            seq: 1,
            time: Date.now(),
            data: {},
          },
        },
      };
      options.onNotification(notification);
      return {
        sessionId: options.sessionId,
        finalResponse: "event-stream-ok",
        events: [],
        notifications: [notification],
      };
    }),
    close: vi.fn(async () => undefined),
  };
  const runtime = new RuntimeManager({}, () => harness);
  const app = buildApp({
    runtime,
    maxPromptLength: 20,
    heartbeatMs: 60_000,
    logger: false,
  });
  apps.push(app);
  return app;
}

describe("control plane API", () => {
  it("validates task input before starting the runtime", async () => {
    const app = createApp();

    const empty = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { prompt: "   " },
    });
    const oversized = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { prompt: "x".repeat(21) },
    });

    expect(empty.statusCode).toBe(400);
    expect(oversized.statusCode).toBe(400);
  });

  it("submits a prompt and replays its events over SSE", async () => {
    const app = createApp();
    const accepted = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { prompt: "show events" },
    });
    const submission = accepted.json<{
      id: string;
      sessionId: string;
      eventsUrl: string;
    }>();

    expect(accepted.statusCode).toBe(202);
    await vi.waitFor(async () => {
      const status = await app.inject({
        method: "GET",
        url: `/tasks/${submission.id}`,
      });
      expect(status.json().state).toBe("completed");
    });

    const stream = await app.inject({
      method: "GET",
      url: submission.eventsUrl,
    });

    expect(stream.statusCode).toBe(200);
    expect(stream.headers["content-type"]).toContain("text/event-stream");
    expect(stream.body).toContain("event: model");
    expect(stream.body).toContain('"type":"task.completed"');
    expect(stream.body).toContain(submission.sessionId);
  });

  it("returns 404 for an unknown event stream", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "GET",
      url: "/tasks/unknown/events",
    });

    expect(response.statusCode).toBe(404);
  });
});
