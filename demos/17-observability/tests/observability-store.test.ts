import { describe, expect, it } from "vitest";
import { ObservabilityStore } from "../src/observability-store.js";

describe("ObservabilityStore", () => {
  it("persists bounded events and aggregated metrics", () => {
    const store = new ObservabilityStore(":memory:", 4);
    store.createTask("task", "trace", "session", "2026-01-01T00:00:00Z");
    store.startTask("task", "2026-01-01T00:00:00Z");
    for (const category of [
      "agent",
      "model",
      "tool",
      "notification",
      "notification",
    ] as const) {
      store.addEvent("trace", category, `${category}/event`, "now");
    }
    store.addUsage("trace", 10, 5, 15);
    store.finishTask("task", "completed", "later", 23, null);

    expect(store.getEvents("trace", 4)).toHaveLength(4);
    expect(store.getMetrics("trace")).toMatchObject({
      durationMs: 23,
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      eventCount: 4,
    });
    store.close();
  });
});
