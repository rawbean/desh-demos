import { randomUUID } from "node:crypto";
import type { RunResult } from "@deepseek-ai/dsh-sdk-client";

export type TaskState =
  "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";

export interface TaskRunner {
  run(prompt: string, sessionId: string): Promise<RunResult>;
  forceStop?(): Promise<void>;
}

export interface SubmitOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export interface SchedulerOptions {
  concurrency: number;
  defaultTimeoutMs: number;
  defaultMaxAttempts: number;
  defaultRetryDelayMs: number;
}

export interface AttemptError {
  attempt: number;
  message: string;
  at: string;
}

export interface TaskSnapshot {
  id: string;
  sessionId: string;
  prompt: string;
  state: TaskState;
  attempts: number;
  maxAttempts: number;
  timeoutMs: number;
  retryDelayMs: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  finalResponse: string | null;
  error: string | null;
  errors: AttemptError[];
  cancellation: "none" | "queued" | "logical-running" | "runtime-force";
}

export class TaskNotFoundError extends Error {
  constructor(id: string) {
    super(`task not found: ${id}`);
    this.name = "TaskNotFoundError";
  }
}

interface TaskRecord extends TaskSnapshot {
  timeout: NodeJS.Timeout | undefined;
  retry: NodeJS.Timeout | undefined;
}

export class TaskScheduler {
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly ready: string[] = [];
  private active = 0;
  private pumpScheduled = false;
  private closed = false;

  constructor(
    private readonly runner: TaskRunner,
    readonly options: SchedulerOptions,
  ) {
    for (const [name, value] of Object.entries(options)) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
      }
    }
  }

  submit(prompt: string, options: SubmitOptions = {}): TaskSnapshot {
    if (this.closed) throw new Error("scheduler is closed");
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: randomUUID(),
      sessionId: randomUUID(),
      prompt,
      state: "queued",
      attempts: 0,
      maxAttempts: positive(
        options.maxAttempts,
        this.options.defaultMaxAttempts,
      ),
      timeoutMs: positive(options.timeoutMs, this.options.defaultTimeoutMs),
      retryDelayMs: positive(
        options.retryDelayMs,
        this.options.defaultRetryDelayMs,
      ),
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      finalResponse: null,
      error: null,
      errors: [],
      cancellation: "none",
      timeout: undefined,
      retry: undefined,
    };
    this.tasks.set(task.id, task);
    this.ready.push(task.id);
    this.schedulePump();
    return snapshot(task);
  }

  get(id: string): TaskSnapshot {
    return snapshot(this.requireTask(id));
  }

  list(): TaskSnapshot[] {
    return [...this.tasks.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(snapshot);
  }

  status() {
    const counts: Record<TaskState, number> = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      timed_out: 0,
    };
    for (const task of this.tasks.values()) counts[task.state] += 1;
    return {
      concurrency: this.options.concurrency,
      activeSlots: this.active,
      ready: this.ready.filter((id) => this.tasks.get(id)?.state === "queued")
        .length,
      total: this.tasks.size,
      counts,
    };
  }

  async cancel(id: string, forceRuntime = false): Promise<TaskSnapshot> {
    const task = this.requireTask(id);
    if (terminal(task.state)) return snapshot(task);
    const wasRunning = task.state === "running";
    task.state = "cancelled";
    task.finishedAt = new Date().toISOString();
    task.error = null;
    task.cancellation = wasRunning ? "logical-running" : "queued";
    if (task.retry) {
      clearTimeout(task.retry);
      task.retry = undefined;
    }
    if (forceRuntime && wasRunning) {
      task.cancellation = "runtime-force";
      if (!this.runner.forceStop) {
        throw new Error("runner does not support Runtime force stop");
      }
      await this.runner.forceStop();
    }
    this.schedulePump();
    return snapshot(task);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const task of this.tasks.values()) {
      if (task.timeout) clearTimeout(task.timeout);
      if (task.retry) clearTimeout(task.retry);
      if (!terminal(task.state)) {
        task.state = "cancelled";
        task.cancellation = task.attempts === 0 ? "queued" : "logical-running";
        task.finishedAt = new Date().toISOString();
      }
    }
  }

  private requireTask(id: string): TaskRecord {
    const task = this.tasks.get(id);
    if (!task) throw new TaskNotFoundError(id);
    return task;
  }

  private schedulePump(): void {
    if (this.pumpScheduled || this.closed) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < this.options.concurrency) {
      const id = this.ready.shift();
      if (!id) return;
      const task = this.tasks.get(id);
      if (!task || task.state !== "queued") continue;
      this.startAttempt(task);
    }
  }

  private startAttempt(task: TaskRecord): void {
    this.active += 1;
    task.state = "running";
    task.attempts += 1;
    task.startedAt ??= new Date().toISOString();
    task.finishedAt = null;
    task.error = null;
    const attempt = task.attempts;
    task.timeout = setTimeout(() => {
      if (task.state !== "running" || task.attempts !== attempt) return;
      task.state = "timed_out";
      task.error = `attempt ${attempt} exceeded ${task.timeoutMs}ms`;
      task.finishedAt = new Date().toISOString();
    }, task.timeoutMs);
    task.timeout.unref();

    void this.runner
      .run(task.prompt, task.sessionId)
      .then((result) => this.succeeded(task, attempt, result))
      .catch((error: unknown) => this.failed(task, attempt, error))
      .finally(() => {
        if (task.timeout) {
          clearTimeout(task.timeout);
          task.timeout = undefined;
        }
        this.active -= 1;
        this.schedulePump();
      });
  }

  private succeeded(
    task: TaskRecord,
    attempt: number,
    result: RunResult,
  ): void {
    if (task.state !== "running" || task.attempts !== attempt) return;
    task.state = "completed";
    task.finalResponse = result.finalResponse;
    task.finishedAt = new Date().toISOString();
  }

  private failed(task: TaskRecord, attempt: number, error: unknown): void {
    if (task.state !== "running" || task.attempts !== attempt) return;
    const message = errorMessage(error);
    task.errors.push({
      attempt,
      message,
      at: new Date().toISOString(),
    });
    task.error = message;
    if (attempt >= task.maxAttempts) {
      task.state = "failed";
      task.finishedAt = new Date().toISOString();
      return;
    }
    task.state = "queued";
    task.retry = setTimeout(() => {
      task.retry = undefined;
      if (task.state !== "queued" || this.closed) return;
      this.ready.push(task.id);
      this.schedulePump();
    }, task.retryDelayMs);
    task.retry.unref();
  }
}

function snapshot(task: TaskRecord): TaskSnapshot {
  const { timeout: _timeout, retry: _retry, ...copy } = task;
  void _timeout;
  void _retry;
  return { ...copy, errors: copy.errors.map((error) => ({ ...error })) };
}

function positive(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("task options must be positive integers");
  }
  return value;
}

function terminal(state: TaskState): boolean {
  return (
    state === "completed" ||
    state === "failed" ||
    state === "cancelled" ||
    state === "timed_out"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
