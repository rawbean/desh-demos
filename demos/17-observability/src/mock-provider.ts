import type { FastifyInstance } from "fastify";

const TOOL_NAME = "todo_write";

interface ChatBody {
  messages?: Array<{ role?: string; content?: unknown }>;
  tools?: Array<{ function?: { name?: string } }>;
}

export function registerMockProvider(app: FastifyInstance): void {
  let sawToolResult = false;
  app.get("/mock/observation", async () => ({ sawToolResult }));
  app.post<{ Body: ChatBody }>(
    "/mock/v1/chat/completions",
    async (request, reply) => {
      const toolMessage = request.body?.messages?.find(
        (message) => message.role === "tool",
      );
      const hasTool =
        request.body?.tools?.some(
          (tool) => tool.function?.name === TOOL_NAME,
        ) === true;
      sawToolResult ||= toolMessage !== undefined;
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      if (!toolMessage && hasTool) {
        writeChunk(reply.raw, {
          choices: [
            {
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "observed-sum-1",
                    type: "function",
                    function: {
                      name: TOOL_NAME,
                      arguments:
                        '{"todos":[{"content":"record observability proof","status":"completed"}]}',
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
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        });
      } else {
        writeChunk(reply.raw, {
          choices: [
            {
              delta: {
                role: "assistant",
                content: "observed todo tool completed",
              },
              finish_reason: null,
            },
          ],
        });
        writeChunk(reply.raw, {
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 19, completion_tokens: 6, total_tokens: 25 },
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
