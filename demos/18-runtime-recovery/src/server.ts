import { buildApp } from "./app.js";

const port = positiveInteger(process.env.PORT, 3018);
const enableCrashEndpoint =
  process.env.ENABLE_RUNTIME_CRASH_ENDPOINT === "true";
const crashToken = process.env.RUNTIME_CRASH_TOKEN;

if (enableCrashEndpoint && !crashToken) {
  throw new Error(
    "RUNTIME_CRASH_TOKEN is required when the crash endpoint is enabled",
  );
}

const app = buildApp({
  harnessOptions: {
    profile: process.env.DSH_PROFILE ?? "sdk",
    provider: process.env.DSH_PROVIDER ?? "deepseek-official",
    model: process.env.DSH_MODEL ?? "deepseek-v4-flash",
    cwd: process.env.DSH_WORKSPACE ?? process.cwd(),
    dshHome: process.env.DSH_HOME ?? "/tmp/dsh-home",
    maxTokens: positiveInteger(process.env.DSH_MAX_TOKENS, 2048),
    initializeTimeoutMs: positiveInteger(
      process.env.DSH_INITIALIZE_TIMEOUT_MS,
      10_000,
    ),
  },
  enableMockProvider: process.env.ENABLE_MOCK_PROVIDER === "true",
  enableCrashEndpoint,
  ...(crashToken === undefined ? {} : { crashToken }),
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.recoveryRuntime.start();
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error({ error }, "runtime recovery server failed to start");
  await app.close();
  throw error;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
