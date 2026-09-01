import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";

export const name = "deterministic-custom-tool";
export const inject = ["tools"];
export const TOOL_NAME = "deterministic_score";

export interface ScoreResult {
  label: string;
  mode: "sum" | "weighted";
  score: number;
  fingerprint: string;
}

export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: TOOL_NAME,
      description:
        "Calculate a deterministic sum or position-weighted score for integer values.",
      parameters: {
        label: {
          type: "string",
          required: true,
          description: "Stable label included in the result fingerprint.",
        },
        values: {
          type: "array",
          items: { type: "integer" },
          required: true,
          description: "Integers to score in their supplied order.",
        },
        mode: {
          type: "string",
          enum: ["sum", "weighted"],
          required: true,
          description: "Use a plain sum or one-based positional weights.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            label: { type: "string", required: true },
            mode: {
              type: "string",
              enum: ["sum", "weighted"],
              required: true,
            },
            score: { type: "integer", required: true },
            fingerprint: { type: "string", required: true },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: JSON.stringify(value),
          },
        ],
      },
      async execute(args): Promise<ScoreResult> {
        const score = args.values.reduce(
          (total, value, index) =>
            total + value * (args.mode === "weighted" ? index + 1 : 1),
          0,
        );
        return {
          label: args.label,
          mode: args.mode,
          score,
          fingerprint: `${args.label}:${args.mode}:${args.values.join(",")}:${score}`,
        };
      },
      presentCall: (args) => ({
        card: "generic",
        title: `Score ${args.label}`,
        kind: "other",
        rawInput: args,
      }),
    }),
  );
}
