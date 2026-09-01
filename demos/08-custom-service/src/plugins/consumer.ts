import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { GreetingResult } from "./provider.js";

export const name = "custom-service-consumer";
export const inject = ["customGreeting", "tools"];

interface ToolValue extends GreetingResult {
  eventObserved: boolean;
}

export function apply(ctx: Context): void {
  let latestEvent: GreetingResult | undefined;
  ctx.on("custom-service/consumed", (result) => {
    latestEvent = result;
  });

  ctx.tools.register(
    defineTool({
      name: "custom_service_greet",
      description:
        "Greet a person through the injected custom Cordis greeting service.",
      parameters: {
        name: {
          type: "string",
          required: true,
          description: "Name of the person to greet.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            message: { type: "string", required: true },
            providerInstance: { type: "string", required: true },
            serviceCall: { type: "integer", required: true },
            eventObserved: { type: "boolean", required: true },
          },
        },
        render: (_args, value) => {
          const result = value as unknown as ToolValue;
          return [
            {
              type: "text",
              text: `${result.message} [${result.providerInstance}; call=${result.serviceCall}; event=${result.eventObserved}]`,
            },
          ];
        },
      },
      async execute(args) {
        latestEvent = undefined;
        const result = ctx.customGreeting.greet(args.name);
        ctx.emit("custom-service/consumed", result);
        return {
          ...result,
          eventObserved: latestEvent === result,
        };
      },
      presentCall: (args) => ({
        card: "generic",
        title: "Custom service greeting",
        kind: "other",
        rawInput: args,
      }),
    }),
  );
}
