import { fileURLToPath } from "node:url";
import {
  DeepSeekHarness,
  type DeepSeekHarnessOptions,
  type HarnessNotification,
  type RunResult,
} from "@deepseek-ai/dsh-sdk-client";

export const PROVIDER = "demo-custom-adapter";
export const MODEL = "deterministic-v1";

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

export interface RuntimeStatus {
  state: "stopped" | "running";
  activeRuns: number;
  startedAt: string | null;
  provider: string;
  model: string;
  patch: string;
}

type HarnessFactory = (options: DeepSeekHarnessOptions) => HarnessRuntime;

export class RuntimeBusyError extends Error {
  constructor() {
    super("runtime has an active run");
    this.name = "RuntimeBusyError";
  }
}

export class RuntimeManager {
  private harness: HarnessRuntime | undefined;
  private activeRuns = 0;
  private startedAt: string | null = null;

  constructor(
    private readonly options: DeepSeekHarnessOptions,
    private readonly factory: HarnessFactory = (options) =>
      new DeepSeekHarness(options),
  ) {}

  status(): RuntimeStatus {
    return {
      state: this.harness ? "running" : "stopped",
      activeRuns: this.activeRuns,
      startedAt: this.startedAt,
      provider: this.options.provider ?? PROVIDER,
      model: this.options.model ?? MODEL,
      patch: this.options.patches?.[0] ?? "",
    };
  }

  async start(): Promise<RuntimeStatus> {
    if (this.harness) return this.status();
    const harness = this.factory(this.options);
    try {
      await harness.start();
    } catch (error) {
      await harness.close().catch(() => undefined);
      throw error;
    }
    this.harness = harness;
    this.startedAt = new Date().toISOString();
    return this.status();
  }

  async run(
    prompt: string,
    sessionId: string,
    onNotification: (notification: HarnessNotification) => void,
  ): Promise<RunResult> {
    if (this.activeRuns > 0) throw new RuntimeBusyError();
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

export function runtimeOptions(): DeepSeekHarnessOptions {
  const root = fileURLToPath(new URL("../", import.meta.url));
  return {
    profile: "sdk",
    patches: [`${root}patches/custom-model-adapter.patch.yml`],
    provider: PROVIDER,
    model: MODEL,
    cwd: process.env.DSH_WORKSPACE ?? process.cwd(),
    dshHome: process.env.DSH_HOME ?? "/tmp/dsh-home",
    maxTokens: positiveInteger(process.env.DSH_MAX_TOKENS, 64),
    initializeTimeoutMs: positiveInteger(
      process.env.DSH_INITIALIZE_TIMEOUT_MS,
      10_000,
    ),
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
