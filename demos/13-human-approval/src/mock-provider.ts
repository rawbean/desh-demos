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
  sawHighRiskTool: boolean;
  emittedToolCall: boolean;
  sawExecutedResult: boolean;
  sawRejectedResult: boolean;
}

export class MockObservationStore {
  private observation: MockObservation = {
    requestCount: 0,
    sawHighRiskTool: false,
    emittedToolCall: false,
    sawExecutedResult: false,
    sawRejectedResult: false,
  };

  observe(body: ChatBody): MockObservation {
    const toolMessage = body.messages?.find(
      (message) => message.role === "tool",
    );
    const toolResult =
      toolMessage === undefined
        ? ""
        : typeof toolMessage.content === "string"
          ? toolMessage.content
          : JSON.stringify(toolMessage.content);
    const sawHighRiskTool =
      body.tools?.some(
        (tool) => tool.function?.name === "high_risk_workspace_delete",
      ) === true;

    this.observation = {
      requestCount: this.observation.requestCount + 1,
      sawHighRiskTool: this.observation.sawHighRiskTool || sawHighRiskTool,
      emittedToolCall:
        this.observation.emittedToolCall ||
        (this.observation.requestCount === 0 && sawHighRiskTool),
      sawExecutedResult:
        this.observation.sawExecutedResult ||
        toolResult.includes('"executed":true'),
      sawRejectedResult:
        this.observation.sawRejectedResult ||
        (toolResult.length > 0 && !toolResult.includes('"executed":true')),
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

      if (observation.requestCount === 1 && observation.sawHighRiskTool) {
        writeChunk(reply.raw, {
          choices: [
            {
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "high-risk-call-1",
                    type: "function",
                    function: {
                      name: "high_risk_workspace_delete",
                      arguments:
                        '{"target":"/workspace/protected-demo-artifact"}',
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
          usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
        });
      } else {
        const content = observation.sawExecutedResult
          ? "approval-allowed: simulated high-risk tool executed"
          : "approval-rejected: simulated high-risk tool did not execute";
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
          usage: { prompt_tokens: 20, completion_tokens: 7, total_tokens: 27 },
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
