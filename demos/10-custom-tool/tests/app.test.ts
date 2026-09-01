import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("HTTP app", () => {
  it("reports metadata and validates run input", async () => {
    const app = buildApp({ logger: false });
    try {
      const root = await app.inject({ method: "GET", url: "/" });
      expect(root.json()).toMatchObject({
        demo: "10-custom-tool",
        sdkVersion: "0.1.2-alpha.2",
        cordisVersion: "4.0.2",
      });

      const invalidPrompt = await app.inject({
        method: "POST",
        url: "/runs",
        payload: { prompt: " " },
      });
      expect(invalidPrompt.statusCode).toBe(400);

      const invalidSession = await app.inject({
        method: "POST",
        url: "/runs",
        payload: { prompt: "score", sessionId: "" },
      });
      expect(invalidSession.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
