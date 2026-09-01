import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type EventCategory = "agent" | "model" | "tool" | "notification";
export type TaskState = "queued" | "running" | "completed" | "failed";

export interface StoredEvent {
  id: number;
  traceId: string;
  category: EventCategory;
  type: string;
  timestamp: string;
  data: Record<string, string | number | boolean | null>;
}

export interface TaskView {
  id: string;
  traceId: string;
  sessionId: string;
  state: TaskState;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  error: string | null;
}

export interface TraceView {
  id: string;
  taskId: string;
  sessionId: string;
  status: TaskState;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  eventCount: number;
}

export interface MetricsView {
  traceId: string;
  durationMs: number | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  eventCount: number;
  errorCount: number;
  categoryCounts: Record<EventCategory, number>;
}

export class NotFoundError extends Error {
  constructor(kind: string, id: string) {
    super(`${kind} ${id} was not found`);
    this.name = "NotFoundError";
  }
}

export class ObservabilityStore {
  private readonly db: DatabaseSync;

  constructor(
    databasePath: string,
    private readonly eventLimit = 200,
  ) {
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL,
        status TEXT NOT NULL, started_at TEXT, ended_at TEXT, duration_ms INTEGER
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, trace_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL,
        state TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT,
        completed_at TEXT, duration_ms INTEGER, error TEXT,
        FOREIGN KEY(trace_id) REFERENCES traces(id)
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, trace_id TEXT NOT NULL,
        category TEXT NOT NULL, type TEXT NOT NULL, timestamp TEXT NOT NULL,
        data_json TEXT NOT NULL, FOREIGN KEY(trace_id) REFERENCES traces(id)
      );
      CREATE INDEX IF NOT EXISTS events_trace_id ON events(trace_id, id);
      CREATE TABLE IF NOT EXISTS metrics (
        trace_id TEXT PRIMARY KEY, prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(trace_id) REFERENCES traces(id)
      );
    `);
  }

  createTask(
    id: string,
    traceId: string,
    sessionId: string,
    now: string,
  ): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO traces(id,task_id,session_id,status) VALUES(?,?,?,'queued')",
        )
        .run(traceId, id, sessionId);
      this.db
        .prepare(
          "INSERT INTO tasks(id,trace_id,session_id,state,created_at) VALUES(?,?,?,'queued',?)",
        )
        .run(id, traceId, sessionId, now);
      this.db.prepare("INSERT INTO metrics(trace_id) VALUES(?)").run(traceId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  startTask(id: string, now: string): void {
    this.db
      .prepare("UPDATE tasks SET state='running',started_at=? WHERE id=?")
      .run(now, id);
    this.db
      .prepare(
        "UPDATE traces SET status='running',started_at=? WHERE task_id=?",
      )
      .run(now, id);
  }

  finishTask(
    id: string,
    state: "completed" | "failed",
    now: string,
    durationMs: number,
    error: string | null,
  ): void {
    this.db
      .prepare(
        "UPDATE tasks SET state=?,completed_at=?,duration_ms=?,error=? WHERE id=?",
      )
      .run(state, now, durationMs, error, id);
    this.db
      .prepare(
        "UPDATE traces SET status=?,ended_at=?,duration_ms=? WHERE task_id=?",
      )
      .run(state, now, durationMs, id);
    if (state === "failed") {
      this.db
        .prepare(
          "UPDATE metrics SET error_count=error_count+1 WHERE trace_id=(SELECT trace_id FROM tasks WHERE id=?)",
        )
        .run(id);
    }
  }

  addEvent(
    traceId: string,
    category: EventCategory,
    type: string,
    timestamp: string,
    data: Record<string, string | number | boolean | null> = {},
  ): void {
    this.db
      .prepare(
        "INSERT INTO events(trace_id,category,type,timestamp,data_json) VALUES(?,?,?,?,?)",
      )
      .run(
        traceId,
        category,
        type.slice(0, 120),
        timestamp,
        JSON.stringify(data),
      );
    this.db
      .prepare(
        `DELETE FROM events WHERE trace_id=? AND id NOT IN
         (SELECT id FROM events WHERE trace_id=? ORDER BY id DESC LIMIT ?)`,
      )
      .run(traceId, traceId, this.eventLimit);
  }

  addUsage(
    traceId: string,
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
  ): void {
    this.db
      .prepare(
        `UPDATE metrics SET prompt_tokens=prompt_tokens+?,
         completion_tokens=completion_tokens+?,total_tokens=total_tokens+?
         WHERE trace_id=?`,
      )
      .run(promptTokens, completionTokens, totalTokens, traceId);
  }

  getTask(id: string): TaskView {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
    if (!row) throw new NotFoundError("task", id);
    return taskView(row);
  }

  getTrace(id: string): TraceView {
    const row = this.db
      .prepare(
        "SELECT t.*,(SELECT COUNT(*) FROM events e WHERE e.trace_id=t.id) event_count FROM traces t WHERE id=?",
      )
      .get(id);
    if (!row) throw new NotFoundError("trace", id);
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      sessionId: String(row.session_id),
      status: row.status as TaskState,
      startedAt: nullableString(row.started_at),
      endedAt: nullableString(row.ended_at),
      durationMs: nullableNumber(row.duration_ms),
      eventCount: Number(row.event_count),
    };
  }

  getEvents(traceId: string, limit: number): StoredEvent[] {
    this.getTrace(traceId);
    const rows = this.db
      .prepare("SELECT * FROM events WHERE trace_id=? ORDER BY id LIMIT ?")
      .all(traceId, Math.min(limit, this.eventLimit));
    return rows.map((row) => ({
      id: Number(row.id),
      traceId: String(row.trace_id),
      category: row.category as EventCategory,
      type: String(row.type),
      timestamp: String(row.timestamp),
      data: JSON.parse(String(row.data_json)) as StoredEvent["data"],
    }));
  }

  getMetrics(traceId: string): MetricsView {
    const trace = this.getTrace(traceId);
    const row = this.db
      .prepare("SELECT * FROM metrics WHERE trace_id=?")
      .get(traceId);
    if (!row) throw new NotFoundError("metrics for trace", traceId);
    const categoryCounts = {
      agent: 0,
      model: 0,
      tool: 0,
      notification: 0,
    };
    for (const count of this.db
      .prepare(
        "SELECT category,COUNT(*) count FROM events WHERE trace_id=? GROUP BY category",
      )
      .all(traceId)) {
      categoryCounts[count.category as EventCategory] = Number(count.count);
    }
    return {
      traceId,
      durationMs: trace.durationMs,
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      totalTokens: Number(row.total_tokens),
      eventCount: Object.values(categoryCounts).reduce((a, b) => a + b, 0),
      errorCount: Number(row.error_count),
      categoryCounts,
    };
  }

  close(): void {
    this.db.close();
  }
}

function taskView(row: Record<string, unknown>): TaskView {
  return {
    id: String(row.id),
    traceId: String(row.trace_id),
    sessionId: String(row.session_id),
    state: row.state as TaskState,
    createdAt: String(row.created_at),
    startedAt: nullableString(row.started_at),
    completedAt: nullableString(row.completed_at),
    durationMs: nullableNumber(row.duration_ms),
    error: nullableString(row.error),
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
