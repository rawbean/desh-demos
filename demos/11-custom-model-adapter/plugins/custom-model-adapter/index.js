import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LlmAdapter } from "@deepseek-ai/dsh-llm";

export const PROVIDER = "demo-custom-adapter";
export const MODEL = "deterministic-v1";
export const RESPONSE = "custom-adapter-ok";
export const name = "dsh-demo-custom-model-adapter";
export const inject = ["llm"];

export class DeterministicAdapter extends LlmAdapter {
  constructor(record = () => undefined) {
    super();
    this.record = record;
    this.requests = 0;
  }

  providerInfo(provider) {
    return { id: provider, name: "Demo deterministic adapter" };
  }

  async listModels(provider) {
    return [
      {
        provider,
        id: MODEL,
        name: "Deterministic v1",
        description: "Local deterministic streaming model for adapter demos",
        inputModalities: ["text"],
      },
    ];
  }

  async resolveModel(provider, model) {
    return {
      provider,
      id: model,
      name: model === MODEL ? "Deterministic v1" : model,
      inputModalities: ["text"],
      context: { contextWindow: 16_384 },
      defaultMaxTokens: 64,
    };
  }

  async *stream(options) {
    this.requests += 1;
    const request = this.requests;
    const facts = {
      request,
      provider: options.provider,
      model: options.model,
      messages: options.messages.length,
      hasSystem: typeof options.system === "string",
      maxTokens: options.maxTokens ?? null,
    };
    this.record("stream-start", facts);

    if (options.signal?.aborted) {
      this.record("stream-aborted", facts);
      yield {
        type: "finish",
        reason: {
          kind: "aborted",
          failure: { message: "request aborted", code: "ABORTED" },
        },
      };
      return;
    }

    const pieces = ["custom-", "adapter-", "ok"];
    yield { type: "block-start", index: 0, blockType: "text" };
    for (const [sequence, text] of pieces.entries()) {
      if (options.signal?.aborted) {
        this.record("stream-aborted", { ...facts, sequence });
        yield {
          type: "finish",
          reason: {
            kind: "aborted",
            failure: { message: "request aborted", code: "ABORTED" },
          },
        };
        return;
      }
      this.record("chunk", { ...facts, sequence, characters: text.length });
      yield { type: "text-delta", index: 0, text };
    }
    yield {
      type: "block-end",
      index: 0,
      block: { type: "text", text: RESPONSE },
    };
    yield {
      type: "usage",
      usage: { inputTokens: options.messages.length, outputTokens: 3 },
    };
    yield { type: "finish", reason: { kind: "stop" } };
    this.record("stream-complete", { ...facts, chunks: pieces.length });
  }
}

export function apply(ctx, config = {}) {
  const eventFile =
    config.eventFile ??
    process.env.DSH_ADAPTER_EVENT_FILE ??
    "/tmp/dsh-custom-adapter-events.jsonl";
  mkdirSync(dirname(eventFile), { recursive: true });
  const record = (event, data = {}) => {
    appendFileSync(
      eventFile,
      `${JSON.stringify({
        source: "runtime-adapter",
        event,
        timestamp: new Date().toISOString(),
        ...data,
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  };

  const adapter = new DeterministicAdapter(record);
  ctx.llm.registerAdapter([PROVIDER], adapter);
  record("registered", { provider: PROVIDER, model: MODEL });
}
