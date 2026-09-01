import type { FastifyInstance } from "fastify";

interface ChatBody {
  messages?: unknown[];
}

export interface MockObservation {
  plugin: "observer" | "enforcer" | "unknown";
  localProbe: string | null;
}

export class MockStore {
  private value: MockObservation | undefined;

  record(value: MockObservation): void {
    this.value = { ...value };
  }

  latest(): MockObservation | undefined {
    return this.value ? { ...this.value } : undefined;
  }
}

export function registerMockProvider(
  app: FastifyInstance,
  store: MockStore,
): void {
  app.post<{ Body: ChatBody }>(
    "/mock/v1/chat/completions",
    async (request, reply) => {
      const messages = JSON.stringify(request.body?.messages ?? []);
      const plugin = messages.includes("PLUGIN_LIFECYCLE=observer")
        ? "observer"
        : messages.includes("PLUGIN_LIFECYCLE=enforcer")
          ? "enforcer"
          : "unknown";
      const match = messages.match(/LOCAL_CORDIS_PROBE=([^"\\\n]+)/);
      const observation: MockObservation = {
        plugin,
        localProbe: match?.[1] ?? null,
      };
      store.record(observation);

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      writeChunk(reply.raw, {
        choices: [
          {
            delta: {
              role: "assistant",
              content: `plugin=${plugin};probe=${observation.localProbe}`,
            },
            finish_reason: null,
          },
        ],
      });
      writeChunk(reply.raw, {
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
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
