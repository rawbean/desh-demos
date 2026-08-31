import { randomUUID } from "node:crypto";
import type { HarnessNotification } from "@deepseek-ai/dsh-sdk-client";
import {
  classifyNotification,
  type EventCategory,
  type StreamEvent,
} from "./event-types.js";
import type { RuntimeManager } from "./runtime-manager.js";

export type TaskState = "queued" | "running" | "completed" | "failed";

export interface TaskSnapshot {
  id: string;
  sessionId: string;
  state: TaskState;
  finalResponse: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  eventCount: number;
  categoryCounts: Record<EventCategory, number>;
}

interface TaskRecord extends TaskSnapshot {
  nextEventId: number;
  events: StreamEvent[];
  subscribers: Set<(event: StreamEvent) => void>;
}

export interface TaskSubmission {
  id: string;
  sessionId: string;
  statusUrl: string;
  eventsUrl: string;
}

export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`task ${taskId} was not found`);
    this.name = "TaskNotFoundError";
  }
}

export class TaskStreamService {
  private readonly tasks = new Map<string, TaskRecord>();

  constructor(
    private readonly runtime: RuntimeManager,
    private readonly historyLimit = 1000,
    private readonly taskLimit = 100,
  ) {}

  submit(prompt: string): TaskSubmission {
    this.evictCompletedTasks();
    const id = randomUUID();
    const sessionId = randomUUID();
    const createdAt = new Date().toISOString();
    const task: TaskRecord = {
      id,
      sessionId,
      state: "queued",
      finalResponse: null,
      error: null,
      createdAt,
      completedAt: null,
      eventCount: 0,
      categoryCounts: {
        agent: 0,
        model: 0,
        tool: 0,
        notification: 0,
      },
      nextEventId: 1,
      events: [],
      subscribers: new Set(),
    };
    this.tasks.set(id, task);
    queueMicrotask(() => void this.execute(task, prompt));

    return {
      id,
      sessionId,
      statusUrl: `/tasks/${id}`,
      eventsUrl: `/tasks/${id}/events`,
    };
  }

  get(taskId: string): TaskSnapshot {
    const task = this.requireTask(taskId);
    return this.snapshot(task);
  }

  subscribe(
    taskId: string,
    afterEventId: number,
    listener: (event: StreamEvent) => void,
  ): { snapshot: TaskSnapshot; unsubscribe: () => void } {
    const task = this.requireTask(taskId);
    for (const event of task.events) {
      if (event.id > afterEventId) listener(event);
    }
    task.subscribers.add(listener);
    return {
      snapshot: this.snapshot(task),
      unsubscribe: () => task.subscribers.delete(listener),
    };
  }

  subscriberCount(taskId: string): number {
    return this.requireTask(taskId).subscribers.size;
  }

  private async execute(task: TaskRecord, prompt: string): Promise<void> {
    task.state = "running";
    this.publish(task, "notification", "task.started", {
      createdAt: task.createdAt,
    });

    try {
      const result = await this.runtime.run(
        prompt,
        task.sessionId,
        (notification) => this.publishNotification(task, notification),
      );
      task.state = "completed";
      task.finalResponse = result.finalResponse;
      task.completedAt = new Date().toISOString();
      this.publish(task, "notification", "task.completed", {
        finalResponse: result.finalResponse,
        sdkEventCount: result.events.length,
        sdkNotificationCount: result.notifications.length,
      });
    } catch (error) {
      task.state = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      task.completedAt = new Date().toISOString();
      this.publish(task, "notification", "task.failed", {
        error: task.error,
      });
    }
  }

  private publishNotification(
    task: TaskRecord,
    notification: HarnessNotification,
  ): void {
    const classified = classifyNotification(notification);
    this.publish(task, classified.category, classified.type, {
      method: notification.method,
      params: notification.params,
    });
  }

  private publish(
    task: TaskRecord,
    category: EventCategory,
    type: string,
    data: Record<string, unknown>,
  ): void {
    const event: StreamEvent = {
      id: task.nextEventId++,
      taskId: task.id,
      sessionId: task.sessionId,
      category,
      type,
      timestamp: new Date().toISOString(),
      data,
    };
    task.eventCount += 1;
    task.categoryCounts[category] += 1;
    task.events.push(event);
    if (task.events.length > this.historyLimit) task.events.shift();
    for (const listener of task.subscribers) {
      try {
        listener(event);
      } catch {
        task.subscribers.delete(listener);
      }
    }
  }

  private requireTask(taskId: string): TaskRecord {
    const task = this.tasks.get(taskId);
    if (!task) throw new TaskNotFoundError(taskId);
    return task;
  }

  private snapshot(task: TaskRecord): TaskSnapshot {
    return {
      id: task.id,
      sessionId: task.sessionId,
      state: task.state,
      finalResponse: task.finalResponse,
      error: task.error,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
      eventCount: task.eventCount,
      categoryCounts: { ...task.categoryCounts },
    };
  }

  private evictCompletedTasks(): void {
    if (this.tasks.size < this.taskLimit) return;
    for (const [id, task] of this.tasks) {
      if (
        task.subscribers.size === 0 &&
        (task.state === "completed" || task.state === "failed")
      ) {
        this.tasks.delete(id);
        if (this.tasks.size < this.taskLimit) return;
      }
    }
  }
}
