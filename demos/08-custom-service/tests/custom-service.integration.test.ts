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

describe("custom Cordis service full chain", () => {
  it("injects the provider into the consumer and returns its tool event to SDK", async () => {
    dshHome = await mkdtemp(join(process.cwd(), ".dsh-test-"));
    process.env.DEEPSEEK_API_KEY = "mock";
    process.env.DSH_MODEL = "mock-model";
    process.env.DSH_HOME = dshHome;
    process.env.DSH_WORKSPACE = process.cwd();
    process.env.DSH_TELEMETRY_DISABLED = "1";

    const app = buildApp({ logger: false, enableMockProvider: true });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    process.env.DEEPSEEK_BASE_URL = `${address}/mock/v1`;

    try {
      const response = await app.inject({
        method: "POST",
        url: "/runs",
        payload: { prompt: "Use the custom greeting service exactly once." },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        finalResponse: "sdk-observed: injected-service=true; event=true",
        mockObservation: {
          requestCount: 2,
          sawCustomTool: true,
          sawInjectedResult: true,
        },
      });
      expect(response.json().eventCount).toBeGreaterThan(0);
      expect(response.json().eventTypes).toContain("tool/result");
    } finally {
      await app.close();
    }
  }, 60_000);
});
