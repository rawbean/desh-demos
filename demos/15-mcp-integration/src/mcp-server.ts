import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export const RAW_TOOL_NAME = "calculate";

const eventFile =
  process.env.DSH_MCP_EVENT_FILE ?? "/tmp/dsh-demo-15-mcp-events.jsonl";

function record(event: string, data: Record<string, unknown> = {}): void {
  mkdirSync(dirname(eventFile), { recursive: true });
  appendFileSync(
    eventFile,
    `${JSON.stringify({
      source: "mcp-server",
      event,
      pid: process.pid,
      timestamp: new Date().toISOString(),
      ...data,
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

const server = new Server(
  { name: "dsh-demo-15-stdio", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => {
  record("tools-listed", { tool: RAW_TOOL_NAME });
  return {
    tools: [
      {
        name: RAW_TOOL_NAME,
        description: "Add two integers and return a deterministic proof.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            left: { type: "integer" },
            right: { type: "integer" },
          },
          required: ["left", "right"],
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            sum: { type: "integer" },
            proof: { type: "string" },
          },
          required: ["sum", "proof"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, (request) => {
  if (request.params.name !== RAW_TOOL_NAME) {
    return {
      isError: true,
      content: [{ type: "text", text: "unknown tool" }],
    };
  }
  const args = request.params.arguments;
  const left = args?.left;
  const right = args?.right;
  if (!Number.isInteger(left) || !Number.isInteger(right)) {
    return {
      isError: true,
      content: [{ type: "text", text: "left and right must be integers" }],
    };
  }
  const result = {
    sum: Number(left) + Number(right),
    proof: `${left}+${right}=${Number(left) + Number(right)}`,
  };
  record("tool-called", { tool: RAW_TOOL_NAME, arguments: args, result });
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result,
  };
});

const transport = new StdioServerTransport();
record("started");
await server.connect(transport);
record("initialized");

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  record("stopping", { signal });
  await server.close().catch(() => undefined);
  record("stopped", { signal });
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
