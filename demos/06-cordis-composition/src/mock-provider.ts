import type { FastifyInstance } from "fastify";

interface ChatBody {
  messages?: unknown[];
  tools?: Array<{ function?: { name?: string } }>;
}

export interface MockObservation {
  sequence: number;
  detectedProfile: "focused" | "planner" | "unknown";
  hasTodoTool: boolean;
  messageDigest: string;
}

export class MockObservationStore {
  private value: MockObservation | undefined;

  record(observation: Omit<MockObservation, "sequence">): MockObservation {
    this.value = {
      ...observation,
      sequence: (this.value?.sequence ?? 0) + 1,
    };
    return this.value;
  }

  latest(): MockObservation | undefined {
    return this.value ? { ...this.value } : undefined;
  }
}

export function registerMockProvider(
  app: FastifyInstance,
  store: MockObservationStore,
): void {
  app.post<{ Body: ChatBody }>(
    "/mock/v1/chat/completions",
    async (request, reply) => {
      const serializedMessages = JSON.stringify(request.body?.messages ?? []);
      const detectedProfile = serializedMessages.includes(
        "CORDIS_PROFILE=focused",
      )
        ? "focused"
        : serializedMessages.includes("CORDIS_PROFILE=planner")
          ? "planner"
          : "unknown";
      const hasTodoTool = (request.body?.tools ?? []).some((tool) =>
        tool.function?.name?.includes("todo"),
      );
      const observation = store.record({
        detectedProfile,
        hasTodoTool,
        messageDigest: serializedMessages.slice(0, 240),
      });
      const content = `profile=${observation.detectedProfile};todo=${String(observation.hasTodoTool)}`;

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
        usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 },
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
