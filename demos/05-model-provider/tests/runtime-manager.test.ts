import type {
  DeepSeekHarnessOptions,
  RunResult,
} from "@deepseek-ai/dsh-sdk-client";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedModelRoute } from "../src/model-config.js";
import {
  RuntimeBusyError,
  RuntimeManager,
  type HarnessRuntime,
} from "../src/runtime-manager.js";

const BLUE: ResolvedModelRoute = {
  provider: "mock-primary",
  model: "mock-blue",
  label: "Blue",
  sdkProvider: "deepseek-official",
};
const GREEN: ResolvedModelRoute = {
  provider: "mock-secondary",
  model: "mock-green",
  label: "Green",
  sdkProvider: "deepseek-official",
};

function result(answer: string): RunResult {
  return {
    sessionId: "session",
    finalResponse: answer,
    events: [],
    notifications: [],
  };
}

describe("RuntimeManager", () => {
  it("closes the old harness and creates a new generation on switch", async () => {
    const harnesses: HarnessRuntime[] = [];
    const options: DeepSeekHarnessOptions[] = [];
    const manager = new RuntimeManager(BLUE, {}, (received) => {
      options.push(received);
      const harness: HarnessRuntime = {
        start: vi.fn(async () => undefined),
        run: vi.fn(async () => result(received.model ?? "")),
        close: vi.fn(async () => undefined),
      };
      harnesses.push(harness);
      return harness;
    });

    expect((await manager.run("first")).finalResponse).toBe("mock-blue");
    const switched = await manager.switchTo(GREEN);
    expect((await manager.run("second")).finalResponse).toBe("mock-green");

    expect(switched.generation).toBe(2);
    expect(switched.route).toEqual({
      provider: "mock-secondary",
      model: "mock-green",
    });
    expect(harnesses[0]!.close).toHaveBeenCalledOnce();
    expect(options.map((entry) => entry.provider)).toEqual([
      "deepseek-official",
      "deepseek-official",
    ]);
    expect(options.map((entry) => entry.model)).toEqual([
      "mock-blue",
      "mock-green",
    ]);
  });

  it("rejects a switch while a prompt is active", async () => {
    let finish = () => undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const manager = new RuntimeManager(BLUE, {}, () => ({
      start: async () => undefined,
      run: async () => {
        await pending;
        return result("done");
      },
      close: async () => undefined,
    }));

    const run = manager.run("wait");
    await vi.waitFor(() => expect(manager.status().activeRuns).toBe(1));
    await expect(manager.switchTo(GREEN)).rejects.toBeInstanceOf(
      RuntimeBusyError,
    );
    finish();
    await run;
  });
});
