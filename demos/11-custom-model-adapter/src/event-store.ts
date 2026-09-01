import { readFile, writeFile } from "node:fs/promises";
import type { HarnessNotification } from "@deepseek-ai/dsh-sdk-client";

export interface DemoEvent {
  source: "runtime-adapter" | "sdk";
  event: string;
  timestamp: string;
  [key: string]: unknown;
}

export class EventStore {
  private sdkEvents: DemoEvent[] = [];

  constructor(
    readonly file: string,
    private readonly limit = 500,
  ) {}

  async reset(): Promise<void> {
    this.sdkEvents = [];
    await writeFile(this.file, "", { encoding: "utf8", mode: 0o600 });
  }

  addSdk(notification: HarnessNotification): void {
    this.sdkEvents.push({
      source: "sdk",
      event: notification.method,
      timestamp: new Date().toISOString(),
      details: sdkDetails(notification.params),
    });
    if (this.sdkEvents.length > this.limit) this.sdkEvents.shift();
  }

  async list(): Promise<DemoEvent[]> {
    let adapterEvents: DemoEvent[] = [];
    try {
      const content = await readFile(this.file, "utf8");
      adapterEvents = content
        .split("\n")
        .filter(Boolean)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as DemoEvent];
          } catch {
            return [];
          }
        });
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    return [...adapterEvents, ...this.sdkEvents]
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
      .slice(-this.limit);
  }
}

function sdkDetails(params: unknown): Record<string, unknown> {
  if (!isRecord(params)) return {};
  const details: Record<string, unknown> = {};
  if (typeof params.sessionId === "string")
    details.sessionId = params.sessionId;
  if (typeof params.status === "string") details.status = params.status;
  if (isRecord(params.event)) {
    if (typeof params.event.type === "string") {
      details.eventType = params.event.type;
    }
    if (typeof params.event.seq === "number")
      details.sequence = params.event.seq;
  }
  return details;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
