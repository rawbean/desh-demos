import type { Plugin } from "@deepseek-ai/cordis";
import type { PluginConfig } from "./contracts.js";

export const probeConsumer: Plugin.Function<PluginConfig> = (ctx, config) => {
  const service = ctx.lifecycleProbe;
  if (service.pluginId !== config.pluginId) {
    throw new Error("injected probe does not match plugin configuration");
  }

  config.journal.record({
    generation: config.generation,
    pluginId: config.pluginId,
    phase: "consumer-start",
  });

  return () => {
    config.journal.record({
      generation: config.generation,
      pluginId: config.pluginId,
      phase: "consumer-stop",
    });
  };
};

probeConsumer.inject = ["lifecycleProbe"];
