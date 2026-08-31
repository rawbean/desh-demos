import { describe, expect, it, vi } from "vitest";
import {
  SessionBusyError,
  SessionManager,
  SessionTerminatedError,
  type HarnessSessionClient,
} from "../src/session-manager.js";

function createHarness(): HarnessSessionClient {
  const turns = new Map<string, string[]>();
  return {
    run: vi.fn(async (input, options) => {
      const sessionId = options.sessionId;
      if (!sessionId) throw new Error("missing session id");
      const history = turns.get(sessionId) ?? [];
      const finalResponse =
        history.length === 0 ? `remembered:${input}` : `previous:${history[0]}`;
      history.push(input);
      turns.set(sessionId, history);
      return {
        sessionId,
        finalResponse,
        events: [],
        notifications: [],
      };
    }),
    close: vi.fn(async () => undefined),
  };
}

describe("SessionManager", () => {
  it("creates and queries a session without starting a turn", () => {
    const manager = new SessionManager({}, () => createHarness());

    const created = manager.create();

    expect(created).toMatchObject({ state: "active", turnCount: 0 });
    expect(manager.get(created.id)).toEqual(created);
    expect(manager.list()).toEqual([created]);
  });

  it("continues the same SDK session across multiple turns", async () => {
    const harness = createHarness();
    const manager = new SessionManager({}, () => harness);
    const session = manager.create();

    const first = await manager.continue(session.id, "blue");
    const second = await manager.continue(session.id, "what was it?");

    expect(first.finalResponse).toBe("remembered:blue");
    expect(second.finalResponse).toBe("previous:blue");
    expect(second.session.turnCount).toBe(2);
    expect(harness.run).toHaveBeenNthCalledWith(1, "blue", {
      sessionId: session.id,
    });
    expect(harness.run).toHaveBeenNthCalledWith(2, "what was it?", {
      sessionId: session.id,
    });
  });

  it("rejects overlap and termination while a turn is running", async () => {
    let finish!: () => void;
    const harness = createHarness();
    vi.mocked(harness.run).mockImplementationOnce(
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
    const manager = new SessionManager({}, () => harness);
    const session = manager.create();
    const running = manager.continue(session.id, "wait");

    await expect(
      manager.continue(session.id, "overlap"),
    ).rejects.toBeInstanceOf(SessionBusyError);
    expect(() => manager.terminate(session.id)).toThrow(SessionBusyError);

    finish();
    await running;
  });

  it("terminates idempotently and rejects later turns", async () => {
    const manager = new SessionManager({}, () => createHarness());
    const session = manager.create();

    const first = manager.terminate(session.id);
    const second = manager.terminate(session.id);

    expect(first.state).toBe("terminated");
    expect(second.terminatedAt).toBe(first.terminatedAt);
    await expect(manager.continue(session.id, "again")).rejects.toBeInstanceOf(
      SessionTerminatedError,
    );
  });

  it("records turn failures and closes the owned runtime once", async () => {
    const harness = createHarness();
    vi.mocked(harness.run).mockRejectedValueOnce(
      new Error("model unavailable"),
    );
    const manager = new SessionManager({}, () => harness);
    const session = manager.create();

    await expect(manager.continue(session.id, "hello")).rejects.toThrow(
      "model unavailable",
    );
    expect(manager.get(session.id)).toMatchObject({
      state: "error",
      lastError: "model unavailable",
    });

    await Promise.all([manager.close(), manager.close()]);
    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(manager.get(session.id).state).toBe("terminated");
  });
});
