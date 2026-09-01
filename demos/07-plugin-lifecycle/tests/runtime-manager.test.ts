import type {
  DeepSeekHarnessOptions,
  RunResult,
} from "@deepseek-ai/dsh-sdk-client";
import { describe, expect, it } from "vitest";
import { RuntimeManager, type HarnessRuntime } from "../src/runtime-manager.js";

describe("RuntimeManager", () => {
  it("rebuilds the SDK runtime and unloads local plugins on switch", async () => {
    const options: DeepSeekHarnessOptions[] = [];
    let closes = 0;
    const manager = new RuntimeManager("observer", {}, (value) => {
      options.push(value);
      return fakeHarness(() => {
        closes += 1;
      });
    });

    await manager.start();
    const switched = await manager.switchTo("enforcer");

    expect(switched).toMatchObject({
      rebuilt: true,
      generation: 2,
      plugin: { id: "enforcer" },
      cordis: { pluginId: "enforcer", generation: 2, injected: true },
    });
    expect(options.map((value) => value.patches?.[0])).toEqual([
      expect.stringContaining("observer.patch.yml"),
      expect.stringContaining("enforcer.patch.yml"),
    ]);
    expect(closes).toBe(1);
    expect(switched.lifecycle.map((event) => event.phase)).toContain(
      "provider-stop",
    );
    await manager.close();
  });

  it("unloads Cordis plugins when SDK shutdown fails", async () => {
    const manager = new RuntimeManager("observer", {}, () => ({
      ...fakeHarness(() => undefined),
      close: async () => {
        throw new Error("SDK close failed");
      },
    }));

    await manager.start();
    await expect(manager.close()).rejects.toThrow("SDK close failed");

    expect(manager.status()).toMatchObject({
      state: "stopped",
      cordis: null,
    });
    expect(manager.status().lifecycle.map((event) => event.phase)).toEqual([
      "provider-start",
      "consumer-start",
      "consumer-stop",
      "provider-stop",
    ]);
  });
});

function fakeHarness(onClose: () => void): HarnessRuntime {
  return {
    start: async () => undefined,
    run: async (_input, runOptions) =>
      ({
        sessionId: runOptions.sessionId,
        finalResponse: "ok",
        events: [],
        notifications: [],
      }) satisfies RunResult,
    close: async () => onClose(),
  };
}
