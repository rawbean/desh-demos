import type { HarnessNotification } from "@deepseek-ai/dsh-sdk-client";
import { describe, expect, it } from "vitest";
import { NotificationObserver } from "../src/notification-observer.js";
import { ObservabilityStore } from "../src/observability-store.js";

describe("NotificationObserver", () => {
  it("classifies four categories and extracts usage without raw content", () => {
    const store = new ObservabilityStore(":memory:");
    store.createTask("task", "trace", "session", "now");
    const observer = new NotificationObserver(store, "trace");
    for (const type of [
      "turn/start",
      "assistant/message",
      "tool/call",
      "unknown/event",
    ]) {
      observer.observe(notification(type, type === "assistant/message"));
    }

    const events = store.getEvents("trace", 20);
    expect(new Set(events.map((event) => event.category))).toEqual(
      new Set(["agent", "model", "tool", "notification"]),
    );
    expect(JSON.stringify(events)).not.toContain("sensitive model content");
    expect(store.getMetrics("trace")).toMatchObject({
      promptTokens: 12,
      completionTokens: 3,
      totalTokens: 15,
    });
    store.close();
  });
});

function notification(type: string, withUsage: boolean): HarnessNotification {
  return {
    method: "session.event",
    params: {
      sessionId: "session",
      event: {
        type,
        content: "sensitive model content",
        ...(withUsage
          ? {
              usage: {
                prompt_tokens: 12,
                completion_tokens: 3,
                total_tokens: 15,
              },
            }
          : {}),
      },
    },
  } as HarnessNotification;
}
