import type { FastifyInstance } from "fastify";
import { PUBLIC_TOOL_NAME } from "./runtime-manager.js";

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
  discoveredNamespacedTool: boolean;
  emittedNamespacedCall: boolean;
  sawMcpResult: boolean;
  toolResult: string | null;
}

export class MockObservationStore {
  private observation = emptyObservation();

  reset(): void {
    this.observation = emptyObservation();
  }

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
    const discovered =
      body.tools?.some((tool) => tool.function?.name === PUBLIC_TOOL_NAME) ===
      true;
    this.observation = {
      requestCount: this.observation.requestCount + 1,
      discoveredNamespacedTool:
        this.observation.discoveredNamespacedTool || discovered,
      emittedNamespacedCall:
        this.observation.emittedNamespacedCall ||
        (this.observation.requestCount === 0 && discovered),
      sawMcpResult:
        this.observation.sawMcpResult ||
        (toolResult?.includes('"sum":42') === true &&
          toolResult.includes('"proof":"19+23=42"')),
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

      if (
        observation.toolResult === null &&
        observation.discoveredNamespacedTool
      ) {
        writeChunk(reply.raw, {
          choices: [
            {
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "mcp-demo-calculate-call-1",
                    type: "function",
                    function: {
                      name: PUBLIC_TOOL_NAME,
                      arguments: '{"left":19,"right":23}',
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
        const content = observation.sawMcpResult
          ? "verified MCP tool: 19+23=42"
          : "MCP tool verification failed";
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

function emptyObservation(): MockObservation {
  return {
    requestCount: 0,
    discoveredNamespacedTool: false,
    emittedNamespacedCall: false,
    sawMcpResult: false,
    toolResult: null,
  };
}

function writeChunk(
  output: NodeJS.WritableStream,
  chunk: Record<string, unknown>,
): void {
  output.write(`data: ${JSON.stringify(chunk)}\n\n`);
}
