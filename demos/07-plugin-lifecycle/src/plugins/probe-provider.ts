import type { Plugin } from "@deepseek-ai/cordis";
import type { PluginConfig, ProbeService } from "./contracts.js";

export const probeProvider: Plugin.Function<PluginConfig> = (ctx, config) => {
  const service: ProbeService = {
    pluginId: config.pluginId,
    inspect: (prompt) =>
      `${config.pluginId}:${prompt.trim().toLowerCase().replaceAll(/\s+/g, "-")}`,
  };

  ctx.provide("lifecycleProbe", service);
  config.journal.record({
    generation: config.generation,
    pluginId: config.pluginId,
    phase: "provider-start",
  });

  return () => {
    config.journal.record({
      generation: config.generation,
      pluginId: config.pluginId,
      phase: "provider-stop",
    });
  };
};

probeProvider.provide = "lifecycleProbe";
