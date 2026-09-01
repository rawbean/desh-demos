import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeepSeekHarnessOptions } from "@deepseek-ai/dsh-sdk-client";
import {
  materializePatch,
  RuntimeManager,
  type HarnessRuntime,
} from "../src/runtime-manager.js";

let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  temporaryDirectory = undefined;
});

describe("RuntimeManager", () => {
  it("materializes a private patch with the compiled plugin URL", async () => {
    temporaryDirectory = await mkdtemp(join(process.cwd(), ".dsh-test-"));
    const patchPath = await materializePatch(temporaryDirectory);
    const patch = await readFile(patchPath, "utf8");

    expect(patch).toContain("dist/plugins/human-approval.js");
    expect(patch).not.toContain("__HUMAN_APPROVAL_PLUGIN_URL__");
  });

  it("forwards notifications and closes its harness", async () => {
    temporaryDirectory = await mkdtemp(join(process.cwd(), ".dsh-test-"));
    let launchOptions: DeepSeekHarnessOptions | undefined;
    const fake: HarnessRuntime = {
      start: vi.fn(async () => undefined),
      run: vi.fn(async (_input, options) => {
        options.onNotification({ method: "session.event", params: {} });
        return {
          sessionId: options.sessionId,
          finalResponse: "ok",
          events: [],
          notifications: [],
        };
      }),
      close: vi.fn(async () => undefined),
    };
    const manager = new RuntimeManager(
      { profile: "sdk" },
      temporaryDirectory,
      "allow",
      (options) => {
        launchOptions = options;
        return fake;
      },
    );
    const observed: string[] = [];

    const result = await manager.run("prompt", "session-1", (notification) =>
      observed.push(notification.method),
    );
    await manager.close();

    expect(result.sessionId).toBe("session-1");
    expect(observed).toEqual(["session.event"]);
    expect(launchOptions?.patches).toHaveLength(1);
    expect(fake.close).toHaveBeenCalledOnce();
  });
});
