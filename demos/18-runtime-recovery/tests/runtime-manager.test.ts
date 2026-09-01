import { describe, expect, it, vi } from "vitest";
import {
  RuntimeManager,
  type RuntimeHarness,
  type RuntimeState,
} from "../src/runtime-manager.js";

function harness(
  options: {
    failStart?: boolean;
    deferredStart?: Promise<void>;
  } = {},
) {
  let crash: ((error: Error) => void) | undefined;
  const value: RuntimeHarness = {
    start: vi.fn(async () => {
      await options.deferredStart;
      if (options.failStart) throw new Error("start failed");
    }),
    run: vi.fn(async (_input, runOptions) => ({
      sessionId: runOptions.sessionId ?? "missing",
      finalResponse: "ok",
      events: [],
      notifications: [],
    })),
    close: vi.fn(async () => undefined),
    watchCrash: vi.fn((listener) => {
      crash = listener;
      return () => {
        crash = undefined;
      };
    }),
    crashForTest: vi.fn(() => {
      queueMicrotask(() => crash?.(new Error("transport closed")));
      return true;
    }),
  };
  return value;
}

describe("RuntimeManager", () => {
  it("moves running -> crashed -> recovering -> running with a fresh harness", async () => {
    const instances = [harness(), harness()];
    const states: RuntimeState[] = [];
    const manager = new RuntimeManager({ dshHome: "/same/home" }, () =>
      instances.shift()!,
    );
    manager.onStateChange((status) => states.push(status.state));

    await manager.start();
    await manager.crashForTest();
    const recovered = await manager.recover();

    expect(recovered).toMatchObject({
      state: "running",
      recoveryGeneration: 1,
    });
    expect(states).toEqual([
      "starting",
      "running",
      "crashed",
      "recovering",
      "running",
    ]);
  });

  it("ends failed when the replacement runtime cannot start", async () => {
    const instances = [harness(), harness({ failStart: true })];
    const manager = new RuntimeManager({}, () => instances.shift()!);
    await manager.start();
    await manager.crashForTest();

    await expect(manager.recover()).rejects.toThrow("start failed");
    expect(manager.status()).toMatchObject({
      state: "failed",
      recoveryGeneration: 1,
      lastError: "start failed",
    });
  });

  it("coalesces concurrent recovery calls into one replacement", async () => {
    let release!: () => void;
    const deferred = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = harness();
    const second = harness({ deferredStart: deferred });
    const factory = vi
      .fn<() => RuntimeHarness>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const manager = new RuntimeManager({}, factory);
    await manager.start();
    await manager.crashForTest();

    const recoveries = [
      manager.recover(),
      manager.recover(),
      manager.recover(),
    ];
    release();
    const statuses = await Promise.all(recoveries);

    expect(factory).toHaveBeenCalledTimes(2);
    expect(statuses.every((status) => status.state === "running")).toBe(true);
    expect(manager.status().recoveryGeneration).toBe(1);
  });
});
