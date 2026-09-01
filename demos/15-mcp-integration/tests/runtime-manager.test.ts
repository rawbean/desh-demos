import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  materializePatch,
  RuntimeManager,
  type HarnessRuntime,
} from "../src/runtime-manager.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("RuntimeManager", () => {
  it("materializes a strict stdio MCP client patch", async () => {
    const home = await temporaryDirectory();
    const eventFile = join(home, "events.jsonl");
    const path = await materializePatch(home, eventFile);
    const patch = await readFile(path, "utf8");

    expect(patch).toContain('name: "@deepseek-ai/dsh-mcp-client"');
    expect(patch).toContain("serverName: demo");
    expect(patch).toContain("failOnStartupError: true");
    expect(patch).toContain("dist/mcp-server.js");
    expect(patch).toContain(eventFile);
    expect(patch).not.toContain("__");
  });

  it("closes a failed harness initialization", async () => {
    const home = await temporaryDirectory();
    const close = vi.fn(async () => undefined);
    const fake: HarnessRuntime = {
      start: vi.fn(async () => {
        throw new Error("initialization failed");
      }),
      run: vi.fn(),
      close,
    };
    const manager = new RuntimeManager(
      { profile: "sdk", cwd: process.cwd(), dshHome: home },
      home,
      join(home, "events.jsonl"),
      () => fake,
    );

    await expect(manager.start()).rejects.toThrow("initialization failed");
    expect(close).toHaveBeenCalledOnce();
    expect(manager.status()).toMatchObject({
      state: "stopped",
      initialized: false,
    });
  });
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(process.cwd(), ".dsh-test-"));
  temporaryDirectories.push(path);
  return path;
}
