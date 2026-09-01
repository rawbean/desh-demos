import { randomUUID } from "node:crypto";
import type { RunResult } from "@deepseek-ai/dsh-sdk-client";
import {
  RuntimeManager,
  RuntimeUnavailableError,
  type RuntimeStatus,
} from "./runtime-manager.js";

export type SessionState = "active" | "running" | "suspended" | "terminated";
export type ContextContinuity = "unverified" | "preserved" | "lost";

export interface SessionView {
  id: string;
  state: SessionState;
  turnCount: number;
  recoveryGeneration: number;
  contextContinuity: ContextContinuity;
  contextProbeExpected: string | null;
  contextProbeObserved: string | null;
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

interface SessionRecord extends SessionView {
  inFlight: boolean;
  lastSuccessfulGeneration: number;
}

export class SessionNotFoundError extends Error {}
export class SessionBusyError extends Error {}
export class SessionTerminatedError extends Error {}
export class SessionManagerClosedError extends Error {}

export class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly unsubscribe: () => void;
  private closed = false;
  private closeTask: Promise<void> | undefined;

  constructor(private readonly runtime: RuntimeManager) {
    this.unsubscribe = runtime.onStateChange((status) =>
      this.handleRuntimeState(status),
    );
  }

  create(): SessionView {
    this.assertOpen();
    const now = new Date().toISOString();
    const generation = this.runtime.status().recoveryGeneration;
    const session: SessionRecord = {
      id: randomUUID(),
      state: this.runtime.status().state === "running" ? "active" : "suspended",
      turnCount: 0,
      recoveryGeneration: generation,
      contextContinuity: "unverified",
      contextProbeExpected: null,
      contextProbeObserved: null,
      createdAt: now,
      updatedAt: now,
      terminatedAt: null,
      lastError: null,
      inFlight: false,
      lastSuccessfulGeneration: generation,
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

  async continue(
    id: string,
    prompt: string,
    expectedResponse?: string,
  ): Promise<TurnResult> {
    this.assertOpen();
    const input = prompt.trim();
    if (input.length === 0) throw new Error("prompt must not be empty");

    const session = this.requireSession(id);
    if (session.state === "terminated") {
      throw new SessionTerminatedError(`session ${id} is terminated`);
    }
    if (session.inFlight) {
      throw new SessionBusyError(`session ${id} already has a running turn`);
    }
    if (this.runtime.status().state !== "running") {
      session.state = "suspended";
      throw new RuntimeUnavailableError(
        `runtime is ${this.runtime.status().state}`,
      );
    }

    session.inFlight = true;
    session.state = "running";
    session.updatedAt = new Date().toISOString();
    session.lastError = null;
    const generationBeforeRun = this.runtime.status().recoveryGeneration;

    try {
      const result: RunResult = await this.runtime.run(input, {
        sessionId: id,
      });
      session.turnCount += 1;
      session.updatedAt = new Date().toISOString();
      session.recoveryGeneration = generationBeforeRun;
      if (
        expectedResponse !== undefined &&
        session.turnCount > 1 &&
        generationBeforeRun > session.lastSuccessfulGeneration
      ) {
        session.contextProbeExpected = expectedResponse;
        session.contextProbeObserved = result.finalResponse;
        session.contextContinuity =
          result.finalResponse === expectedResponse ? "preserved" : "lost";
      }
      session.lastSuccessfulGeneration = generationBeforeRun;
      session.state = "active";
      return {
        session: this.copy(session),
        finalResponse: result.finalResponse,
        eventCount: result.events.length,
        notificationCount: result.notifications.length,
      };
    } catch (error) {
      session.updatedAt = new Date().toISOString();
      session.lastError =
        error instanceof Error ? error.message : String(error);
      session.state =
        this.runtime.status().state === "running" ? "active" : "suspended";
      throw error;
    } finally {
      session.inFlight = false;
    }
  }

  terminate(id: string): SessionView {
    this.assertOpen();
    const session = this.requireSession(id);
    if (session.inFlight) {
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

  recoveryStatus() {
    const sessions = this.list();
    return {
      runtime: this.runtime.status(),
      sessions: {
        active: sessions.filter((session) => session.state === "active").length,
        running: sessions.filter((session) => session.state === "running")
          .length,
        suspended: sessions.filter((session) => session.state === "suspended")
          .length,
        terminated: sessions.filter((session) => session.state === "terminated")
          .length,
      },
      continuity: {
        preserved: sessions.filter(
          (session) => session.contextContinuity === "preserved",
        ).length,
        lost: sessions.filter((session) => session.contextContinuity === "lost")
          .length,
        unverified: sessions.filter(
          (session) => session.contextContinuity === "unverified",
        ).length,
      },
    };
  }

  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closed = true;
    this.unsubscribe();
    const now = new Date().toISOString();
    for (const session of this.sessions.values()) {
      if (session.state !== "terminated") {
        session.state = "terminated";
        session.updatedAt = now;
        session.terminatedAt = now;
      }
    }
    this.closeTask = this.runtime.close();
    return this.closeTask;
  }

  private handleRuntimeState(status: RuntimeStatus): void {
    const now = new Date().toISOString();
    for (const session of this.sessions.values()) {
      if (session.state === "terminated") continue;
      if (status.state === "crashed" || status.state === "failed") {
        session.state = "suspended";
        session.lastError = status.lastError;
        session.updatedAt = now;
      } else if (status.state === "running" && session.state === "suspended") {
        session.state = "active";
        session.recoveryGeneration = status.recoveryGeneration;
        session.updatedAt = now;
      }
    }
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
    return {
      id: session.id,
      state: session.state,
      turnCount: session.turnCount,
      recoveryGeneration: session.recoveryGeneration,
      contextContinuity: session.contextContinuity,
      contextProbeExpected: session.contextProbeExpected,
      contextProbeObserved: session.contextProbeObserved,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      terminatedAt: session.terminatedAt,
      lastError: session.lastError,
    };
  }
}
