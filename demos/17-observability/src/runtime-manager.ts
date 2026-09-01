import {
  DeepSeekHarness,
  type DeepSeekHarnessOptions,
  type HarnessNotification,
  type RunResult,
} from "@deepseek-ai/dsh-sdk-client";

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
  private harness: HarnessRuntime | undefined;
  private activeRuns = 0;

  constructor(
    private readonly options: DeepSeekHarnessOptions,
    private readonly factory: HarnessFactory = (options) =>
      new DeepSeekHarness(options),
  ) {}

  status() {
    return {
      state: this.harness ? "running" : "stopped",
      activeRuns: this.activeRuns,
    };
  }

  async run(
    prompt: string,
    sessionId: string,
    onNotification: (notification: HarnessNotification) => void,
  ): Promise<RunResult> {
    await this.start();
    const harness = this.harness;
    if (!harness) throw new Error("runtime did not start");
    this.activeRuns += 1;
    try {
      return await harness.run(prompt, { sessionId, onNotification });
    } finally {
      this.activeRuns -= 1;
    }
  }

  async start(): Promise<void> {
    if (this.harness) return;
    const harness = this.factory(this.options);
    try {
      await harness.start();
      this.harness = harness;
    } catch (error) {
      await harness.close().catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.harness) return;
    await this.harness.close();
    this.harness = undefined;
  }
}
