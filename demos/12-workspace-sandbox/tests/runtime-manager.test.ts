import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  materializePatch,
  RuntimeManager,
  type HarnessRuntime,
} from "../src/runtime-manager.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("RuntimeManager", () => {
  it("materializes the real Cordis tool-policy patch", async () => {
    const home = await temporaryPath();
    const path = await materializePatch(home);
    const patch = await readFile(path, "utf8");

    expect(path).toBe(join(home, "workspace-sandbox.resolved.patch.yml"));
    expect(patch).toContain("file://");
    expect(patch).toContain("/dist/plugins/capability-deny.js");
    expect(patch).not.toContain("__CAPABILITY_DENY_URL__");
  });

  it("passes workspace and resolved patch to the SDK harness", async () => {
    const home = await temporaryPath();
    const workspace = await temporaryPath();
    const harness: HarnessRuntime = {
      start: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      run: vi.fn(),
    };
    const factory = vi.fn(() => harness);
    const runtime = new RuntimeManager(
      { profile: "sdk", cwd: workspace, dshHome: home },
      home,
      workspace,
      factory,
    );

    await runtime.start();
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: workspace,
        patches: [join(home, "workspace-sandbox.resolved.patch.yml")],
      }),
    );
    expect(runtime.status()).toMatchObject({
      workspace,
      permissionMode: "workspace-write",
    });
    await runtime.close();
    expect(harness.close).toHaveBeenCalledOnce();
  });
});

async function temporaryPath(): Promise<string> {
  const path = await mkdtemp(join(process.cwd(), ".dsh-test-"));
  temporaryPaths.push(path);
  return path;
}
