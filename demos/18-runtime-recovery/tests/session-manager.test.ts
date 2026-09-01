import { describe, expect, it, vi } from "vitest";
import { RuntimeManager, type RuntimeHarness } from "../src/runtime-manager.js";
import {
  SessionBusyError,
  SessionManager,
  SessionTerminatedError,
} from "../src/session-manager.js";

function createHarness(history: Map<string, string[]>): RuntimeHarness {
  let crash: ((error: Error) => void) | undefined;
  return {
    start: vi.fn(async () => undefined),
    run: vi.fn(async (input, options) => {
      const id = options.sessionId ?? "missing";
      const turns = history.get(id) ?? [];
      const finalResponse =
        turns.length === 0 ? "remembered:blue" : "context-ok";
      turns.push(input);
      history.set(id, turns);
      return {
        sessionId: id,
        finalResponse,
        events: [],
        notifications: [],
      };
    }),
    close: vi.fn(async () => undefined),
    watchCrash: vi.fn((listener) => {
      crash = listener;
      return () => {
        crash = undefined;
      };
    }),
    crashForTest: vi.fn(() => {
      queueMicrotask(() => crash?.(new Error("transport closed")));
      return true;
    }),
  };
}

describe("SessionManager recovery control plane", () => {
  it("suspends sessions and restores metadata across a recovery", async () => {
    const history = new Map<string, string[]>();
    const runtime = new RuntimeManager({}, () => createHarness(history));
    const sessions = new SessionManager(runtime);
    await runtime.start();
    const session = sessions.create();

    await sessions.continue(session.id, "remember blue");
    await runtime.crashForTest();
    expect(sessions.get(session.id).state).toBe("suspended");

    await runtime.recover();
    const second = await sessions.continue(
      session.id,
      "what was it?",
      "context-ok",
    );

    expect(second.finalResponse).toBe("context-ok");
    expect(second.session).toMatchObject({
      id: session.id,
      state: "active",
      turnCount: 2,
      recoveryGeneration: 1,
      contextContinuity: "preserved",
    });
    await sessions.close();
  });

  it("keeps context claims unverified without an explicit probe", async () => {
    const runtime = new RuntimeManager({}, () => createHarness(new Map()));
    const sessions = new SessionManager(runtime);
    await runtime.start();
    const session = sessions.create();
    await sessions.continue(session.id, "hello");
    await runtime.crashForTest();
    await runtime.recover();
    await sessions.continue(session.id, "again");

    expect(sessions.get(session.id).contextContinuity).toBe("unverified");
    await sessions.close();
  });

  it("terminates idempotently and rejects future turns", async () => {
    const runtime = new RuntimeManager({}, () => createHarness(new Map()));
    const sessions = new SessionManager(runtime);
    await runtime.start();
    const session = sessions.create();

    const first = sessions.terminate(session.id);
    const second = sessions.terminate(session.id);

    expect(second.terminatedAt).toBe(first.terminatedAt);
    await expect(sessions.continue(session.id, "again")).rejects.toBeInstanceOf(
      SessionTerminatedError,
    );
    await sessions.close();
  });

  it("rejects overlapping turns and termination while running", async () => {
    let finish!: () => void;
    const instance = createHarness(new Map());
    vi.mocked(instance.run).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              sessionId: "session",
              finalResponse: "done",
              events: [],
              notifications: [],
            });
        }),
    );
    const runtime = new RuntimeManager({}, () => instance);
    const sessions = new SessionManager(runtime);
    await runtime.start();
    const session = sessions.create();
    const running = sessions.continue(session.id, "wait");

    await expect(
      sessions.continue(session.id, "overlap"),
    ).rejects.toBeInstanceOf(SessionBusyError);
    expect(() => sessions.terminate(session.id)).toThrow(SessionBusyError);
    finish();
    await running;
    await sessions.close();
  });
});
