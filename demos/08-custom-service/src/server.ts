import { buildApp } from "./app.js";

const app = buildApp();
const port = Number.parseInt(process.env.PORT ?? "3008", 10);

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  await app.close();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: "0.0.0.0", port });
