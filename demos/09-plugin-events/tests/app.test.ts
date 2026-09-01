import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { EventStore } from "../src/event-store.js";
import { RuntimeManager } from "../src/runtime-manager.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("plugin events API", () => {
  it("validates prompts and exposes a completed run", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dsh-plugin-api-"));
    const events = new EventStore(join(directory, "events.jsonl"));
    const runtime = new RuntimeManager(
      { profile: "sdk", patches: ["/patch.yml"] },
      () => ({
        start: async () => undefined,
        close: async () => undefined,
        run: async (_prompt, options) => {
          options.onNotification({
            method: "session.event",
            params: { event: { type: "assistant/message" } },
          });
          return {
            finalResponse: "ok",
            events: [],
            notifications: [],
          };
        },
      }),
    );
    const app = buildApp({ logger: false, runtime, events });
    apps.push(app);

    const invalid = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { prompt: " " },
    });
    const valid = await app.inject({
      method: "POST",
      url: "/runs",
      payload: { prompt: "hello" },
    });

    expect(invalid.statusCode).toBe(400);
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toMatchObject({
      finalResponse: "ok",
      counts: { llm: 1 },
    });
  });

  it("reports health without starting the runtime", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dsh-plugin-health-"));
    const runtime = new RuntimeManager(
      { profile: "sdk", patches: ["/patch.yml"] },
      () => {
        throw new Error("should not start");
      },
    );
    const app = buildApp({
      logger: false,
      runtime,
      events: new EventStore(join(directory, "events.jsonl")),
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json().runtime.state).toBe("stopped");
  });
});
