import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventStore } from "../src/event-store.js";

describe("EventStore", () => {
  it("merges and classifies plugin and SDK events", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dsh-plugin-events-"));
    const file = join(directory, "events.jsonl");
    const store = new EventStore(file);
    await store.reset();
    store.addSdk("session.event", {
      event: { type: "tool/call", callId: "one" },
    });
    await writeFile(
      file,
      `${JSON.stringify({
        source: "runtime-plugin",
        hook: "llm/stream",
        phase: "intercepted",
        timestamp: new Date().toISOString(),
        model: "mock",
      })}\n`,
    );

    await store.syncPlugin();

    expect(store.counts()).toMatchObject({ llm: 1, tool: 1 });
    expect(store.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "runtime-plugin",
          hook: "llm/stream",
        }),
        expect.objectContaining({
          source: "sdk",
          hook: "tool/call",
        }),
      ]),
    );
  });
});
