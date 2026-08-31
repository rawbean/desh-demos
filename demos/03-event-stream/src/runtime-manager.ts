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
  activeTasks: number;
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

export class RuntimeBusyError extends Error {
  constructor() {
    super("runtime has active tasks");
    this.name = "RuntimeBusyError";
  }
}

type HarnessFactory = (options: DeepSeekHarnessOptions) => HarnessRuntime;

const defaultFactory: HarnessFactory = (options) =>
  new DeepSeekHarness(options);

export class RuntimeManager {
  private state: RuntimeState = "stopped";
  private harness: HarnessRuntime | undefined;
  private transition: Promise<void> | undefined;
  private activeTasks = 0;
  private startedAt: string | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly options: DeepSeekHarnessOptions,
    private readonly factory: HarnessFactory = defaultFactory,
  ) {}

  status(): RuntimeStatus {
    return {
      state: this.state,
      activeTasks: this.activeTasks,
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
    if (this.state === "stopping" && this.transition) {
      await this.transition;
    }

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
        this.lastError = error instanceof Error ? error.message : String(error);
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

  async run(
    prompt: string,
    sessionId: string,
    onNotification: (notification: HarnessNotification) => void,
  ): Promise<RunResult> {
    await this.start();
    const harness = this.harness;
    if (!harness || this.state !== "running") {
      throw new Error("runtime is not running");
    }

    this.activeTasks += 1;
    try {
      return await harness.run(prompt, { sessionId, onNotification });
    } finally {
      this.activeTasks -= 1;
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
    if (this.activeTasks > 0 && !force) throw new RuntimeBusyError();

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
      this.harness = undefined;
      this.state = "stopped";
      this.startedAt = null;
      this.lastError = null;
    } catch (error) {
      this.state = "failed";
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      if (this.transition === transition) this.transition = undefined;
    }
    return this.status();
  }

  async close(): Promise<void> {
    await this.stop(true);
  }
}
