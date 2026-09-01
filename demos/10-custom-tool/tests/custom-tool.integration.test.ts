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

describe("custom tool SDK chain", () => {
  it("records tool/call and tool/result before the verified final answer", async () => {
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
        payload: { prompt: "Call deterministic_score once and verify it." },
      });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body).toMatchObject({
        finalResponse:
          "verified custom tool: score=17; fingerprint=sdk:weighted:3,1,4:17",
        sdkProof: { toolCall: true, toolResult: true },
        mockObservation: {
          requestCount: 2,
          sawCustomTool: true,
          emittedToolCall: true,
          sawDeterministicResult: true,
        },
      });
      expect(body.eventTypes).toContain("tool/call");
      expect(body.eventTypes).toContain("tool/result");
      expect(
        body.toolEvents.map((event: { type: string }) => event.type),
      ).toEqual(expect.arrayContaining(["tool/call", "tool/result"]));
    } finally {
      await app.close();
    }
  }, 60_000);
});
