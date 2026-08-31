import type { HarnessNotification } from "@deepseek-ai/dsh-sdk-client";
import { describe, expect, it } from "vitest";
import { classifyNotification } from "../src/event-types.js";

function sessionEvent(type: string): HarnessNotification {
  return {
    method: "session.event",
    params: {
      sessionId: "session-1",
      event: { type, seq: 1, time: 1, data: {} },
    },
  };
}

describe("classifyNotification", () => {
  it.each([
    ["turn/start", "agent"],
    ["step/end", "agent"],
    ["request/header", "model"],
    ["assistant/chunk", "model"],
    ["tool/call", "tool"],
    ["tool/result", "tool"],
    ["user/message", "notification"],
  ] as const)("classifies %s as %s", (type, category) => {
    expect(classifyNotification(sessionEvent(type))).toEqual({
      category,
      type,
    });
  });

  it("classifies status and subagent notifications as agent events", () => {
    expect(
      classifyNotification({
        method: "session.status",
        params: { sessionId: "session-1", status: "running" },
      }),
    ).toEqual({ category: "agent", type: "session.status" });

    expect(
      classifyNotification({
        method: "subagent.started",
        params: {
          parentSessionId: "session-1",
          childSessionId: "session-2",
        },
      }),
    ).toEqual({ category: "agent", type: "subagent.started" });
  });
});
