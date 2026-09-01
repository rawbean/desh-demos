import { describe, expect, it, vi } from "vitest";
import { RuntimeManager, type HarnessRuntime } from "../src/runtime-manager.js";

describe("RuntimeManager", () => {
  it("closes a harness that fails to initialize", async () => {
    const close = vi.fn(async () => undefined);
    const harness: HarnessRuntime = {
      start: vi.fn(async () => {
        throw new Error("initialization failed");
      }),
      run: vi.fn(),
      close,
    };
    const runtime = new RuntimeManager({}, () => harness);

    await expect(runtime.start()).rejects.toThrow("initialization failed");
    expect(close).toHaveBeenCalledOnce();
    expect(runtime.status()).toMatchObject({
      state: "failed",
      activeRuns: 0,
      lastError: "initialization failed",
    });
  });

  it("rejects ordinary stop while a run is active", async () => {
    let finish: (() => void) | undefined;
    const harness: HarnessRuntime = {
      start: vi.fn(async () => undefined),
      run: vi.fn(
        async (_prompt, options) =>
          await new Promise((resolve) => {
            finish = () =>
              resolve({
                sessionId: options.sessionId,
                finalResponse: "ok",
                events: [],
                notifications: [],
              });
          }),
      ),
      close: vi.fn(async () => undefined),
    };
    const runtime = new RuntimeManager({}, () => harness);
    const running = runtime.run("prompt", "session");
    await vi.waitFor(() => expect(runtime.status().activeRuns).toBe(1));

    await expect(runtime.stop()).rejects.toThrow("runtime has active runs");
    finish?.();
    await running;
    await runtime.stop();
    expect(harness.close).toHaveBeenCalledOnce();
  });
});
