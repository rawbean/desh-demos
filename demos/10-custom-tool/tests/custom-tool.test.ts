import { Context } from "@deepseek-ai/cordis";
import { ToolArgsError, type ToolDefinition } from "@deepseek-ai/dsh-tools";
import { describe, expect, it } from "vitest";
import * as customTool from "../src/plugins/custom-tool.js";

describe("deterministic custom tool plugin", () => {
  it("registers through Cordis and computes a stable result", async () => {
    const ctx = new Context();
    let registered: ToolDefinition | undefined;
    ctx.reflect.provide("tools", {
      register(definition: ToolDefinition) {
        registered = definition;
        return () => undefined;
      },
    });

    await ctx.plugin(customTool);
    expect(registered?.name).toBe("deterministic_score");
    await expect(
      registered?.execute(
        { label: "sdk", values: [3, 1, 4], mode: "weighted" },
        {} as never,
      ),
    ).resolves.toEqual({
      label: "sdk",
      mode: "weighted",
      score: 17,
      fingerprint: "sdk:weighted:3,1,4:17",
    });

    await ctx.fiber.dispose();
  });

  it("rejects malformed model arguments before execute runs", async () => {
    const ctx = new Context();
    let registered: ToolDefinition | undefined;
    ctx.reflect.provide("tools", {
      register(definition: ToolDefinition) {
        registered = definition;
        return () => undefined;
      },
    });
    await ctx.plugin(customTool);

    await expect(
      registered?.execute(
        { label: "sdk", values: [3, "bad"], mode: "weighted" },
        {} as never,
      ),
    ).rejects.toBeInstanceOf(ToolArgsError);

    await ctx.fiber.dispose();
  });
});
