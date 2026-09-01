import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const originalEnv = { ...process.env };
let dshHome: string | undefined;

afterEach(async () => {
  process.env = { ...originalEnv };
  if (dshHome) await rm(dshHome, { recursive: true, force: true });
  dshHome = undefined;
});

describe("plugin lifecycle full chain", () => {
  it("observes runtime patches and local Cordis probes across rebuilds", async () => {
    dshHome = await mkdtemp(join(process.cwd(), ".dsh-test-"));
    process.env.DEEPSEEK_API_KEY = "mock";
    process.env.DSH_MODEL = "mock-model";
    process.env.DSH_HOME = dshHome;
    process.env.DSH_WORKSPACE = process.cwd();
    process.env.DSH_TELEMETRY_DISABLED = "1";
    process.env.DEFAULT_PLUGIN = "observer";

    const app = buildApp({ logger: false, enableMockProvider: true });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    process.env.DEEPSEEK_BASE_URL = `${address}/mock/v1`;

    try {
      const plugins = await app.inject({ method: "GET", url: "/plugins" });
      expect(plugins.statusCode).toBe(200);
      expect(
        plugins
          .json<{ plugins: Array<{ id: string }> }>()
          .plugins.map((plugin) => plugin.id),
      ).toEqual(["observer", "enforcer"]);

      const initial = await app.inject({ method: "GET", url: "/plugin" });
      expect(initial.statusCode).toBe(200);
      expect(initial.json()).toMatchObject({
        state: "stopped",
        generation: 0,
        plugin: { id: "observer" },
        cordis: null,
      });

      const observer = await app.inject({
        method: "POST",
        url: "/runs",
        payload: { prompt: "Check This" },
      });
      expect(observer.statusCode).toBe(200);
      expect(observer.json()).toMatchObject({
        plugin: "observer",
        finalResponse: "plugin=observer;probe=observer:check-this",
        mockObservation: {
          plugin: "observer",
          localProbe: "observer:check-this",
        },
      });

      const unknown = await app.inject({
        method: "PUT",
        url: "/plugin",
        payload: { id: "missing" },
      });
      expect(unknown.statusCode).toBe(404);

      const switched = await app.inject({
        method: "PUT",
        url: "/plugin",
        payload: { id: "enforcer" },
      });
      expect(switched.statusCode).toBe(200);
      expect(switched.json()).toMatchObject({
        rebuilt: true,
        generation: 2,
        plugin: { id: "enforcer" },
        cordis: { generation: 2, injected: true },
      });

      const enforcer = await app.inject({
        method: "POST",
        url: "/runs",
        payload: { prompt: "Check This" },
      });
      expect(enforcer.statusCode).toBe(200);
      expect(enforcer.json()).toMatchObject({
        plugin: "enforcer",
        finalResponse: "plugin=enforcer;probe=enforcer:check-this",
      });
    } finally {
      await app.close();
    }
  }, 60_000);
});
