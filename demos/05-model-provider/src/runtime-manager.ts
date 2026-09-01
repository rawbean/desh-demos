import {
  DeepSeekHarness,
  type DeepSeekHarnessOptions,
  type RunResult,
} from "@deepseek-ai/dsh-sdk-client";
import type { ResolvedModelRoute } from "./model-config.js";

export type RuntimeState =
  "stopped" | "starting" | "running" | "switching" | "stopping" | "failed";

export interface RuntimeStatus {
  state: RuntimeState;
  route: { provider: string; model: string };
  generation: number;
  activeRuns: number;
  startedAt: string | null;
  lastError: string | null;
}

export interface HarnessRuntime {
  start(): Promise<void>;
  run(input: string): Promise<RunResult>;
  close(): Promise<void>;
}

export class RuntimeBusyError extends Error {
  constructor() {
    super("cannot switch provider/model while a prompt is active");
    this.name = "RuntimeBusyError";
  }
}

type HarnessFactory = (options: DeepSeekHarnessOptions) => HarnessRuntime;

const defaultFactory: HarnessFactory = (options) =>
  new DeepSeekHarness(options);

export class RuntimeManager {
  private state: RuntimeState = "stopped";
  private harness: HarnessRuntime | undefined;
  private generation = 0;
  private activeRuns = 0;
  private startedAt: string | null = null;
  private lastError: string | null = null;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(
    private route: ResolvedModelRoute,
    private readonly baseOptions: Omit<
      DeepSeekHarnessOptions,
      "provider" | "model"
    >,
    private readonly factory: HarnessFactory = defaultFactory,
  ) {}

  status(): RuntimeStatus {
    return {
      state: this.state,
      route: {
        provider: this.route.provider,
        model: this.route.model,
      },
      generation: this.generation,
      activeRuns: this.activeRuns,
      startedAt: this.startedAt,
      lastError: this.lastError,
    };
  }

  async start(): Promise<RuntimeStatus> {
    return this.exclusive(async () => {
      await this.startUnlocked();
      return this.status();
    });
  }

  async run(prompt: string): Promise<RunResult> {
    const harness = await this.exclusive(async () => {
      await this.startUnlocked();
      if (!this.harness || this.state !== "running") {
        throw new Error("runtime is not running");
      }
      this.activeRuns += 1;
      return this.harness;
    });

    try {
      return await harness.run(prompt);
    } finally {
      await this.exclusive(() => {
        this.activeRuns -= 1;
      });
    }
  }

  async switchTo(route: ResolvedModelRoute): Promise<RuntimeStatus> {
    return this.exclusive(async () => {
      if (
        route.provider === this.route.provider &&
        route.model === this.route.model
      ) {
        return this.status();
      }
      if (this.activeRuns > 0) throw new RuntimeBusyError();

      this.state = "switching";
      const previous = this.harness;
      this.harness = undefined;
      if (previous) await previous.close();

      this.route = { ...route };
      this.startedAt = null;
      await this.startUnlocked();
      return this.status();
    });
  }

  async close(): Promise<void> {
    await this.exclusive(async () => {
      this.state = "stopping";
      const harness = this.harness;
      this.harness = undefined;
      if (harness) await harness.close();
      this.state = "stopped";
      this.startedAt = null;
      this.lastError = null;
    });
  }

  private async startUnlocked(): Promise<void> {
    if (this.state === "running" && this.harness) return;

    const harness = this.factory({
      ...this.baseOptions,
      provider: this.route.sdkProvider,
      model: this.route.model,
    });
    this.harness = harness;
    this.state = "starting";
    this.lastError = null;
    try {
      await harness.start();
      this.state = "running";
      this.generation += 1;
      this.startedAt = new Date().toISOString();
    } catch (error) {
      this.harness = undefined;
      this.state = "failed";
      this.startedAt = null;
      this.lastError = errorMessage(error);
      await harness.close().catch(() => undefined);
      throw error;
    }
  }

  private async exclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    const previous = this.operationTail;
    let release: () => void = () => undefined;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
