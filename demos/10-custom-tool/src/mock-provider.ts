import type { FastifyInstance } from "fastify";

interface ChatMessage {
  role?: string;
  content?: unknown;
}

interface ToolSchema {
  function?: { name?: string };
}

interface ChatBody {
  messages?: ChatMessage[];
  tools?: ToolSchema[];
}

export interface MockObservation {
  requestCount: number;
  sawCustomTool: boolean;
  emittedToolCall: boolean;
  sawDeterministicResult: boolean;
  toolResult: string | null;
}

export class MockObservationStore {
  private observation: MockObservation = {
    requestCount: 0,
    sawCustomTool: false,
    emittedToolCall: false,
    sawDeterministicResult: false,
    toolResult: null,
  };

  observe(body: ChatBody): MockObservation {
    const toolMessage = body.messages?.find(
      (message) => message.role === "tool",
    );
    const toolResult =
      toolMessage === undefined
        ? null
        : typeof toolMessage.content === "string"
          ? toolMessage.content
          : JSON.stringify(toolMessage.content);
    this.observation = {
      requestCount: this.observation.requestCount + 1,
      sawCustomTool:
        this.observation.sawCustomTool ||
        body.tools?.some(
          (tool) => tool.function?.name === "deterministic_score",
        ) === true,
      emittedToolCall:
        this.observation.emittedToolCall ||
        (this.observation.requestCount === 0 &&
          body.tools?.some(
            (tool) => tool.function?.name === "deterministic_score",
          ) === true),
      sawDeterministicResult:
        this.observation.sawDeterministicResult ||
        (toolResult?.includes('"label":"sdk"') === true &&
          toolResult.includes('"mode":"weighted"') &&
          toolResult.includes('"score":17') &&
          toolResult.includes('"fingerprint":"sdk:weighted:3,1,4:17"')),
      toolResult: toolResult ?? this.observation.toolResult,
    };
    return this.latest();
  }

  latest(): MockObservation {
    return { ...this.observation };
  }
}

export function registerMockProvider(
  app: FastifyInstance,
  store: MockObservationStore,
): void {
  app.post<{ Body: ChatBody }>(
    "/mock/v1/chat/completions",
    async (request, reply) => {
      const observation = store.observe(request.body ?? {});
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      if (observation.toolResult === null && observation.sawCustomTool) {
        writeChunk(reply.raw, {
          choices: [
            {
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "deterministic-score-call-1",
                    type: "function",
                    function: {
                      name: "deterministic_score",
                      arguments:
                        '{"label":"sdk","values":[3,1,4],"mode":"weighted"}',
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        writeChunk(reply.raw, {
          choices: [{ delta: {}, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
        });
      } else {
        const content = observation.sawDeterministicResult
          ? "verified custom tool: score=17; fingerprint=sdk:weighted:3,1,4:17"
          : "custom tool verification failed";
        writeChunk(reply.raw, {
          choices: [
            {
              delta: { role: "assistant", content },
              finish_reason: null,
            },
          ],
        });
        writeChunk(reply.raw, {
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 },
        });
      }

      reply.raw.end("data: [DONE]\n\n");
    },
  );
}

function writeChunk(
  output: NodeJS.WritableStream,
  chunk: Record<string, unknown>,
): void {
  output.write(`data: ${JSON.stringify(chunk)}\n\n`);
}
