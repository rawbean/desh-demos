import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { EventStore } from "../src/event-store.js";
import { MODEL, PROVIDER, RuntimeManager } from "../src/runtime-manager.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("custom adapter API", () => {
  it("validates prompts and exposes adapter evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dsh-adapter-api-"));
    const file = join(directory, "events.jsonl");
    const events = new EventStore(file);
    const runtime = new RuntimeManager(
      {
        profile: "sdk",
        patches: ["/patch.yml"],
        provider: PROVIDER,
        model: MODEL,
      },
      () => ({
        start: async () => undefined,
        close: async () => undefined,
        run: async (_prompt, options) => {
          options.onNotification({
            method: "session.event",
            params: { event: { type: "assistant/message" } },
          });
          return { finalResponse: "ok", events: [], notifications: [] };
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
      provider: PROVIDER,
      model: MODEL,
      finalResponse: "ok",
      assertions: { sdkNotified: true },
    });
  });

  it("reports the selected route before startup", async () => {
    const runtime = new RuntimeManager(
      {
        profile: "sdk",
        patches: ["/patch.yml"],
        provider: PROVIDER,
        model: MODEL,
      },
      () => {
        throw new Error("should not start");
      },
    );
    const app = buildApp({ logger: false, runtime });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.json().runtime).toMatchObject({
      state: "stopped",
      provider: PROVIDER,
      model: MODEL,
    });
  });
});
