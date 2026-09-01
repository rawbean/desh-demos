import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("HTTP app", () => {
  it("reports demo metadata and validates run input", async () => {
    const app = buildApp({ logger: false });
    try {
      const root = await app.inject({ method: "GET", url: "/" });
      expect(root.json()).toMatchObject({
        demo: "08-custom-service",
        cordisVersion: "4.0.2",
      });

      const invalid = await app.inject({
        method: "POST",
        url: "/runs",
        payload: { prompt: " " },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toEqual({
        error: "prompt must be a non-empty string",
      });
    } finally {
      await app.close();
    }
  });
});
