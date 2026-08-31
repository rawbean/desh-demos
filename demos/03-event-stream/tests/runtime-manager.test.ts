import type { HarnessNotification } from "@deepseek-ai/dsh-sdk-client";
import { describe, expect, it, vi } from "vitest";
import {
  RuntimeBusyError,
  RuntimeManager,
  type HarnessRuntime,
} from "../src/runtime-manager.js";

function createHarness(
  run: HarnessRuntime["run"] = async (_input, options) => ({
    sessionId: options.sessionId,
    finalResponse: "ok",
    events: [],
    notifications: [],
  }),
): HarnessRuntime {
  return {
    start: vi.fn(async () => undefined),
    run: vi.fn(run),
    close: vi.fn(async () => undefined),
  };
}

describe("RuntimeManager", () => {
  it("starts once, streams a run, and closes the owned runtime", async () => {
    const notification: HarnessNotification = {
      method: "session.status",
      params: { sessionId: "session-1", status: "running" },
    };
    const harness = createHarness(async (_input, options) => {
      options.onNotification(notification);
      return {
        sessionId: options.sessionId,
        finalResponse: "ok",
        events: [],
        notifications: [notification],
      };
    });
    const manager = new RuntimeManager({}, () => harness);
    const observer = vi.fn();

    await manager.start();
    const result = await manager.run("prompt", "session-1", observer);
    await manager.close();

    expect(harness.start).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith(notification);
    expect(result.finalResponse).toBe("ok");
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(manager.status().state).toBe("stopped");
  });

  it("refuses a normal stop while a task is active", async () => {
    let finish = () => undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const harness = createHarness(async (_input, options) => {
      await pending;
      return {
        sessionId: options.sessionId,
        finalResponse: "ok",
        events: [],
        notifications: [],
      };
    });
    const manager = new RuntimeManager({}, () => harness);
    const run = manager.run("prompt", "session-1", () => undefined);

    await vi.waitFor(() => expect(manager.status().activeTasks).toBe(1));
    await expect(manager.stop()).rejects.toBeInstanceOf(RuntimeBusyError);
    finish();
    await run;
    await manager.stop();
  });
});
