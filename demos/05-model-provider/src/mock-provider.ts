import type { FastifyInstance } from "fastify";

interface ChatBody {
  model?: string;
}

const RESPONSES: Record<string, string> = {
  "mock-blue": "blue-provider-answer",
  "mock-green": "green-provider-answer",
};

export function registerMockProvider(app: FastifyInstance): void {
  app.post<{ Body: ChatBody }>(
    "/mock/v1/chat/completions",
    async (request, reply) => {
      const model = request.body?.model ?? "unknown";
      const content = RESPONSES[model] ?? `unknown-model:${model}`;

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
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
        usage: {
          prompt_tokens: 5,
          completion_tokens: 3,
          total_tokens: 8,
        },
      });
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
