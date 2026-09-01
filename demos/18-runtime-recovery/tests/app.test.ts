import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { RuntimeManager, type RuntimeHarness } from "../src/runtime-manager.js";

function createRuntime(): RuntimeManager {
  return new RuntimeManager({}, () => {
    let crash: ((error: Error) => void) | undefined;
    const harness: RuntimeHarness = {
      start: vi.fn(async () => undefined),
      run: vi.fn(async (input, options) => ({
        sessionId: options.sessionId ?? "missing",
        finalResponse: `reply:${input}`,
        events: [],
        notifications: [],
      })),
      close: vi.fn(async () => undefined),
      watchCrash: vi.fn((listener) => {
        crash = listener;
        return () => {
          crash = undefined;
        };
      }),
      crashForTest: vi.fn(() => {
        queueMicrotask(() => crash?.(new Error("killed for test")));
        return true;
      }),
    };
    return harness;
  });
}

describe("runtime recovery API", () => {
  it("covers sessions, protected crash, recovery and termination", async () => {
    const runtime = createRuntime();
    await runtime.start();
    const app = buildApp({
      runtime,
      logger: false,
      enableCrashEndpoint: true,
      crashToken: "test-secret",
    });

    const created = await app.inject({ method: "POST", url: "/sessions" });
    const session = created.json<{ id: string }>();
    expect(created.statusCode).toBe(201);

    const turn = await app.inject({
      method: "POST",
      url: `/sessions/${session.id}/turns`,
      payload: { prompt: "hello" },
    });
    expect(turn.json()).toMatchObject({
      finalResponse: "reply:hello",
      session: { state: "active", turnCount: 1 },
    });

    const denied = await app.inject({
      method: "POST",
      url: "/runtime/crash",
    });
    expect(denied.statusCode).toBe(403);

    const crashed = await app.inject({
      method: "POST",
      url: "/runtime/crash",
      headers: { "x-runtime-crash-token": "test-secret" },
    });
    expect(crashed.json()).toMatchObject({ state: "crashed" });

    const blocked = await app.inject({
      method: "POST",
      url: `/sessions/${session.id}/turns`,
      payload: { prompt: "while down" },
    });
    expect(blocked.statusCode).toBe(503);

    const recovered = await app.inject({
      method: "POST",
      url: "/recover",
    });
    expect(recovered.json()).toMatchObject({
      state: "running",
      recoveryGeneration: 1,
    });

    const status = await app.inject({
      method: "GET",
      url: "/recover/status",
    });
    expect(status.json()).toMatchObject({
      runtime: { state: "running", recoveryGeneration: 1 },
      sessions: { active: 1, suspended: 0 },
    });

    const terminated = await app.inject({
      method: "DELETE",
      url: `/sessions/${session.id}`,
    });
    expect(terminated.json()).toMatchObject({ state: "terminated" });
    await app.close();
  });

  it("does not register fault injection unless explicitly enabled", async () => {
    const runtime = createRuntime();
    await runtime.start();
    const app = buildApp({ runtime, logger: false });

    const response = await app.inject({
      method: "POST",
      url: "/runtime/crash",
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
