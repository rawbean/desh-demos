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

describe("Cordis composition full chain", () => {
  it("changes the real model request after a startup-only rebuild", async () => {
    dshHome = await mkdtemp(join(process.cwd(), ".dsh-test-"));
    process.env.DEEPSEEK_API_KEY = "mock";
    process.env.DSH_MODEL = "mock-model";
    process.env.DSH_HOME = dshHome;
    process.env.DSH_WORKSPACE = process.cwd();
    process.env.DSH_TELEMETRY_DISABLED = "1";
    process.env.DEFAULT_COMPOSITION = "focused";

    const app = buildApp({ logger: false, enableMockProvider: true });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    process.env.DEEPSEEK_BASE_URL = `${address}/mock/v1`;

    try {
      const focused = await app.inject({
        method: "POST",
        url: "/runs",
        payload: { prompt: "demonstrate the active composition" },
      });
      expect(focused.statusCode).toBe(200);
      expect(focused.json()).toMatchObject({
        composition: "focused",
        finalResponse: "profile=focused;todo=false",
        mockObservation: {
          detectedProfile: "focused",
          hasTodoTool: false,
        },
      });

      const switched = await app.inject({
        method: "PUT",
        url: "/composition",
        payload: { id: "planner" },
      });
      expect(switched.statusCode).toBe(200);
      expect(switched.json()).toMatchObject({
        composition: { id: "planner" },
        rebuilt: true,
        generation: 2,
      });

      const planner = await app.inject({
        method: "POST",
        url: "/runs",
        payload: { prompt: "demonstrate the active composition" },
      });
      expect(planner.statusCode).toBe(200);
      expect(planner.json()).toMatchObject({
        composition: "planner",
        finalResponse: "profile=planner;todo=true",
        mockObservation: {
          detectedProfile: "planner",
          hasTodoTool: true,
        },
      });
    } finally {
      await app.close();
    }
  }, 60_000);
});
