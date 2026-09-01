import { readFile, writeFile } from "node:fs/promises";

export type EventSource = "runtime-plugin" | "sdk";
export type EventCategory = "agent" | "llm" | "tool" | "notification";

export interface ExposedEvent {
  id: number;
  source: EventSource;
  category: EventCategory;
  hook: string;
  phase: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface PluginLine {
  source?: unknown;
  hook?: unknown;
  phase?: unknown;
  timestamp?: unknown;
  [key: string]: unknown;
}

export class EventStore {
  private events: ExposedEvent[] = [];
  private nextId = 1;

  constructor(
    private readonly pluginEventFile: string,
    private readonly limit = 500,
  ) {}

  async reset(): Promise<void> {
    this.events = [];
    this.nextId = 1;
    await writeFile(this.pluginEventFile, "", { mode: 0o600 });
  }

  addSdk(method: string, params: unknown): void {
    const innerType = extractInnerType(method, params);
    this.push({
      source: "sdk",
      category: classify(method, innerType),
      hook: innerType ?? method,
      phase: "notified",
      timestamp: new Date().toISOString(),
      data: { method, params },
    });
  }

  async syncPlugin(): Promise<void> {
    let contents: string;
    try {
      contents = await readFile(this.pluginEventFile, "utf8");
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }

    const sdkEvents = this.events.filter((event) => event.source === "sdk");
    const pluginEvents = contents
      .split("\n")
      .filter(Boolean)
      .map((line) => toPluginEvent(JSON.parse(line) as PluginLine));
    this.events = [...sdkEvents, ...pluginEvents]
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
      .slice(-this.limit)
      .map((event, index) => ({ ...event, id: index + 1 }));
    this.nextId = this.events.length + 1;
  }

  list(): ExposedEvent[] {
    return this.events.map((event) => ({
      ...event,
      data: { ...event.data },
    }));
  }

  counts(): Record<EventCategory, number> {
    return this.events.reduce<Record<EventCategory, number>>(
      (counts, event) => {
        counts[event.category] += 1;
        return counts;
      },
      { agent: 0, llm: 0, tool: 0, notification: 0 },
    );
  }

  private push(event: Omit<ExposedEvent, "id">): void {
    this.events.push({ id: this.nextId++, ...event });
    if (this.events.length > this.limit) this.events.shift();
  }
}

function toPluginEvent(line: PluginLine): ExposedEvent {
  const hook = typeof line.hook === "string" ? line.hook : "plugin/unknown";
  const data = Object.fromEntries(
    Object.entries(line).filter(
      ([key]) => !["source", "hook", "phase", "timestamp"].includes(key),
    ),
  );
  return {
    id: 0,
    source: "runtime-plugin",
    category: classifyPluginHook(hook),
    hook,
    phase: typeof line.phase === "string" ? line.phase : "observed",
    timestamp:
      typeof line.timestamp === "string"
        ? line.timestamp
        : new Date(0).toISOString(),
    data,
  };
}

function extractInnerType(method: string, params: unknown): string | undefined {
  if (
    method !== "session.event" ||
    typeof params !== "object" ||
    params === null ||
    !("event" in params)
  ) {
    return undefined;
  }
  const event = params.event;
  return typeof event === "object" &&
    event !== null &&
    "type" in event &&
    typeof event.type === "string"
    ? event.type
    : undefined;
}

function classify(method: string, type?: string): EventCategory {
  const name = type ?? method;
  if (name.startsWith("tool/")) return "tool";
  if (name.startsWith("request/") || name.startsWith("assistant/"))
    return "llm";
  if (
    name.startsWith("turn/") ||
    name.startsWith("step/") ||
    name.startsWith("agent/") ||
    name.startsWith("subagent.")
  ) {
    return "agent";
  }
  return "notification";
}

function classifyPluginHook(hook: string): EventCategory {
  if (hook.startsWith("tools/")) return "tool";
  if (hook.startsWith("llm/")) return "llm";
  if (hook.startsWith("agent/")) return "agent";
  return "notification";
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
