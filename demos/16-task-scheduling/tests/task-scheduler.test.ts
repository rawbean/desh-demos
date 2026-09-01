import { describe, expect, it, vi } from "vitest";
import type { RunResult } from "@deepseek-ai/dsh-sdk-client";
import {
  TaskScheduler,
  type SchedulerOptions,
  type TaskRunner,
} from "../src/task-scheduler.js";

class ControlledRunner implements TaskRunner {
  readonly starts: string[] = [];
  readonly pending: Array<{
    prompt: string;
    resolve: (result: RunResult) => void;
    reject: (error: Error) => void;
  }> = [];
  active = 0;
  maxActive = 0;
  forceStops = 0;

  run(prompt: string, _sessionId: string): Promise<RunResult> {
    void _sessionId;
    this.starts.push(prompt);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    return new Promise<RunResult>((resolve, reject) => {
      this.pending.push({
        prompt,
        resolve: (result) => {
          this.active -= 1;
          resolve(result);
        },
        reject: (error) => {
          this.active -= 1;
          reject(error);
        },
      });
    });
  }

  resolve(prompt: string, response = `${prompt}-ok`): void {
    const call = this.take(prompt);
    call.resolve(result(response));
  }

  reject(prompt: string, message: string): void {
    const call = this.take(prompt);
    call.reject(new Error(message));
  }

  async forceStop(): Promise<void> {
    this.forceStops += 1;
  }

  private take(prompt: string) {
    const index = this.pending.findIndex((call) => call.prompt === prompt);
    if (index < 0) throw new Error(`no pending call for ${prompt}`);
    const [call] = this.pending.splice(index, 1);
    if (!call) throw new Error(`no pending call for ${prompt}`);
    return call;
  }
}

const defaults: SchedulerOptions = {
  concurrency: 2,
  defaultTimeoutMs: 10_000,
  defaultMaxAttempts: 3,
  defaultRetryDelayMs: 1,
};

describe("TaskScheduler", () => {
  it("starts ready tasks in FIFO order without exceeding concurrency", async () => {
    const runner = new ControlledRunner();
    const scheduler = new TaskScheduler(runner, defaults);
    const a = scheduler.submit("a");
    const b = scheduler.submit("b");
    const c = scheduler.submit("c");

    await vi.waitFor(() => expect(runner.starts).toEqual(["a", "b"]));
    runner.resolve("b");
    await vi.waitFor(() => expect(runner.starts).toEqual(["a", "b", "c"]));
    runner.resolve("a");
    runner.resolve("c");
    await vi.waitFor(() => {
      expect(scheduler.get(a.id).state).toBe("completed");
      expect(scheduler.get(b.id).state).toBe("completed");
      expect(scheduler.get(c.id).state).toBe("completed");
    });
    expect(runner.maxActive).toBe(2);
  });

  it("truly cancels queued tasks and logically cancels running results", async () => {
    const runner = new ControlledRunner();
    const scheduler = new TaskScheduler(runner, {
      ...defaults,
      concurrency: 1,
    });
    const running = scheduler.submit("running");
    const queued = scheduler.submit("queued");
    await vi.waitFor(() => expect(runner.starts).toEqual(["running"]));

    expect((await scheduler.cancel(queued.id)).cancellation).toBe("queued");
    expect((await scheduler.cancel(running.id)).cancellation).toBe(
      "logical-running",
    );
    runner.resolve("running", "must-be-ignored");
    await vi.waitFor(() => expect(scheduler.status().activeSlots).toBe(0));

    expect(runner.starts).toEqual(["running"]);
    expect(scheduler.get(running.id)).toMatchObject({
      state: "cancelled",
      finalResponse: null,
    });
  });

  it("marks timeout but retains its slot until the SDK run settles", async () => {
    const runner = new ControlledRunner();
    const scheduler = new TaskScheduler(runner, {
      ...defaults,
      concurrency: 1,
    });
    const slow = scheduler.submit("slow", { timeoutMs: 10 });
    scheduler.submit("next");
    await vi.waitFor(() =>
      expect(scheduler.get(slow.id).state).toBe("timed_out"),
    );

    expect(runner.starts).toEqual(["slow"]);
    expect(scheduler.status().activeSlots).toBe(1);
    runner.resolve("slow");
    await vi.waitFor(() => expect(runner.starts).toEqual(["slow", "next"]));
    runner.resolve("next");
  });

  it("retries failures and preserves the final error", async () => {
    const runner = new ControlledRunner();
    const scheduler = new TaskScheduler(runner, {
      ...defaults,
      concurrency: 1,
    });
    const retried = scheduler.submit("retry", {
      maxAttempts: 3,
      retryDelayMs: 1,
    });
    await vi.waitFor(() => expect(runner.starts).toEqual(["retry"]));
    runner.reject("retry", "temporary");
    await vi.waitFor(() => expect(runner.starts).toEqual(["retry", "retry"]));
    runner.resolve("retry");
    await vi.waitFor(() =>
      expect(scheduler.get(retried.id)).toMatchObject({
        state: "completed",
        attempts: 2,
        finalResponse: "retry-ok",
      }),
    );
    expect(scheduler.get(retried.id).errors[0]?.message).toBe("temporary");

    const failed = scheduler.submit("failed", {
      maxAttempts: 2,
      retryDelayMs: 1,
    });
    await vi.waitFor(() => expect(runner.starts.at(-1)).toBe("failed"));
    runner.reject("failed", "first");
    await vi.waitFor(() => expect(runner.starts.length).toBe(4));
    runner.reject("failed", "final");
    await vi.waitFor(() =>
      expect(scheduler.get(failed.id)).toMatchObject({
        state: "failed",
        attempts: 2,
        error: "final",
      }),
    );
  });

  it("uses explicit Runtime force stop only when requested", async () => {
    const runner = new ControlledRunner();
    const scheduler = new TaskScheduler(runner, defaults);
    const task = scheduler.submit("force");
    await vi.waitFor(() => expect(runner.starts).toEqual(["force"]));

    const cancelled = await scheduler.cancel(task.id, true);
    expect(cancelled.cancellation).toBe("runtime-force");
    expect(runner.forceStops).toBe(1);
    runner.reject("force", "runtime closed");
  });
});

function result(finalResponse: string): RunResult {
  return {
    sessionId: "test-session",
    finalResponse,
    events: [],
    notifications: [],
  };
}
