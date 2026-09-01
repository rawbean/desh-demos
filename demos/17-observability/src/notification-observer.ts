import type { HarnessNotification } from "@deepseek-ai/dsh-sdk-client";
import {
  type EventCategory,
  ObservabilityStore,
} from "./observability-store.js";

interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export class NotificationObserver {
  private readonly seenUsage = new Set<string>();

  constructor(
    private readonly store: ObservabilityStore,
    private readonly traceId: string,
  ) {}

  observe(notification: HarnessNotification): void {
    const eventType = sessionEventType(notification);
    const category = classify(notification.method, eventType);
    const usage = extractUsage(notification.params);
    const data: Record<string, string | number | boolean | null> = {
      method: notification.method.slice(0, 120),
    };
    if (usage) {
      data.promptTokens = usage.promptTokens;
      data.completionTokens = usage.completionTokens;
      data.totalTokens = usage.totalTokens;
      const key = JSON.stringify(usage);
      if (!this.seenUsage.has(key)) {
        this.seenUsage.add(key);
        this.store.addUsage(
          this.traceId,
          usage.promptTokens,
          usage.completionTokens,
          usage.totalTokens,
        );
      }
    }
    this.store.addEvent(
      this.traceId,
      category,
      eventType ?? notification.method,
      new Date().toISOString(),
      data,
    );
  }
}

export function classify(method: string, eventType?: string): EventCategory {
  if (eventType?.startsWith("tool/")) return "tool";
  if (
    eventType?.startsWith("assistant/") ||
    eventType?.startsWith("request/") ||
    eventType?.includes("usage")
  ) {
    return "model";
  }
  if (
    eventType?.startsWith("turn/") ||
    eventType?.startsWith("step/") ||
    method === "session.status" ||
    method.startsWith("subagent.")
  ) {
    return "agent";
  }
  return "notification";
}

function sessionEventType(
  notification: HarnessNotification,
): string | undefined {
  if (notification.method !== "session.event") return undefined;
  const event = Reflect.get(notification.params, "event");
  if (typeof event !== "object" || event === null || Array.isArray(event)) {
    return undefined;
  }
  const type = Reflect.get(event, "type");
  return typeof type === "string" ? type : undefined;
}

function extractUsage(value: unknown, depth = 0): Usage | undefined {
  if (depth > 5 || typeof value !== "object" || value === null)
    return undefined;
  const record = value as Record<string, unknown>;
  const promptTokens = numeric(record.prompt_tokens ?? record.promptTokens);
  const completionTokens = numeric(
    record.completion_tokens ?? record.completionTokens,
  );
  const totalTokens = numeric(record.total_tokens ?? record.totalTokens);
  if (
    promptTokens !== undefined ||
    completionTokens !== undefined ||
    totalTokens !== undefined
  ) {
    const prompt = promptTokens ?? 0;
    const completion = completionTokens ?? 0;
    return {
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: totalTokens ?? prompt + completion,
    };
  }
  for (const child of Object.values(record)) {
    const usage = extractUsage(child, depth + 1);
    if (usage) return usage;
  }
  return undefined;
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}
