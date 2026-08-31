import type { HarnessNotification } from "@deepseek-ai/dsh-sdk-client";

export type EventCategory = "agent" | "model" | "tool" | "notification";

export interface StreamEvent {
  id: number;
  taskId: string;
  sessionId: string;
  category: EventCategory;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

function sessionEventType(
  notification: HarnessNotification,
): string | undefined {
  if (notification.method !== "session.event") return undefined;
  const event = notification.params.event;
  if (typeof event !== "object" || event === null || Array.isArray(event)) {
    return undefined;
  }
  return typeof Reflect.get(event, "type") === "string"
    ? (Reflect.get(event, "type") as string)
    : undefined;
}

export function classifyNotification(
  notification: HarnessNotification,
): Pick<StreamEvent, "category" | "type"> {
  const eventType = sessionEventType(notification);

  if (eventType?.startsWith("tool/")) {
    return { category: "tool", type: eventType };
  }
  if (
    eventType?.startsWith("assistant/") ||
    eventType?.startsWith("request/")
  ) {
    return { category: "model", type: eventType };
  }
  if (
    eventType?.startsWith("turn/") ||
    eventType?.startsWith("step/") ||
    notification.method === "session.status" ||
    notification.method.startsWith("subagent.")
  ) {
    return { category: "agent", type: eventType ?? notification.method };
  }

  return {
    category: "notification",
    type: eventType ?? notification.method,
  };
}
