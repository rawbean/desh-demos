import { describe, expect, it, vi } from "vitest";
import { RuntimeManager, type HarnessRuntime } from "../src/runtime-manager.js";

describe("RuntimeManager", () => {
  it("rebuilds a running startup-only profile when its patch changes", async () => {
    const instances: Array<{ close: ReturnType<typeof vi.fn> }> = [];
    const options: Array<{ profile?: string; patches?: string[] }> = [];
    const manager = new RuntimeManager(
      "focused",
      {},
      (receivedOptions): HarnessRuntime => {
        options.push(receivedOptions);
        const close = vi.fn(async () => undefined);
        instances.push({ close });
        return {
          start: vi.fn(async () => undefined),
          close,
          run: vi.fn(async (_prompt, runOptions) => ({
            sessionId: runOptions.sessionId,
            finalResponse: "ok",
            events: [],
            notifications: [],
          })),
        };
      },
    );

    await manager.start();
    const changed = await manager.configure("planner");

    expect(changed.rebuilt).toBe(true);
    expect(changed.generation).toBe(2);
    expect(instances[0]?.close).toHaveBeenCalledOnce();
    expect(options[0]?.patches?.[0]).toMatch(/focused\.patch\.yml$/);
    expect(options[1]?.patches?.[0]).toMatch(/planner\.patch\.yml$/);
  });

  it("does not rebuild for an idempotent configuration", async () => {
    const factory = vi.fn((): HarnessRuntime => ({
      start: async () => undefined,
      close: async () => undefined,
      run: async (_prompt, options) => ({
        sessionId: options.sessionId,
        finalResponse: "ok",
        events: [],
        notifications: [],
      }),
    }));
    const manager = new RuntimeManager("focused", {}, factory);
    await manager.start();

    const unchanged = await manager.configure("focused");

    expect(unchanged.rebuilt).toBe(false);
    expect(factory).toHaveBeenCalledOnce();
  });
});
