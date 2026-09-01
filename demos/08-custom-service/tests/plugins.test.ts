import { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { describe, expect, it } from "vitest";
import * as consumer from "../src/plugins/consumer.js";
import * as provider from "../src/plugins/provider.js";

describe("custom Cordis service plugins", () => {
  it("keeps the injected consumer pending until the provider exists", async () => {
    const ctx = new Context();
    let registered: ToolDefinition | undefined;
    ctx.reflect.provide("tools", {
      register(definition: ToolDefinition) {
        registered = definition;
        return () => undefined;
      },
    });

    const consumerFiber = ctx.plugin(consumer);
    await Promise.resolve();
    expect(registered).toBeUndefined();

    await ctx.plugin(provider, {
      prefix: "Unit",
      providerInstance: "unit-provider",
    });
    await consumerFiber;
    expect(registered?.name).toBe("custom_service_greet");

    const result = await registered?.execute({ name: "Cordis" }, {} as never);
    expect(result).toEqual({
      message: "Unit, Cordis!",
      providerInstance: "unit-provider",
      serviceCall: 1,
      eventObserved: true,
    });

    await ctx.fiber.dispose();
  });
});
