import type { FastifyInstance } from "fastify";

export function registerMockProvider(app: FastifyInstance): void {
  app.post("/mock/v1/chat/completions", async (_request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    reply.raw.write(
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              role: "assistant",
              content: process.env.MOCK_RESPONSE ?? "scheduled-ok",
            },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    );
    reply.raw.write(
      `data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      })}\n\n`,
    );
    reply.raw.end("data: [DONE]\n\n");
  });
}
