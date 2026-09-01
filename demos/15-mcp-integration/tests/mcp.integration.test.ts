import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { processExists } from "../src/mcp-events.js";
import { PUBLIC_TOOL_NAME } from "../src/runtime-manager.js";

const originalEnv = { ...process.env };
let dshHome: string | undefined;

afterEach(async () => {
  process.env = { ...originalEnv };
  if (dshHome) await rm(dshHome, { recursive: true, force: true });
  dshHome = undefined;
});

describe("stdio MCP SDK chain", () => {
  it("discovers, calls, records, answers, and cleans up the child", async () => {
    dshHome = await mkdtemp(join(process.cwd(), ".dsh-test-"));
    const eventFile = join(dshHome, "mcp-events.jsonl");
    process.env.DEEPSEEK_API_KEY = "mock";
    process.env.DSH_MODEL = "mock-model";
    process.env.DSH_HOME = dshHome;
    process.env.DSH_MCP_EVENT_FILE = eventFile;
    process.env.DSH_WORKSPACE = process.cwd();
    process.env.DSH_TELEMETRY_DISABLED = "1";

    const app = buildApp({ logger: false, enableMockProvider: true });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    process.env.DEEPSEEK_BASE_URL = `${address}/mock/v1`;

    try {
      const response = await app.inject({
        method: "POST",
        url: "/runs",
        payload: { prompt: "Call the demo MCP calculator exactly once." },
      });
      const body = response.json();

      expect(response.statusCode, body.error).toBe(200);
      expect(body).toMatchObject({
        finalResponse: "verified MCP tool: 19+23=42",
        expectedTool: PUBLIC_TOOL_NAME,
        sdkProof: {
          discovered: true,
          toolCall: true,
          toolResult: true,
          finalAnswer: true,
        },
        mockObservation: {
          requestCount: 2,
          discoveredNamespacedTool: true,
          emittedNamespacedCall: true,
          sawMcpResult: true,
        },
      });
      expect(body.eventTypes).toEqual(
        expect.arrayContaining(["tool/call", "tool/result"]),
      );
      expect(
        body.mcpEvents.map((event: { event: string }) => event.event),
      ).toEqual(
        expect.arrayContaining([
          "started",
          "initialized",
          "tools-listed",
          "tool-called",
        ]),
      );

      const childPid = body.mcpEvents.find(
        (event: { event: string }) => event.event === "started",
      ).pid;
      expect(processExists(childPid)).toBe(true);

      const stop = await app.inject({
        method: "POST",
        url: "/runtime/stop",
      });
      expect(stop.statusCode).toBe(200);
      expect(stop.json()).toMatchObject({
        state: "stopped",
        initialized: false,
        childPid,
        childCleaned: true,
      });
      expect(processExists(childPid)).toBe(false);
    } finally {
      await app.close();
    }
  }, 60_000);
});
