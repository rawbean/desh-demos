import { buildApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "3017", 10);
const app = buildApp();

const shutdown = async () => {
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await app.listen({ host: "0.0.0.0", port });
