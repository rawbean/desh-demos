import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerMockProvider } from "../src/mock-provider.js";
import { RuntimeManager } from "../src/runtime-manager.js";
import { SessionManager } from "../src/session-manager.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("DSH alpha.2 real subprocess recovery", () => {
  it("proves whether the same sessionId and DSH_HOME restore model context", async () => {
    const provider = Fastify({ logger: false });
    registerMockProvider(provider);
    const address = await provider.listen({ host: "127.0.0.1", port: 0 });
    cleanups.push(() => provider.close());

    const dshHome = await mkdtemp(join(tmpdir(), "dsh-recovery-alpha2-"));
    cleanups.push(() => rm(dshHome, { recursive: true, force: true }));
    const runtime = new RuntimeManager({
      profile: "sdk",
      provider: "deepseek-official",
      model: "mock-model",
      dshHome,
      cwd: dshHome,
      maxTokens: 256,
      initializeTimeoutMs: 10_000,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: "mock",
        DEEPSEEK_BASE_URL: `${address}/mock/v1`,
        DSH_TELEMETRY_DISABLED: "1",
      },
    });
    const sessions = new SessionManager(runtime);
    cleanups.push(() => sessions.close());

    await runtime.start();
    const session = sessions.create();
    const first = await sessions.continue(
      session.id,
      "Remember blue and reply briefly.",
    );
    expect(first.finalResponse).toBe("remembered:blue");

    await runtime.crashForTest(5_000);
    expect(sessions.get(session.id).state).toBe("suspended");
    await runtime.recover();

    const second = await sessions.continue(
      session.id,
      "What did I ask you to remember?",
      "context-ok",
    );
    const observation = await fetch(`${address}/mock/observation`).then(
      async (response) =>
        response.json() as Promise<{
          requestCount: number;
          sawPersistedAssistantMemory: boolean;
        }>,
    );
    expect({
      response: second.finalResponse,
      requestCount: observation.requestCount,
      sawPersistedAssistantMemory: observation.sawPersistedAssistantMemory,
    }).toEqual({
      response: "",
      requestCount: 1,
      sawPersistedAssistantMemory: false,
    });
    expect(second.session).toMatchObject({
      id: session.id,
      recoveryGeneration: 1,
      contextContinuity: "lost",
    });
  }, 30_000);
});
