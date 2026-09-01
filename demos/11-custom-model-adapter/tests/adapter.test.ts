import { describe, expect, it } from "vitest";
import { createUserMessage, type StreamChunk } from "@deepseek-ai/dsh-llm";
import {
  DeterministicAdapter,
  MODEL,
  PROVIDER,
  RESPONSE,
} from "../plugins/custom-model-adapter/index.js";

describe("DeterministicAdapter", () => {
  it("implements the alpha.2 stream contract", async () => {
    const recorded: string[] = [];
    const adapter = new DeterministicAdapter((event) => recorded.push(event));
    const chunks: StreamChunk[] = [];

    for await (const chunk of adapter.stream({
      provider: PROVIDER,
      model: MODEL,
      messages: [
        createUserMessage({
          content: [{ type: "text", text: "ignored by deterministic model" }],
          source: { kind: "user" },
        }),
      ],
    })) {
      chunks.push(chunk);
    }

    expect(
      chunks
        .filter(
          (chunk): chunk is Extract<StreamChunk, { type: "text-delta" }> =>
            chunk.type === "text-delta",
        )
        .map((chunk) => chunk.text)
        .join(""),
    ).toBe(RESPONSE);
    expect(chunks.at(-1)).toEqual({
      type: "finish",
      reason: { kind: "stop" },
    });
    expect(recorded).toEqual([
      "stream-start",
      "chunk",
      "chunk",
      "chunk",
      "stream-complete",
    ]);
  });

  it("advertises the independent provider route", async () => {
    const adapter = new DeterministicAdapter();

    expect(adapter.providerInfo(PROVIDER)).toEqual({
      id: PROVIDER,
      name: "Demo deterministic adapter",
    });
    expect(await adapter.listModels(PROVIDER)).toMatchObject([
      { provider: PROVIDER, id: MODEL, inputModalities: ["text"] },
    ]);
  });
});
