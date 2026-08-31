import { buildApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const app = buildApp({
  harnessOptions: {
    profile: process.env.DSH_PROFILE ?? "sdk",
    provider: process.env.DSH_PROVIDER ?? "deepseek-official",
    model: process.env.DSH_MODEL ?? "deepseek-v4-flash",
    cwd: process.env.DSH_WORKSPACE ?? process.cwd(),
    dshHome: process.env.DSH_HOME ?? "/tmp/dsh-home",
    maxTokens: Number.parseInt(process.env.DSH_MAX_TOKENS ?? "2048", 10),
    initializeTimeoutMs: Number.parseInt(
      process.env.DSH_INITIALIZE_TIMEOUT_MS ?? "10000",
      10,
    ),
  },
  enableMockProvider: process.env.ENABLE_MOCK_PROVIDER === "true",
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: "0.0.0.0", port });
