import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  materializePatch,
  RuntimeBusyError,
  RuntimeManager,
  type HarnessRuntime,
} from "../src/runtime-manager.js";

const temporaryHomes: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryHomes.map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("RuntimeManager", () => {
  it("materializes file URLs for both local plugins", async () => {
    const home = await temporaryHome();
    const path = await materializePatch(home);
    const patch = await readFile(path, "utf8");

    expect(patch).toContain("file://");
    expect(patch).toContain("/dist/plugins/provider.js");
    expect(patch).toContain("/dist/plugins/consumer.js");
    expect(patch).not.toContain("__PROVIDER_URL__");
  });

  it("passes the resolved patch to the harness and closes it", async () => {
    const home = await temporaryHome();
    const start = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const harness: HarnessRuntime = {
      start,
      close,
      run: vi.fn(),
    };
    const factory = vi.fn(() => harness);
    const runtime = new RuntimeManager(
      { profile: "sdk", cwd: process.cwd(), dshHome: home },
      home,
      factory,
    );

    await runtime.start();
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        patches: [join(home, "custom-service.resolved.patch.yml")],
      }),
    );
    expect(runtime.status().state).toBe("running");

    await runtime.close();
    expect(close).toHaveBeenCalledOnce();
    expect(runtime.status().state).toBe("stopped");
  });

  it("rejects a normal stop while a run is active", async () => {
    const home = await temporaryHome();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness: HarnessRuntime = {
      start: async () => undefined,
      close: async () => undefined,
      run: async () => {
        await pending;
        return {
          sessionId: "session",
          finalResponse: "",
          events: [],
          notifications: [],
        };
      },
    };
    const runtime = new RuntimeManager(
      { profile: "sdk", cwd: process.cwd(), dshHome: home },
      home,
      () => harness,
    );

    const run = runtime.run("hello", "session");
    await vi.waitFor(() => expect(runtime.status().activeRuns).toBe(1));
    await expect(runtime.stop()).rejects.toBeInstanceOf(RuntimeBusyError);
    release();
    await run;
    await runtime.close();
  });
});

async function temporaryHome(): Promise<string> {
  const path = await mkdtemp(join(process.cwd(), ".dsh-test-"));
  temporaryHomes.push(path);
  return path;
}
