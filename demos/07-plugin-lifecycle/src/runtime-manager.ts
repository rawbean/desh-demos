import {
  DeepSeekHarness,
  type DeepSeekHarnessOptions,
  type RunResult,
} from "@deepseek-ai/dsh-sdk-client";
import { PluginHost, type HostStatus } from "./plugin-host.js";
import { getPlugin, type PluginDefinition } from "./plugin-definitions.js";
import { LifecycleJournal, type LifecycleEvent } from "./plugins/contracts.js";

export interface HarnessRuntime {
  start(): Promise<void>;
  run(input: string, options: { sessionId: string }): Promise<RunResult>;
  close(): Promise<void>;
}

type HarnessFactory = (options: DeepSeekHarnessOptions) => HarnessRuntime;

export class UnknownPluginError extends Error {
  constructor(id: string) {
    super(`unknown plugin: ${id}`);
    this.name = "UnknownPluginError";
  }
}

export class RuntimeBusyError extends Error {
  constructor() {
    super("runtime has active runs");
    this.name = "RuntimeBusyError";
  }
}

export interface RuntimeStatus {
  state: "stopped" | "running";
  plugin: PluginDefinition;
  generation: number;
  activeRuns: number;
  cordis: HostStatus | null;
  lifecycle: LifecycleEvent[];
}

export class RuntimeManager {
  private harness: HarnessRuntime | undefined;
  private host: PluginHost;
  private readonly journal = new LifecycleJournal();
  private plugin: PluginDefinition;
  private generation = 0;
  private activeRuns = 0;

  constructor(
    initialPlugin: string,
    private readonly baseOptions: Omit<
      DeepSeekHarnessOptions,
      "profile" | "patches"
    >,
    private readonly factory: HarnessFactory = (options) =>
      new DeepSeekHarness(options),
  ) {
    const plugin = getPlugin(initialPlugin);
    if (!plugin) throw new UnknownPluginError(initialPlugin);
    this.plugin = plugin;
    this.host = new PluginHost(plugin.id, this.journal);
  }

  status(): RuntimeStatus {
    return {
      state: this.harness ? "running" : "stopped",
      plugin: { ...this.plugin },
      generation: this.generation,
      activeRuns: this.activeRuns,
      cordis: this.harness ? this.host.status() : null,
      lifecycle: this.journal.snapshot(),
    };
  }

  async start(): Promise<RuntimeStatus> {
    if (this.harness) return this.status();
    await this.host.start();
    const harness = this.factory({
      ...this.baseOptions,
      profile: "sdk",
      patches: [this.plugin.patch],
    });
    try {
      await harness.start();
    } catch (error) {
      await harness.close().catch(() => undefined);
      await this.host.stop();
      throw error;
    }
    this.harness = harness;
    this.generation += 1;
    return this.status();
  }

  async switchTo(id: string): Promise<RuntimeStatus & { rebuilt: boolean }> {
    const plugin = getPlugin(id);
    if (!plugin) throw new UnknownPluginError(id);
    if (this.activeRuns > 0) throw new RuntimeBusyError();
    if (plugin.id === this.plugin.id) {
      return { ...this.status(), rebuilt: false };
    }
    const wasRunning = this.harness !== undefined;
    await this.stop();
    this.plugin = plugin;
    this.host = new PluginHost(plugin.id, this.journal, this.generation);
    if (wasRunning) await this.start();
    return { ...this.status(), rebuilt: wasRunning };
  }

  async run(prompt: string, sessionId: string): Promise<RunResult> {
    await this.start();
    const harness = this.harness;
    if (!harness) throw new Error("runtime did not start");
    const probe = this.host.inspect(prompt);
    this.activeRuns += 1;
    try {
      return await harness.run(`${prompt}\nLOCAL_CORDIS_PROBE=${probe}`, {
        sessionId,
      });
    } finally {
      this.activeRuns -= 1;
    }
  }

  async stop(): Promise<RuntimeStatus> {
    if (this.activeRuns > 0) throw new RuntimeBusyError();
    await this.teardown();
    return this.status();
  }

  async close(): Promise<void> {
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    const harness = this.harness;
    this.harness = undefined;
    try {
      await harness?.close();
    } finally {
      await this.host.stop();
    }
  }
}
