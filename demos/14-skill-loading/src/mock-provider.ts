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
  sawSkillTool: boolean;
  sawDiscoveredCatalog: boolean;
  emittedSkillCall: boolean;
  sawLoadedBody: boolean;
  loadedToolResult: string | null;
}

export class MockObservationStore {
  private observation: MockObservation = {
    requestCount: 0,
    sawSkillTool: false,
    sawDiscoveredCatalog: false,
    emittedSkillCall: false,
    sawLoadedBody: false,
    loadedToolResult: null,
  };

  observe(body: ChatBody): MockObservation {
    const serializedMessages = JSON.stringify(body.messages ?? []);
    const toolMessage = body.messages?.find(
      (message) => message.role === "tool",
    );
    const loadedToolResult =
      toolMessage === undefined ? null : JSON.stringify(toolMessage.content);
    const sawSkillTool =
      body.tools?.some((tool) => tool.function?.name === "skill") === true;
    const sawDiscoveredCatalog =
      serializedMessages.includes("<available_skills>") &&
      serializedMessages.includes("deterministic-verdict") &&
      serializedMessages.includes(
        "Load this skill when asked for the demo's deterministic verdict.",
      );
    const sawLoadedBody =
      loadedToolResult?.includes(
        '<skill_content name=\\"deterministic-verdict\\">',
      ) === true &&
      loadedToolResult.includes("SKILL_LOADED_VERDICT_314159") &&
      loadedToolResult.includes("<skill_instructions>");

    this.observation = {
      requestCount: this.observation.requestCount + 1,
      sawSkillTool: this.observation.sawSkillTool || sawSkillTool,
      sawDiscoveredCatalog:
        this.observation.sawDiscoveredCatalog || sawDiscoveredCatalog,
      emittedSkillCall:
        this.observation.emittedSkillCall ||
        (this.observation.requestCount === 0 &&
          sawSkillTool &&
          sawDiscoveredCatalog),
      sawLoadedBody: this.observation.sawLoadedBody || sawLoadedBody,
      loadedToolResult: loadedToolResult ?? this.observation.loadedToolResult,
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
        observation.requestCount === 1 &&
        observation.sawSkillTool &&
        observation.sawDiscoveredCatalog
      ) {
        writeChunk(reply.raw, {
          choices: [
            {
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "skill-load-call-1",
                    type: "function",
                    function: {
                      name: "skill",
                      arguments: '{"name":"deterministic-verdict"}',
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
          usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
        });
      } else {
        const content = observation.sawLoadedBody
          ? "SKILL_LOADED_VERDICT_314159"
          : "skill loading verification failed";
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
          usage: { prompt_tokens: 30, completion_tokens: 6, total_tokens: 36 },
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
