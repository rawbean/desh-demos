import { appendFile, chmod } from "node:fs/promises";
import type { Context } from "@deepseek-ai/cordis";
import type { ApprovalOutcome } from "@deepseek-ai/dsh-user-approval";
import "@deepseek-ai/dsh-permission-presets";
import "@deepseek-ai/dsh-user-approval";
import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "deterministic-human-approval";
export const inject = ["tools", "approval", "permissionPresets"];
export const TOOL_NAME = "high_risk_workspace_delete";

export type ApprovalMode = "allow" | "reject";

export function approvalMode(value = process.env.DEMO_APPROVAL): ApprovalMode {
  if (value === "allow" || value === "reject") return value;
  throw new Error("DEMO_APPROVAL must be exactly allow or reject");
}

export function outcomeFor(mode: ApprovalMode): ApprovalOutcome {
  return mode === "allow" ? "allowed-once" : "rejected";
}

export function apply(ctx: Context): void {
  const mode = approvalMode();
  const eventFile =
    process.env.DSH_APPROVAL_EVENT_FILE ??
    "/tmp/dsh-human-approval-events.jsonl";

  void record(eventFile, {
    event: "plugin-ready",
    mode,
    approvalService: true,
    permissionService: true,
  });

  ctx.on("tools/pre-execute", async (exec, next) => {
    if (exec.name !== TOOL_NAME) return next();
    await record(eventFile, {
      event: "high-risk-tool-gated",
      toolName: exec.name,
      callId: exec.callId,
    });
    return {
      kind: "ask",
      reason: "simulated destructive workspace deletion requires approval",
    };
  });

  ctx.on("approval/request", async (request, next) => {
    if (request.toolName !== TOOL_NAME) return next();
    const outcome = outcomeFor(mode);
    await record(eventFile, {
      event: "answerer-decided",
      toolName: request.toolName,
      callId: request.callId,
      outcome,
      permissionPreset: ctx.permissionPresets.current(request.agent.session),
    });
    return outcome;
  });

  ctx.tools.register(
    defineTool({
      name: TOOL_NAME,
      description:
        "Simulate deleting a protected workspace artifact. This is intentionally high risk and must pass approval.",
      parameters: {
        target: {
          type: "string",
          required: true,
          description: "Protected workspace path selected for the simulation.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            executed: { type: "boolean", required: true },
            target: { type: "string", required: true },
            simulation: { type: "boolean", required: true },
          },
        },
        render: (_args, value) => [
          { type: "text", text: JSON.stringify(value) },
        ],
      },
      async execute(args, exec) {
        await record(eventFile, {
          event: "high-risk-tool-executed",
          toolName: TOOL_NAME,
          callId: exec.callId,
          target: args.target,
        });
        return { executed: true, target: args.target, simulation: true };
      },
      presentCall: (args) => ({
        card: "generic",
        title: `Approve protected deletion simulation: ${args.target}`,
        kind: "other",
        rawInput: args,
      }),
    }),
  );
}

async function record(
  file: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await appendFile(
    file,
    `${JSON.stringify({
      source: "runtime-plugin",
      timestamp: new Date().toISOString(),
      ...fields,
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await chmod(file, 0o600);
}
