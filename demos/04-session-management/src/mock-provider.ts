import type { FastifyInstance } from "fastify";

interface MockBody {
  messages?: Array<{ content?: unknown }>;
}

export function registerMockProvider(app: FastifyInstance): void {
  app.post<{ Body: MockBody }>(
    "/mock/v1/chat/completions",
    async (request, reply) => {
      const conversation = (request.body?.messages ?? [])
        .map((message) => stringifyContent(message.content))
        .join("\n");
      const content = conversation.includes("remembered:blue")
        ? "context-ok"
        : "remembered:blue";

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      const chunks = [
        {
          choices: [
            {
              delta: { role: "assistant", content },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 2,
            total_tokens: 12,
          },
        },
      ];

      for (const chunk of chunks) {
        reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      reply.raw.end("data: [DONE]\n\n");
    },
  );
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (
        typeof block === "object" &&
        block !== null &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return block.text;
      }
      return "";
    })
    .join("");
}
