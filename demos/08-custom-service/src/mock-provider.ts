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
  sawInjectedResult: boolean;
  toolResult: string | null;
}

export class MockObservationStore {
  private observation: MockObservation = {
    requestCount: 0,
    sawCustomTool: false,
    sawInjectedResult: false,
    toolResult: null,
  };

  observe(body: ChatBody): MockObservation {
    const toolMessage = body.messages?.find(
      (message) => message.role === "tool",
    );
    const toolResult =
      toolMessage === undefined ? null : JSON.stringify(toolMessage.content);
    this.observation = {
      requestCount: this.observation.requestCount + 1,
      sawCustomTool:
        this.observation.sawCustomTool ||
        body.tools?.some(
          (tool) => tool.function?.name === "custom_service_greet",
        ) === true,
      sawInjectedResult:
        this.observation.sawInjectedResult ||
        (toolResult?.includes("Hello from injected Cordis, SDK!") === true &&
          toolResult.includes("cordis-custom-greeting-v1") &&
          toolResult.includes("event=true")),
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

      if (observation.toolResult === null) {
        writeChunk(reply.raw, {
          choices: [
            {
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "custom-service-call-1",
                    type: "function",
                    function: {
                      name: "custom_service_greet",
                      arguments: '{"name":"SDK"}',
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
        const content = observation.sawInjectedResult
          ? "sdk-observed: injected-service=true; event=true"
          : "sdk-observed: injected-service=false; event=false";
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
