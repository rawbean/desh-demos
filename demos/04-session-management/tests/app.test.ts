import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  SessionManager,
  type HarnessSessionClient,
} from "../src/session-manager.js";

function createManager(): SessionManager {
  const harness: HarnessSessionClient = {
    run: async (input, options) => ({
      sessionId: options.sessionId ?? "missing",
      finalResponse: `reply:${input}`,
      events: [],
      notifications: [],
    }),
    close: async () => undefined,
  };
  return new SessionManager({}, () => harness);
}

describe("session control API", () => {
  it("covers create, continue, query, list and terminate", async () => {
    const app = buildApp({ manager: createManager(), logger: false });

    const created = await app.inject({ method: "POST", url: "/sessions" });
    expect(created.statusCode).toBe(201);
    const session = created.json<{ id: string }>();

    const turn = await app.inject({
      method: "POST",
      url: `/sessions/${session.id}/turns`,
      payload: { prompt: "hello" },
    });
    expect(turn.statusCode).toBe(200);
    expect(turn.json()).toMatchObject({
      finalResponse: "reply:hello",
      session: { id: session.id, turnCount: 1, state: "active" },
    });

    const queried = await app.inject({
      method: "GET",
      url: `/sessions/${session.id}`,
    });
    expect(queried.json()).toMatchObject({ id: session.id, turnCount: 1 });

    const listed = await app.inject({ method: "GET", url: "/sessions" });
    expect(listed.json<{ sessions: unknown[] }>().sessions).toHaveLength(1);

    const terminated = await app.inject({
      method: "DELETE",
      url: `/sessions/${session.id}`,
    });
    expect(terminated.json()).toMatchObject({ state: "terminated" });

    const rejected = await app.inject({
      method: "POST",
      url: `/sessions/${session.id}/turns`,
      payload: { prompt: "again" },
    });
    expect(rejected.statusCode).toBe(409);

    await app.close();
  });

  it("returns explicit validation and lookup errors", async () => {
    const app = buildApp({ manager: createManager(), logger: false });

    const invalid = await app.inject({
      method: "POST",
      url: "/sessions/unknown/turns",
      payload: { prompt: " " },
    });
    expect(invalid.statusCode).toBe(400);

    const missing = await app.inject({
      method: "GET",
      url: "/sessions/unknown",
    });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });
});
