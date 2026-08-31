import { describe, expect, it, vi } from "vitest";
import { RuntimeManager, type HarnessRuntime } from "../src/runtime-manager.js";
import { TaskStreamService } from "../src/task-stream.js";

function eventHarness(): HarnessRuntime {
  return {
    start: vi.fn(async () => undefined),
    run: vi.fn(async (_input, options) => {
      const notifications = [
        {
          method: "session.status",
          params: { sessionId: options.sessionId, status: "running" },
        },
        {
          method: "session.event",
          params: {
            sessionId: options.sessionId,
            event: {
              type: "assistant/chunk",
              seq: 1,
              time: Date.now(),
              data: {},
            },
          },
        },
        {
          method: "session.event",
          params: {
            sessionId: options.sessionId,
            event: {
              type: "tool/call",
              seq: 2,
              time: Date.now(),
              data: {},
            },
          },
        },
      ];
      for (const notification of notifications) {
        options.onNotification(notification);
      }
      return {
        sessionId: options.sessionId,
        finalResponse: "event-stream-ok",
        events: [],
        notifications,
      };
    }),
    close: vi.fn(async () => undefined),
  };
}

describe("TaskStreamService", () => {
  it("publishes categorized SDK notifications and a final task event", async () => {
    const runtime = new RuntimeManager({}, () => eventHarness());
    const service = new TaskStreamService(runtime);
    const submission = service.submit("show events");

    await vi.waitFor(() =>
      expect(service.get(submission.id).state).toBe("completed"),
    );
    const received: Array<{ category: string; type: string }> = [];
    const subscription = service.subscribe(submission.id, 0, (event) => {
      received.push(event);
    });

    expect(received).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "agent",
          type: "session.status",
        }),
        expect.objectContaining({
          category: "model",
          type: "assistant/chunk",
        }),
        expect.objectContaining({ category: "tool", type: "tool/call" }),
        expect.objectContaining({
          category: "notification",
          type: "task.completed",
        }),
      ]),
    );
    expect(subscription.snapshot.finalResponse).toBe("event-stream-ok");
    expect(service.subscriberCount(submission.id)).toBe(1);
    subscription.unsubscribe();
    expect(service.subscriberCount(submission.id)).toBe(0);
    await runtime.close();
  });

  it("replays only events newer than the requested SSE event id", async () => {
    const runtime = new RuntimeManager({}, () => eventHarness());
    const service = new TaskStreamService(runtime);
    const submission = service.submit("show events");

    await vi.waitFor(() =>
      expect(service.get(submission.id).state).toBe("completed"),
    );
    const all: number[] = [];
    service
      .subscribe(submission.id, 0, (event) => all.push(event.id))
      .unsubscribe();
    const resumed: number[] = [];
    service
      .subscribe(submission.id, all[2] ?? 0, (event) => resumed.push(event.id))
      .unsubscribe();

    expect(resumed.every((id) => id > (all[2] ?? 0))).toBe(true);
    expect(resumed.length).toBeGreaterThan(0);
    await runtime.close();
  });
});
