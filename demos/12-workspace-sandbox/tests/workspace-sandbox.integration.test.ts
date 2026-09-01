import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const originalEnv = { ...process.env };
const temporaryPaths: string[] = [];

afterEach(async () => {
  process.env = { ...originalEnv };
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("real DSH workspace sandbox chain", () => {
  it("allows an in-workspace write and denies outside, Shell, and web calls", async () => {
    const dshHome = await temporaryPath();
    const workspace = await temporaryPath();
    process.env.DEEPSEEK_API_KEY = "mock";
    process.env.DSH_MODEL = "mock-model";
    process.env.DSH_HOME = dshHome;
    process.env.DSH_WORKSPACE = workspace;
    process.env.DSH_PERMISSION_MODE = "workspace-write";
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
            "Run the fixed workspace, outside-path, Shell, and network probes.",
        },
      });
      const body = response.json();

      expect(response.statusCode, JSON.stringify(body)).toBe(200);
      expect(body).toMatchObject({
        finalResponse:
          "verified workspace sandbox and default capability denials",
        sdkProof: {
          toolCalls: 4,
          toolResults: 4,
          workspaceWrite: true,
          outsideDenied: true,
          shellDenied: true,
          networkToolDenied: true,
        },
        artifactProof: {
          insideContent: "written through the real DSH fs tool\n",
          outsideExists: false,
        },
        mockObservation: {
          requestCount: 2,
          emittedFixedCalls: true,
          sawWorkspaceWrite: true,
          sawOutsideDenial: true,
          sawShellDenial: true,
          sawNetworkDenial: true,
        },
      });
      expect(body.eventTypes).toContain("tool/call");
      expect(body.eventTypes).toContain("tool/result");
    } finally {
      await app.close();
    }
  }, 60_000);
});

async function temporaryPath(): Promise<string> {
  const path = await mkdtemp(join(process.cwd(), ".dsh-test-"));
  temporaryPaths.push(path);
  return path;
}
