import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("skill-loading API", () => {
  it("reports the real skill stack and validates run input", async () => {
    const app = buildApp({ logger: false });
    try {
      const root = await app.inject({ method: "GET", url: "/" });
      expect(root.json()).toMatchObject({
        demo: "14-skill-loading",
        skillPackages: [
          "@deepseek-ai/dsh-skill",
          "@deepseek-ai/dsh-skill-filesystem",
          "@deepseek-ai/dsh-tool-skill",
        ],
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
        payload: { prompt: "load it", sessionId: "" },
      });
      expect(invalidSession.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("ships a valid deterministic SKILL.md bundle", async () => {
    const skill = await readFile(
      join(process.cwd(), "workspace/skills/deterministic-verdict/SKILL.md"),
      "utf8",
    );

    expect(skill).toMatch(/^---\nname: deterministic-verdict\n/);
    expect(skill).toContain("description:");
    expect(skill).toContain("\n---\n\n# Deterministic verdict");
    expect(skill).toContain("SKILL_LOADED_VERDICT_314159");
  });
});
