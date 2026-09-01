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

describe("real local skill SDK chain", () => {
  it("discovers, tool-loads, and follows the SKILL.md body", async () => {
    dshHome = await mkdtemp(join(process.cwd(), ".dsh-test-"));
    process.env.DEEPSEEK_API_KEY = "mock";
    process.env.DSH_MODEL = "mock-model";
    process.env.DSH_HOME = dshHome;
    process.env.DSH_WORKSPACE = join(process.cwd(), "workspace");
    process.env.DSH_TELEMETRY_DISABLED = "1";

    const app = buildApp({ logger: false, enableMockProvider: true });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    process.env.DEEPSEEK_BASE_URL = `${address}/mock/v1`;

    try {
      const response = await app.inject({
        method: "POST",
        url: "/runs",
        payload: {
          prompt:
            "Use the applicable local skill and return its deterministic verdict.",
        },
      });
      const body = response.json();

      expect(response.statusCode).toBe(200);
      expect(body).toMatchObject({
        finalResponse: "SKILL_LOADED_VERDICT_314159",
        sdkProof: {
          toolCall: true,
          toolResult: true,
          discoveredFromDirectory: true,
          loadedSkillBody: true,
          deterministicInstructionApplied: true,
        },
        mockObservation: {
          requestCount: 2,
          sawSkillTool: true,
          sawDiscoveredCatalog: true,
          emittedSkillCall: true,
          sawLoadedBody: true,
        },
      });
      expect(body.eventTypes).toContain("tool/call");
      expect(body.eventTypes).toContain("tool/result");
      expect(
        body.toolEvents.map((event: { type: string }) => event.type),
      ).toEqual(["tool/call", "tool/result"]);
      expect(body.mockObservation.loadedToolResult).toContain(
        '<skill_content name=\\"deterministic-verdict\\">',
      );
      expect(body.mockObservation.loadedToolResult).toContain(
        "SKILL_LOADED_VERDICT_314159",
      );
    } finally {
      await app.close();
    }
  }, 60_000);
});
