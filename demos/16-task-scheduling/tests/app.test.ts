import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunResult } from "@deepseek-ai/dsh-sdk-client";
import { buildApp } from "../src/app.js";
import { RuntimeManager, type HarnessRuntime } from "../src/runtime-manager.js";
import { TaskScheduler } from "../src/task-scheduler.js";

const apps: Array<ReturnType<typeof buildApp>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("task scheduling API", () => {
  it("validates input and exposes asynchronous task status", async () => {
    let resolveRun: ((result: RunResult) => void) | undefined;
    const harness: HarnessRuntime = {
      start: vi.fn(async () => undefined),
      run: vi.fn(
        async () =>
          await new Promise<RunResult>((resolve) => {
            resolveRun = resolve;
          }),
      ),
      close: vi.fn(async () => undefined),
    };
    const runtime = new RuntimeManager({}, () => harness);
    const scheduler = new TaskScheduler(runtime, {
      concurrency: 1,
      defaultTimeoutMs: 10_000,
      defaultMaxAttempts: 2,
      defaultRetryDelayMs: 1,
    });
    const app = buildApp({
      runtime,
      scheduler,
      maxPromptLength: 10,
      logger: false,
    });
    apps.push(app);

    const invalid = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { prompt: "ok", maxAttempts: 0 },
    });
    expect(invalid.statusCode).toBe(400);

    const accepted = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { prompt: "schedule", maxAttempts: 2 },
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.headers.location).toMatch(/^\/tasks\//);
    const task = accepted.json<{ id: string }>();
    await vi.waitFor(() => expect(resolveRun).toBeTypeOf("function"));
    resolveRun?.({
      sessionId: "session",
      finalResponse: "scheduled-ok",
      events: [],
      notifications: [],
    });
    await vi.waitFor(async () => {
      const status = await app.inject({
        method: "GET",
        url: `/tasks/${task.id}`,
      });
      expect(status.json()).toMatchObject({
        state: "completed",
        finalResponse: "scheduled-ok",
      });
    });

    const listing = await app.inject({ method: "GET", url: "/tasks" });
    expect(listing.json().queue).toMatchObject({
      concurrency: 1,
      activeSlots: 0,
      total: 1,
    });
  });

  it("returns explicit errors for unknown tasks and invalid cancellation", async () => {
    const runtime = new RuntimeManager({}, () => ({
      start: vi.fn(async () => undefined),
      run: vi.fn(),
      close: vi.fn(async () => undefined),
    }));
    const app = buildApp({ runtime, logger: false });
    apps.push(app);

    const missing = await app.inject({
      method: "GET",
      url: "/tasks/missing",
    });
    const invalid = await app.inject({
      method: "DELETE",
      url: "/tasks/missing?forceRuntime=maybe",
    });
    expect(missing.statusCode).toBe(404);
    expect(invalid.statusCode).toBe(400);
  });
});
