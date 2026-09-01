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
  it("materializes an isolated filesystem-skill provider patch", async () => {
    const home = await temporaryHome();
    const skillRoot = join(process.cwd(), "workspace/skills");
    const path = await materializePatch(home, skillRoot);
    const patch = await readFile(path, "utf8");

    expect(path).toBe(join(home, "skill-loading.resolved.patch.yml"));
    expect(patch).toContain("id: skill-filesystem");
    expect(patch).toContain("@deepseek-ai/dsh-skill-filesystem");
    expect(patch).toContain("includeDefaultRoots: false");
    expect(patch).toContain(JSON.stringify(skillRoot));
    expect(patch).not.toContain("__SKILL_ROOT__");
  });

  it("passes the resolved patch to the SDK harness", async () => {
    const home = await temporaryHome();
    const skillRoot = join(process.cwd(), "workspace/skills");
    const harness: HarnessRuntime = {
      start: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      run: vi.fn(),
    };
    const factory = vi.fn(() => harness);
    const runtime = new RuntimeManager(
      { profile: "sdk", cwd: process.cwd(), dshHome: home },
      home,
      skillRoot,
      factory,
    );

    await runtime.start();
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        patches: [join(home, "skill-loading.resolved.patch.yml")],
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
