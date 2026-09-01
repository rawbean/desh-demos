import {
  LlmAdapter,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm";

export const PROVIDER: "demo-custom-adapter";
export const MODEL: "deterministic-v1";
export const RESPONSE: "custom-adapter-ok";
export const name: string;
export const inject: string[];

type RecordEvent = (event: string, data?: Record<string, unknown>) => void;

export class DeterministicAdapter extends LlmAdapter {
  constructor(record?: RecordEvent);
  providerInfo(provider: string): LlmProviderInfo;
  listModels(provider: string): Promise<readonly LlmModelInfo[]>;
  resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo>;
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}

export function apply(
  ctx: {
    llm: {
      registerAdapter(providers: string[], adapter: LlmAdapter): unknown;
    };
  },
  config?: { eventFile?: string },
): void;
