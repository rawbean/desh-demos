import { randomUUID } from "node:crypto";
import { NotificationObserver } from "./notification-observer.js";
import { ObservabilityStore } from "./observability-store.js";
import { RuntimeManager } from "./runtime-manager.js";

export class TaskService {
  constructor(
    private readonly runtime: RuntimeManager,
    private readonly store: ObservabilityStore,
  ) {}

  submit(prompt: string) {
    const id = randomUUID();
    const traceId = randomUUID();
    const sessionId = randomUUID();
    this.store.createTask(id, traceId, sessionId, new Date().toISOString());
    queueMicrotask(() => void this.execute(id, traceId, sessionId, prompt));
    return {
      id,
      traceId,
      statusUrl: `/tasks/${id}`,
      traceUrl: `/traces/${traceId}`,
    };
  }

  private async execute(
    taskId: string,
    traceId: string,
    sessionId: string,
    prompt: string,
  ): Promise<void> {
    const startedAt = new Date();
    const started = process.hrtime.bigint();
    this.store.startTask(taskId, startedAt.toISOString());
    this.store.addEvent(
      traceId,
      "notification",
      "task.started",
      startedAt.toISOString(),
    );
    const observer = new NotificationObserver(this.store, traceId);
    try {
      await this.runtime.run(prompt, sessionId, (event) =>
        observer.observe(event),
      );
      const endedAt = new Date();
      const durationMs = elapsedMilliseconds(started);
      this.store.addEvent(
        traceId,
        "notification",
        "task.completed",
        endedAt.toISOString(),
        { durationMs },
      );
      this.store.finishTask(
        taskId,
        "completed",
        endedAt.toISOString(),
        durationMs,
        null,
      );
    } catch (error) {
      const endedAt = new Date();
      const durationMs = elapsedMilliseconds(started);
      const safeError = sanitizeError(error);
      this.store.addEvent(
        traceId,
        "notification",
        "task.failed",
        endedAt.toISOString(),
        { durationMs, error: safeError },
      );
      this.store.finishTask(
        taskId,
        "failed",
        endedAt.toISOString(),
        durationMs,
        safeError,
      );
    }
  }
}

export function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(
      /((?:api[-_]?key|token|secret|password)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .slice(0, 512);
}

function elapsedMilliseconds(started: bigint): number {
  return Math.max(
    1,
    Math.round(Number(process.hrtime.bigint() - started) / 1e6),
  );
}
