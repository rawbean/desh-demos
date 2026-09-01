import {
  DeepSeekHarness,
  type DeepSeekHarnessOptions,
  type HarnessNotification,
  type RunResult,
} from "@deepseek-ai/dsh-sdk-client";
import { getComposition, type Composition } from "./compositions.js";

export interface HarnessRuntime {
  start(): Promise<void>;
  run(
    input: string,
    options: {
      sessionId: string;
      onNotification: (notification: HarnessNotification) => void;
    },
  ): Promise<RunResult>;
  close(): Promise<void>;
}

type HarnessFactory = (options: DeepSeekHarnessOptions) => HarnessRuntime;

export class RuntimeBusyError extends Error {
  constructor() {
    super("runtime has active runs");
    this.name = "RuntimeBusyError";
  }
}

export class UnknownCompositionError extends Error {
  constructor(id: string) {
    super(`unknown composition: ${id}`);
    this.name = "UnknownCompositionError";
  }
}

export interface RuntimeStatus {
  state: "stopped" | "running";
  composition: Composition;
  activeRuns: number;
  generation: number;
  startedAt: string | null;
}

export interface ConfigureResult extends RuntimeStatus {
  rebuilt: boolean;
}

export class RuntimeManager {
  private harness: HarnessRuntime | undefined;
  private composition: Composition;
  private activeRuns = 0;
  private generation = 0;
  private startedAt: string | null = null;

  constructor(
    initialComposition: string,
    private readonly baseOptions: Omit<
      DeepSeekHarnessOptions,
      "profile" | "patches"
    >,
    private readonly factory: HarnessFactory = (options) =>
      new DeepSeekHarness(options),
  ) {
    const composition = getComposition(initialComposition);
    if (!composition) throw new UnknownCompositionError(initialComposition);
    this.composition = composition;
  }

  status(): RuntimeStatus {
    return {
      state: this.harness ? "running" : "stopped",
      composition: this.composition,
      activeRuns: this.activeRuns,
      generation: this.generation,
      startedAt: this.startedAt,
    };
  }

  async start(): Promise<RuntimeStatus> {
    if (this.harness) return this.status();
    const harness = this.factory({
      ...this.baseOptions,
      profile: this.composition.profile,
      patches: this.composition.patches,
    });
    try {
      await harness.start();
    } catch (error) {
      await harness.close().catch(() => undefined);
      throw error;
    }
    this.harness = harness;
    this.generation += 1;
    this.startedAt = new Date().toISOString();
    return this.status();
  }

  async configure(id: string): Promise<ConfigureResult> {
    const next = getComposition(id);
    if (!next) throw new UnknownCompositionError(id);
    if (next.id === this.composition.id) {
      return { ...this.status(), rebuilt: false };
    }
    if (this.activeRuns > 0) throw new RuntimeBusyError();

    const wasRunning = this.harness !== undefined;
    await this.stop();
    this.composition = next;
    if (wasRunning) await this.start();
    return { ...this.status(), rebuilt: wasRunning };
  }

  async run(prompt: string, sessionId: string): Promise<RunResult> {
    await this.start();
    const harness = this.harness;
    if (!harness) throw new Error("runtime did not start");
    this.activeRuns += 1;
    try {
      return await harness.run(prompt, {
        sessionId,
        onNotification: () => undefined,
      });
    } finally {
      this.activeRuns -= 1;
    }
  }

  async stop(): Promise<RuntimeStatus> {
    if (this.activeRuns > 0) throw new RuntimeBusyError();
    const harness = this.harness;
    if (!harness) return this.status();
    await harness.close();
    this.harness = undefined;
    this.startedAt = null;
    return this.status();
  }

  async close(): Promise<void> {
    const harness = this.harness;
    if (!harness) return;
    await harness.close();
    this.harness = undefined;
    this.startedAt = null;
  }
}
