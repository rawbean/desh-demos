import type { FastifyInstance } from "fastify";

interface ChatBody {
  max_tokens?: unknown;
  messages?: Array<{ role?: string; content?: unknown }>;
}

export interface MockState {
  requests: number;
  toolCalls: number;
  agentRequestIntercepted: boolean;
  toolResultIntercepted: boolean;
}

export function registerMockProvider(
  app: FastifyInstance,
  state: MockState,
): void {
  app.post<{ Body: ChatBody }>(
    "/mock/v1/chat/completions",
    async (request, reply) => {
      state.requests += 1;
      const hasToolResult = request.body?.messages?.some(
        (message) => message.role === "tool",
      );
      state.agentRequestIntercepted = request.body?.max_tokens === 321;

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      if (!hasToolResult) {
        state.toolCalls += 1;
        writeChunk(reply.raw, {
          choices: [
            {
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "plugin-events-tool-call",
                    type: "function",
                    function: {
                      name: "todo_write",
                      arguments:
                        '{"todos":[{"content":"verify plugin hooks","status":"completed"}]}',
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
        state.toolResultIntercepted = JSON.stringify(
          request.body?.messages,
        ).includes("PLUGIN_TOOL_INTERCEPTED");
        const ok =
          state.toolCalls === 1 &&
          state.agentRequestIntercepted &&
          state.toolResultIntercepted;
        writeChunk(reply.raw, {
          choices: [
            {
              delta: {
                role: "assistant",
                content: ok ? "plugin-events-ok" : "plugin-events-failed",
              },
              finish_reason: null,
            },
          ],
        });
        writeChunk(reply.raw, {
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 },
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
