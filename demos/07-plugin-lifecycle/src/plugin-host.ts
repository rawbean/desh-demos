import { Context, type Fiber, type FiberState } from "@deepseek-ai/cordis";
import {
  LifecycleJournal,
  type PluginId,
  type ProbeService,
} from "./plugins/contracts.js";
import { probeConsumer } from "./plugins/probe-consumer.js";
import { probeProvider } from "./plugins/probe-provider.js";

export interface HostStatus {
  pluginId: PluginId;
  generation: number;
  registrySize: number;
  providerState: FiberState;
  consumerState: FiberState;
  injected: boolean;
}

export class PluginHost {
  private ctx: Context | undefined;
  private provider: Fiber | undefined;
  private consumer: Fiber | undefined;
  private pluginId: PluginId;
  private generation: number;

  constructor(
    initialPlugin: PluginId,
    readonly journal = new LifecycleJournal(),
    generation = 0,
  ) {
    this.pluginId = initialPlugin;
    this.generation = generation;
  }

  async start(): Promise<HostStatus> {
    if (this.ctx) return this.status();
    const ctx = new Context();
    const generation = this.generation + 1;
    const config = {
      pluginId: this.pluginId,
      generation,
      journal: this.journal,
    };

    // Register the dependent first. It remains pending until the provider
    // becomes active, proving that Cordis performs the dependency injection.
    const consumer = ctx.plugin(probeConsumer, config);
    const provider = ctx.plugin(probeProvider, config);
    try {
      await Promise.all([provider.await(), consumer.await()]);
    } catch (error) {
      await consumer.dispose().catch(() => undefined);
      await provider.dispose().catch(() => undefined);
      throw error;
    }

    this.ctx = ctx;
    this.provider = provider;
    this.consumer = consumer;
    this.generation = generation;
    return this.status();
  }

  inspect(prompt: string): string {
    const service = this.ctx?.get("lifecycleProbe") as ProbeService | undefined;
    if (!service) throw new Error("Cordis plugin host is not running");
    return service.inspect(prompt);
  }

  status(): HostStatus {
    if (!this.ctx || !this.provider || !this.consumer) {
      throw new Error("Cordis plugin host is not running");
    }
    return {
      pluginId: this.pluginId,
      generation: this.generation,
      registrySize: this.ctx.registry.size,
      providerState: this.provider.state,
      consumerState: this.consumer.state,
      injected: this.ctx.get("lifecycleProbe") !== undefined,
    };
  }

  async stop(): Promise<void> {
    if (!this.ctx) return;
    try {
      await this.consumer?.dispose();
    } finally {
      try {
        await this.provider?.dispose();
      } finally {
        this.consumer = undefined;
        this.provider = undefined;
        this.ctx = undefined;
      }
    }
  }
}
