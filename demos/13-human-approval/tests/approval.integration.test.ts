import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const originalEnv = { ...process.env };
const temporaryDirectories: string[] = [];

afterEach(async () => {
  process.env = { ...originalEnv };
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe.sequential("real Runtime approval chain", () => {
  for (const scenario of [
    {
      mode: "allow",
      outcome: "allowed-once",
      response: "approval-allowed",
      executed: true,
    },
    {
      mode: "reject",
      outcome: "rejected",
      response: "approval-rejected",
      executed: false,
    },
  ] as const) {
    it(`${scenario.mode} produces paired SDK audit evidence`, async () => {
      const dshHome = await mkdtemp(join(process.cwd(), ".dsh-test-home-"));
      const eventDirectory = await mkdtemp(
        join(process.cwd(), ".dsh-test-events-"),
      );
      temporaryDirectories.push(dshHome, eventDirectory);
      const eventFile = join(eventDirectory, "approval.jsonl");

      process.env.DEMO_APPROVAL = scenario.mode;
      process.env.DEEPSEEK_API_KEY = "mock";
      process.env.DSH_MODEL = "mock-model";
      process.env.DSH_HOME = dshHome;
      process.env.DSH_WORKSPACE = process.cwd();
      process.env.DSH_APPROVAL_EVENT_FILE = eventFile;
      process.env.DSH_TELEMETRY_DISABLED = "1";

      const app = buildApp({
        logger: false,
        enableMockProvider: true,
        eventFile,
      });
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      process.env.DEEPSEEK_BASE_URL = `${address}/mock/v1`;

      try {
        const response = await app.inject({
          method: "POST",
          url: "/runs",
          payload: {
            prompt:
              "Call high_risk_workspace_delete exactly once for the protected demo artifact.",
          },
        });
        const body = response.json();

        expect(response.statusCode).toBe(200);
        expect(body.finalResponse).toContain(scenario.response);
        expect(Object.values(body.assertions)).not.toContain(false);
        expect(body.approvalEvents).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "approval/asked",
              data: expect.objectContaining({
                toolName: "high_risk_workspace_delete",
              }),
            }),
            expect.objectContaining({
              type: "approval/decided",
              data: expect.objectContaining({ outcome: scenario.outcome }),
            }),
          ]),
        );
        expect(
          body.pluginEvents.some(
            (event: { event: string }) =>
              event.event === "high-risk-tool-executed",
          ),
        ).toBe(scenario.executed);
      } finally {
        await app.close();
      }
    }, 60_000);
  }
});
