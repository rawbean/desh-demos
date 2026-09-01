import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  materializePatch,
  RuntimeManager,
  type HarnessRuntime,
} from "../src/runtime-manager.js";

const temporaryHomes: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryHomes
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("RuntimeManager", () => {
  it("materializes an absolute file URL for the Runtime plugin", async () => {
    const home = await temporaryHome();
    const path = await materializePatch(home);
    const patch = await readFile(path, "utf8");

    expect(path).toBe(join(home, "custom-tool.resolved.patch.yml"));
    expect(patch).toContain("file://");
    expect(patch).toContain("/dist/plugins/custom-tool.js");
    expect(patch).not.toContain("__CUSTOM_TOOL_URL__");
  });

  it("passes the resolved patch to the SDK harness", async () => {
    const home = await temporaryHome();
    const harness: HarnessRuntime = {
      start: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
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
        patches: [join(home, "custom-tool.resolved.patch.yml")],
      }),
    );
    await runtime.close();
    expect(harness.close).toHaveBeenCalledOnce();
  });
});

async function temporaryHome(): Promise<string> {
  const path = await mkdtemp(join(process.cwd(), ".dsh-test-"));
  temporaryHomes.push(path);
  return path;
}
