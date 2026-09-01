import type { ChildProcess } from "node:child_process";
import {
  DeepSeekHarness,
  TransportClosedError,
  type DeepSeekHarnessOptions,
  type NotificationSubscription,
  type RunOptions,
  type RunResult,
} from "@deepseek-ai/dsh-sdk-client";

export type RuntimeState =
  | "stopped"
  | "starting"
  | "running"
  | "crashed"
  | "recovering"
  | "failed"
  | "stopping";

export interface RuntimeStatus {
  state: RuntimeState;
  recoveryGeneration: number;
  startedAt: string | null;
  crashedAt: string | null;
  lastError: string | null;
}

export interface RuntimeHarness {
  start(): Promise<void>;
  run(input: string, options: RunOptions): Promise<RunResult>;
  close(): Promise<void>;
  watchCrash(onCrash: (error: Error) => void): () => void;
  crashForTest(): boolean;
}

type HarnessFactory = (options: DeepSeekHarnessOptions) => RuntimeHarness;
type RuntimeListener = (status: RuntimeStatus) => void;

export class RuntimeUnavailableError extends Error {}
export class RuntimeCrashTimeoutError extends Error {}

class DshRuntimeHarness implements RuntimeHarness {
  private readonly harness: DeepSeekHarness;

  constructor(options: DeepSeekHarnessOptions) {
    this.harness = new DeepSeekHarness(options);
  }

  start(): Promise<void> {
    return this.harness.start();
  }

  run(input: string, options: RunOptions): Promise<RunResult> {
    return this.harness.run(input, options);
  }

  close(): Promise<void> {
    return this.harness.close();
  }

  watchCrash(onCrash: (error: Error) => void): () => void {
    const subscription: NotificationSubscription =
      this.harness.client.subscribe();
    let watching = true;
    void (async () => {
      try {
        while (watching) await subscription.next();
      } catch (error) {
        if (watching) {
          onCrash(
            error instanceof Error
              ? error
              : new TransportClosedError(String(error)),
          );
        }
      }
    })();
    return () => {
      watching = false;
      subscription.close();
    };
  }

  crashForTest(): boolean {
    // alpha.2 has no public fault-injection API. This endpoint is test-only,
    // version-pinned, and deliberately isolated behind DshRuntimeHarness.
    const client = this.harness.client as unknown as {
      child?: ChildProcess;
    };
    return client.child?.kill("SIGKILL") ?? false;
  }
}

export class RuntimeManager {
  private state: RuntimeState = "stopped";
  private recoveryGeneration = 0;
  private startedAt: string | null = null;
  private crashedAt: string | null = null;
  private lastError: string | null = null;
  private harness: RuntimeHarness | undefined;
  private transition: Promise<RuntimeStatus> | undefined;
  private stopWatching: (() => void) | undefined;
  private readonly listeners = new Set<RuntimeListener>();
  private closing = false;

  constructor(
    private readonly options: DeepSeekHarnessOptions,
    private readonly factory: HarnessFactory = (options) =>
      new DshRuntimeHarness(options),
  ) {}

  status(): RuntimeStatus {
    return {
      state: this.state,
      recoveryGeneration: this.recoveryGeneration,
      startedAt: this.startedAt,
      crashedAt: this.crashedAt,
      lastError: this.lastError,
    };
  }

  onStateChange(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<RuntimeStatus> {
    if (this.state === "running") return this.status();
    if (this.transition) return this.transition;
    if (this.state !== "stopped") {
      throw new RuntimeUnavailableError(
        `runtime cannot start while ${this.state}`,
      );
    }
    return this.launch("starting", false);
  }

  async run(input: string, options: RunOptions): Promise<RunResult> {
    if (this.state !== "running" || !this.harness) {
      throw new RuntimeUnavailableError(`runtime is ${this.state}`);
    }
    try {
      return await this.harness.run(input, options);
    } catch (error) {
      if (error instanceof TransportClosedError) this.markCrashed(error);
      throw error;
    }
  }

  async recover(): Promise<RuntimeStatus> {
    if (this.state === "running") return this.status();
    if (this.transition) return this.transition;
    if (this.state !== "crashed" && this.state !== "failed") {
      throw new RuntimeUnavailableError(
        `runtime cannot recover while ${this.state}`,
      );
    }

    this.recoveryGeneration += 1;
    this.setState("recovering");
    const oldHarness = this.harness;
    this.harness = undefined;
    this.stopWatching?.();
    this.stopWatching = undefined;

    const task = (async () => {
      if (oldHarness) await oldHarness.close().catch(() => undefined);
      return this.launchFresh();
    })();
    this.transition = task;
    try {
      return await task;
    } finally {
      if (this.transition === task) this.transition = undefined;
    }
  }

  async crashForTest(timeoutMs = 2_000): Promise<RuntimeStatus> {
    if (this.state !== "running" || !this.harness) {
      throw new RuntimeUnavailableError(`runtime is ${this.state}`);
    }
    const crashed = this.waitForState("crashed", timeoutMs);
    if (!this.harness.crashForTest()) {
      throw new RuntimeUnavailableError("runtime child process is unavailable");
    }
    await crashed;
    return this.status();
  }

  async close(): Promise<void> {
    if (this.closing) {
      if (this.transition) await this.transition.catch(() => undefined);
      return;
    }
    this.closing = true;
    this.setState("stopping");
    this.stopWatching?.();
    this.stopWatching = undefined;
    const harness = this.harness;
    this.harness = undefined;
    if (harness) await harness.close();
    this.startedAt = null;
    this.setState("stopped");
  }

  private launch(
    state: "starting",
    recovering: boolean,
  ): Promise<RuntimeStatus> {
    this.setState(state);
    const task = this.launchFresh();
    this.transition = task;
    return task.finally(() => {
      if (this.transition === task) this.transition = undefined;
      void recovering;
    });
  }

  private async launchFresh(): Promise<RuntimeStatus> {
    const harness = this.factory(this.options);
    this.harness = harness;
    try {
      await harness.start();
      if (this.harness !== harness) {
        await harness.close().catch(() => undefined);
        throw new RuntimeUnavailableError("runtime launch was superseded");
      }
      this.startedAt = new Date().toISOString();
      this.lastError = null;
      this.stopWatching = harness.watchCrash((error) => {
        if (this.harness === harness) this.markCrashed(error);
      });
      this.setState("running");
      return this.status();
    } catch (error) {
      if (this.harness === harness) this.harness = undefined;
      await harness.close().catch(() => undefined);
      this.lastError = error instanceof Error ? error.message : String(error);
      this.setState("failed");
      throw error;
    }
  }

  private markCrashed(error: Error): void {
    if (
      this.closing ||
      this.state === "crashed" ||
      this.state === "recovering" ||
      this.state === "stopped"
    ) {
      return;
    }
    this.lastError = error.message;
    this.crashedAt = new Date().toISOString();
    this.setState("crashed");
  }

  private setState(state: RuntimeState): void {
    this.state = state;
    const status = this.status();
    for (const listener of this.listeners) listener(status);
  }

  private waitForState(target: RuntimeState, timeoutMs: number): Promise<void> {
    if (this.state === target) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const unsubscribe = this.onStateChange((status) => {
        if (status.state === target) {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        }
      });
      const timer = setTimeout(() => {
        unsubscribe();
        reject(
          new RuntimeCrashTimeoutError(
            `runtime did not enter ${target} within ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
    });
  }
}
