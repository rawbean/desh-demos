import type { FiberState } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import { PluginHost } from "../src/plugin-host.js";

// FiberState is a const enum in Cordis and has no runtime export.
const ACTIVE: FiberState = 2;

describe("Cordis plugin host", () => {
  it("registers, injects, starts, and unloads real Cordis fibers", async () => {
    const host = new PluginHost("observer");
    const status = await host.start();

    expect(status).toMatchObject({
      pluginId: "observer",
      generation: 1,
      registrySize: 2,
      providerState: ACTIVE,
      consumerState: ACTIVE,
      injected: true,
    });
    expect(host.inspect("Hello World")).toBe("observer:hello-world");

    await host.stop();
    expect(host.journal.snapshot().map((event) => event.phase)).toEqual([
      "provider-start",
      "consumer-start",
      "consumer-stop",
      "provider-stop",
    ]);
  });
});
