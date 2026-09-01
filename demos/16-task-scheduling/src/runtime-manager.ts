import {
  DeepSeekHarness,
  type DeepSeekHarnessOptions,
  type HarnessNotification,
  type RunResult,
} from "@deepseek-ai/dsh-sdk-client";

export type RuntimeState =
  "stopped" | "starting" | "running" | "stopping" | "failed";

export interface RuntimeStatus {
  state: RuntimeState;
  activeRuns: number;
  startedAt: string | null;
  lastError: string | null;
}

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

export class RuntimeManager {
  private state: RuntimeState = "stopped";
  private harness: HarnessRuntime | undefined;
  private transition: Promise<void> | undefined;
  private activeRuns = 0;
  private startedAt: string | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly options: DeepSeekHarnessOptions,
    private readonly factory: HarnessFactory = (options) =>
      new DeepSeekHarness(options),
  ) {}

  status(): RuntimeStatus {
    return {
      state: this.state,
      activeRuns: this.activeRuns,
      startedAt: this.startedAt,
      lastError: this.lastError,
    };
  }

  async start(): Promise<RuntimeStatus> {
    if (this.state === "running") return this.status();
    if (this.state === "starting" && this.transition) {
      await this.transition;
      return this.status();
    }
    if (this.state === "stopping" && this.transition) await this.transition;

    const harness = this.factory(this.options);
    this.harness = harness;
    this.state = "starting";
    this.lastError = null;
    const transition = (async () => {
      try {
        await harness.start();
        this.state = "running";
        this.startedAt = new Date().toISOString();
      } catch (error) {
        this.state = "failed";
        this.lastError = errorMessage(error);
        this.harness = undefined;
        await harness.close().catch(() => undefined);
        throw error;
      }
    })();
    this.transition = transition;
    try {
      await transition;
    } finally {
      if (this.transition === transition) this.transition = undefined;
    }
    return this.status();
  }

  async run(prompt: string, sessionId: string): Promise<RunResult> {
    await this.start();
    const harness = this.harness;
    if (!harness || this.state !== "running") {
      throw new Error("runtime is not running");
    }
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

  async stop(force = false): Promise<RuntimeStatus> {
    if (this.state === "stopped") return this.status();
    if (this.state === "stopping" && this.transition) {
      await this.transition;
      return this.status();
    }
    if (this.state === "starting" && this.transition) {
      await this.transition.catch(() => undefined);
    }
    if (this.activeRuns > 0 && !force) {
      throw new Error("runtime has active runs");
    }
    const harness = this.harness;
    if (!harness) {
      this.state = "stopped";
      this.startedAt = null;
      return this.status();
    }

    this.state = "stopping";
    const transition = harness.close();
    this.transition = transition;
    try {
      await transition;
      if (this.harness === harness) this.harness = undefined;
      this.state = "stopped";
      this.startedAt = null;
      this.lastError = null;
    } catch (error) {
      this.state = "failed";
      this.lastError = errorMessage(error);
      throw error;
    } finally {
      if (this.transition === transition) this.transition = undefined;
    }
    return this.status();
  }

  async forceStop(): Promise<void> {
    await this.stop(true);
  }

  async close(): Promise<void> {
    await this.stop(true);
  }
}

export function createRuntime(): RuntimeManager {
  return new RuntimeManager({
    profile: process.env.DSH_PROFILE ?? "sdk",
    provider: process.env.DSH_PROVIDER ?? "deepseek-official",
    model: process.env.DSH_MODEL ?? "deepseek-v4-flash",
    cwd: process.env.DSH_WORKSPACE ?? process.cwd(),
    dshHome: process.env.DSH_HOME ?? "/tmp/dsh-demo-16-home",
    maxTokens: positiveInteger(process.env.DSH_MAX_TOKENS, 2048),
    initializeTimeoutMs: positiveInteger(
      process.env.DSH_INITIALIZE_TIMEOUT_MS,
      10_000,
    ),
  });
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
