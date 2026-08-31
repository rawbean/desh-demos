import type { FastifyInstance } from "fastify";

interface ChatBody {
  messages?: Array<{ role?: string }>;
}

export function registerMockProvider(app: FastifyInstance): void {
  app.post<{ Body: ChatBody }>(
    "/mock/v1/chat/completions",
    async (request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      const hasToolResult = request.body?.messages?.some(
        (message) => message.role === "tool",
      );
      const useTool =
        process.env.MOCK_USE_TOOL === "true" && hasToolResult !== true;

      if (useTool) {
        writeChunk(reply.raw, {
          choices: [
            {
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "mock-tool-call",
                    type: "function",
                    function: {
                      name: "todo_write",
                      arguments:
                        '{"todos":[{"content":"stream events","status":"completed"}]}',
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
          usage: {
            prompt_tokens: 10,
            completion_tokens: 8,
            total_tokens: 18,
          },
        });
      } else {
        writeChunk(reply.raw, {
          choices: [
            {
              delta: {
                role: "assistant",
                content: process.env.MOCK_RESPONSE ?? "event-stream-ok",
              },
              finish_reason: null,
            },
          ],
        });
        writeChunk(reply.raw, {
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 3,
            total_tokens: 13,
          },
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
