import { join } from "node:path";
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
  toolNames: string[];
  emittedFixedCalls: boolean;
  sawWorkspaceWrite: boolean;
  sawOutsideDenial: boolean;
  sawShellDenial: boolean;
  sawNetworkDenial: boolean;
}

export class MockObservationStore {
  private observation: MockObservation = {
    requestCount: 0,
    toolNames: [],
    emittedFixedCalls: false,
    sawWorkspaceWrite: false,
    sawOutsideDenial: false,
    sawShellDenial: false,
    sawNetworkDenial: false,
  };

  observe(body: ChatBody): MockObservation {
    const toolText = (body.messages ?? [])
      .filter((message) => message.role === "tool")
      .map((message) =>
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content),
      )
      .join("\n");
    this.observation = {
      requestCount: this.observation.requestCount + 1,
      toolNames:
        this.observation.toolNames.length > 0
          ? this.observation.toolNames
          : (body.tools ?? [])
              .map((tool) => tool.function?.name)
              .filter((name): name is string => name !== undefined),
      emittedFixedCalls:
        this.observation.emittedFixedCalls ||
        (this.observation.requestCount === 0 &&
          body.tools?.some((tool) => tool.function?.name === "write") === true),
      sawWorkspaceWrite:
        this.observation.sawWorkspaceWrite || toolText.includes("Created file"),
      sawOutsideDenial:
        this.observation.sawOutsideDenial ||
        toolText.includes(
          "[sandbox: file access denied under workspace-write mode]",
        ),
      sawShellDenial:
        this.observation.sawShellDenial ||
        toolText.includes("demo policy denies Shell by default"),
      sawNetworkDenial:
        this.observation.sawNetworkDenial ||
        toolText.includes("demo policy denies network tools by default"),
    };
    return this.latest();
  }

  latest(): MockObservation {
    return {
      ...this.observation,
      toolNames: [...this.observation.toolNames],
    };
  }
}

export function registerMockProvider(
  app: FastifyInstance,
  store: MockObservationStore,
  workspace: string,
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

      if (observation.requestCount === 1 && observation.emittedFixedCalls) {
        const calls = [
          {
            id: "workspace-write-1",
            name: "write",
            arguments: JSON.stringify({
              file_path: join(workspace, "inside-proof.txt"),
              content: "written through the real DSH fs tool\n",
            }),
          },
          {
            id: "outside-write-1",
            name: "write",
            arguments: JSON.stringify({
              file_path: "/etc/dsh-demo-12-outside-proof.txt",
              content: "this must never be written\n",
            }),
          },
          {
            id: "shell-deny-1",
            name: "bash",
            arguments: JSON.stringify({
              command: "printf shell-ran",
              description: "Probe denied shell capability",
            }),
          },
          {
            id: "network-deny-1",
            name: "web_search",
            arguments: JSON.stringify({
              queries: ["dsh sandbox network probe"],
            }),
          },
        ];
        writeChunk(reply.raw, {
          choices: [
            {
              delta: {
                role: "assistant",
                tool_calls: calls.map((call, index) => ({
                  index,
                  id: call.id,
                  type: "function",
                  function: {
                    name: call.name,
                    arguments: call.arguments,
                  },
                })),
              },
              finish_reason: null,
            },
          ],
        });
        writeChunk(reply.raw, {
          choices: [{ delta: {}, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        });
      } else {
        const verified =
          observation.sawWorkspaceWrite &&
          observation.sawOutsideDenial &&
          observation.sawShellDenial &&
          observation.sawNetworkDenial;
        writeChunk(reply.raw, {
          choices: [
            {
              delta: {
                role: "assistant",
                content: verified
                  ? "verified workspace sandbox and default capability denials"
                  : "workspace sandbox verification failed",
              },
              finish_reason: null,
            },
          ],
        });
        writeChunk(reply.raw, {
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
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
