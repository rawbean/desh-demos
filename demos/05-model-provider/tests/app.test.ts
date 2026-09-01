import type { DeepSeekHarnessOptions } from "@deepseek-ai/dsh-sdk-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import { ModelCatalog, type ResolvedModelRoute } from "../src/model-config.js";
import { RuntimeManager, type HarnessRuntime } from "../src/runtime-manager.js";

const routes: ResolvedModelRoute[] = [
  {
    provider: "mock-primary",
    model: "mock-blue",
    label: "Blue",
    sdkProvider: "deepseek-official",
  },
  {
    provider: "mock-secondary",
    model: "mock-green",
    label: "Green",
    sdkProvider: "deepseek-official",
  },
];
const apps: Array<ReturnType<typeof buildApp>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

function createApp() {
  const catalog = new ModelCatalog(routes);
  const created: Array<{
    options: DeepSeekHarnessOptions;
    harness: HarnessRuntime;
  }> = [];
  const runtime = new RuntimeManager(catalog.initial(), {}, (options) => {
    const harness: HarnessRuntime = {
      start: vi.fn(async () => undefined),
      run: vi.fn(async () => ({
        sessionId: "session",
        finalResponse: `answer:${options.model}`,
        events: [],
        notifications: [],
      })),
      close: vi.fn(async () => undefined),
    };
    created.push({ options, harness });
    return harness;
  });
  const app = buildApp({
    catalog,
    runtime,
    logger: false,
    maxPromptLength: 20,
  });
  apps.push(app);
  return { app, created };
}

describe("model provider API", () => {
  it("queries routes, runs a prompt, switches, and exposes new state", async () => {
    const { app, created } = createApp();

    const config = await app.inject({ method: "GET", url: "/config" });
    expect(config.statusCode).toBe(200);
    expect(config.json().available).toHaveLength(2);

    const first = await app.inject({
      method: "POST",
      url: "/prompts",
      payload: { prompt: "first" },
    });
    expect(first.json().answer).toBe("answer:mock-blue");
    expect(first.json().runtime.generation).toBe(1);

    const switched = await app.inject({
      method: "PUT",
      url: "/config",
      payload: { provider: "mock-secondary", model: "mock-green" },
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().generation).toBe(2);
    expect(created[0]!.harness.close).toHaveBeenCalledOnce();

    const second = await app.inject({
      method: "POST",
      url: "/prompts",
      payload: { prompt: "second" },
    });
    expect(second.json().answer).toBe("answer:mock-green");
    expect(second.json().runtime.route.provider).toBe("mock-secondary");
  });

  it("rejects malformed, unknown, and oversized requests", async () => {
    const { app } = createApp();
    const malformed = await app.inject({
      method: "PUT",
      url: "/config",
      payload: { provider: "mock-primary" },
    });
    const unknown = await app.inject({
      method: "PUT",
      url: "/config",
      payload: { provider: "missing", model: "missing" },
    });
    const oversized = await app.inject({
      method: "POST",
      url: "/prompts",
      payload: { prompt: "x".repeat(21) },
    });

    expect(malformed.statusCode).toBe(400);
    expect(unknown.statusCode).toBe(400);
    expect(oversized.statusCode).toBe(400);
  });
});
