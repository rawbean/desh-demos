import { randomUUID } from "node:crypto";
import {
  DeepSeekHarness,
  type DeepSeekHarnessOptions,
  type RunOptions,
  type RunResult,
} from "@deepseek-ai/dsh-sdk-client";

export type SessionState = "active" | "running" | "error" | "terminated";

export interface SessionView {
  id: string;
  state: SessionState;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
  terminatedAt: string | null;
  lastError: string | null;
}

export interface TurnResult {
  session: SessionView;
  finalResponse: string;
  eventCount: number;
  notificationCount: number;
}

export interface HarnessSessionClient {
  run(input: string, options: RunOptions): Promise<RunResult>;
  close(): Promise<void>;
}

type HarnessFactory = (options: DeepSeekHarnessOptions) => HarnessSessionClient;

interface SessionRecord extends SessionView {}

export class SessionNotFoundError extends Error {}
export class SessionBusyError extends Error {}
export class SessionTerminatedError extends Error {}
export class SessionManagerClosedError extends Error {}

const defaultFactory: HarnessFactory = (options) =>
  new DeepSeekHarness(options);

export class SessionManager {
  private readonly harness: HarnessSessionClient;
  private readonly sessions = new Map<string, SessionRecord>();
  private closed = false;
  private closeTask: Promise<void> | undefined;

  constructor(
    options: DeepSeekHarnessOptions,
    factory: HarnessFactory = defaultFactory,
  ) {
    this.harness = factory(options);
  }

  create(): SessionView {
    this.assertOpen();
    const now = new Date().toISOString();
    const session: SessionRecord = {
      id: randomUUID(),
      state: "active",
      turnCount: 0,
      createdAt: now,
      updatedAt: now,
      terminatedAt: null,
      lastError: null,
    };
    this.sessions.set(session.id, session);
    return this.copy(session);
  }

  list(): SessionView[] {
    return [...this.sessions.values()].map((session) => this.copy(session));
  }

  get(id: string): SessionView {
    return this.copy(this.requireSession(id));
  }

  async continue(id: string, prompt: string): Promise<TurnResult> {
    this.assertOpen();
    const input = prompt.trim();
    if (input.length === 0) throw new Error("prompt must not be empty");

    const session = this.requireSession(id);
    if (session.state === "terminated") {
      throw new SessionTerminatedError(`session ${id} is terminated`);
    }
    if (session.state === "running") {
      throw new SessionBusyError(`session ${id} already has a running turn`);
    }

    session.state = "running";
    session.updatedAt = new Date().toISOString();
    session.lastError = null;

    try {
      const result = await this.harness.run(input, { sessionId: id });
      session.state = "active";
      session.turnCount += 1;
      session.updatedAt = new Date().toISOString();
      return {
        session: this.copy(session),
        finalResponse: result.finalResponse,
        eventCount: result.events.length,
        notificationCount: result.notifications.length,
      };
    } catch (error) {
      session.state = "error";
      session.updatedAt = new Date().toISOString();
      session.lastError =
        error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  terminate(id: string): SessionView {
    this.assertOpen();
    const session = this.requireSession(id);
    if (session.state === "running") {
      throw new SessionBusyError(
        `session ${id} cannot be terminated while a turn is running`,
      );
    }
    if (session.state !== "terminated") {
      const now = new Date().toISOString();
      session.state = "terminated";
      session.updatedAt = now;
      session.terminatedAt = now;
    }
    return this.copy(session);
  }

  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closed = true;
    const now = new Date().toISOString();
    for (const session of this.sessions.values()) {
      if (session.state !== "terminated") {
        session.state = "terminated";
        session.updatedAt = now;
        session.terminatedAt = now;
      }
    }
    this.closeTask = this.harness.close();
    return this.closeTask;
  }

  private requireSession(id: string): SessionRecord {
    const session = this.sessions.get(id);
    if (!session) throw new SessionNotFoundError(`session ${id} was not found`);
    return session;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new SessionManagerClosedError("session manager is closed");
    }
  }

  private copy(session: SessionRecord): SessionView {
    return { ...session };
  }
}
