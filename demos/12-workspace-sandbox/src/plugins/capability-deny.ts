import type { Context } from "@deepseek-ai/cordis";

export const name = "workspace-capability-deny";
export const inject = ["tools"];

const DENIALS: Readonly<Record<string, string>> = {
  bash: "demo policy denies Shell by default",
  pwsh: "demo policy denies Shell by default",
  web_search: "demo policy denies network tools by default",
  web_fetch: "demo policy denies network tools by default",
};

export function apply(ctx: Context): void {
  ctx.tools.guard((execution) => DENIALS[execution.name]);
}
