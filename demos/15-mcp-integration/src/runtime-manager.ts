import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DeepSeekHarness,
  type DeepSeekHarnessOptions,
  type HarnessNotification,
  type RunResult,
} from "@deepseek-ai/dsh-sdk-client";

export const PUBLIC_TOOL_NAME = "mcp__demo__calculate";

export interface HarnessRuntime {
  start(): Promise<void>;
  run(
    input: string,
    options: {
      sessionId: string;
      onNotification: (notification: HarnessNotification) => void;
    },
  ): Promise<RunResult>;
  close(): Promise<void>;
}

export interface RuntimeRun {
  result: RunResult;
  notifications: HarnessNotification[];
}

export interface RuntimeStatus {
  state: "stopped" | "running";
  initialized: boolean;
  activeRuns: number;
  startedAt: string | null;
  patchPath: string | null;
  expectedTool: string;
  mcpEventFile: string;
}

type HarnessFactory = (options: DeepSeekHarnessOptions) => HarnessRuntime;

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const moduleParent = dirname(moduleDirectory);
const projectRoot =
  basename(moduleParent) === "dist" ? dirname(moduleParent) : moduleParent;

export class RuntimeBusyError extends Error {
  constructor() {
    super("runtime has active runs");
    this.name = "RuntimeBusyError";
  }
}

export class RuntimeManager {
  private harness: HarnessRuntime | undefined;
  private activeRuns = 0;
  private startedAt: string | null = null;
  private patchPath: string | null = null;

  constructor(
    private readonly baseOptions: Omit<DeepSeekHarnessOptions, "patches">,
    readonly dshHome: string,
    readonly mcpEventFile: string,
    private readonly factory: HarnessFactory = (options) =>
      new DeepSeekHarness(options),
  ) {}

  status(): RuntimeStatus {
    return {
      state: this.harness ? "running" : "stopped",
      initialized: this.harness !== undefined,
      activeRuns: this.activeRuns,
      startedAt: this.startedAt,
      patchPath: this.patchPath,
      expectedTool: PUBLIC_TOOL_NAME,
      mcpEventFile: this.mcpEventFile,
    };
  }

  async start(): Promise<RuntimeStatus> {
    if (this.harness) return this.status();
    const patchPath = await materializePatch(this.dshHome, this.mcpEventFile);
    const harness = this.factory({ ...this.baseOptions, patches: [patchPath] });
    try {
      await harness.start();
    } catch (error) {
      await harness.close().catch(() => undefined);
      throw error;
    }
    this.harness = harness;
    this.patchPath = patchPath;
    this.startedAt = new Date().toISOString();
    return this.status();
  }

  async run(prompt: string, sessionId: string): Promise<RuntimeRun> {
    if (this.activeRuns > 0) throw new RuntimeBusyError();
    await this.start();
    const harness = this.harness;
    if (!harness) throw new Error("runtime did not start");
    const notifications: HarnessNotification[] = [];
    this.activeRuns += 1;
    try {
      const result = await harness.run(prompt, {
        sessionId,
        onNotification: (notification) => notifications.push(notification),
      });
      return { result, notifications };
    } finally {
      this.activeRuns -= 1;
    }
  }

  async stop(force = false): Promise<RuntimeStatus> {
    if (this.activeRuns > 0 && !force) throw new RuntimeBusyError();
    const harness = this.harness;
    if (!harness) return this.status();
    await harness.close();
    this.harness = undefined;
    this.startedAt = null;
    return this.status();
  }

  async close(): Promise<void> {
    await this.stop(true);
  }
}

export async function materializePatch(
  dshHome: string,
  mcpEventFile: string,
): Promise<string> {
  const template = await readFile(
    join(projectRoot, "patches/mcp-client.patch.yml"),
    "utf8",
  );
  const replacements: Record<string, string> = {
    __NODE_COMMAND__: JSON.stringify(process.execPath),
    __MCP_SERVER_PATH__: JSON.stringify(
      join(projectRoot, "dist/mcp-server.js"),
    ),
    __MCP_EVENT_FILE__: JSON.stringify(mcpEventFile),
    __MCP_CWD__: JSON.stringify(projectRoot),
  };
  const patch = Object.entries(replacements).reduce(
    (value, [token, replacement]) => value.replace(token, replacement),
    template,
  );
  if (patch.includes("__")) throw new Error("unresolved MCP client patch");
  await mkdir(dshHome, { recursive: true });
  const output = join(dshHome, "mcp-client.resolved.patch.yml");
  await writeFile(output, patch, { encoding: "utf8", mode: 0o600 });
  return output;
}

export function createRuntime(): RuntimeManager {
  const dshHome = process.env.DSH_HOME ?? "/tmp/dsh-demo-15-home";
  const mcpEventFile =
    process.env.DSH_MCP_EVENT_FILE ?? "/tmp/dsh-demo-15-mcp-events.jsonl";
  return new RuntimeManager(
    {
      profile: process.env.DSH_PROFILE ?? "sdk",
      provider: process.env.DSH_PROVIDER ?? "deepseek-official",
      model: process.env.DSH_MODEL ?? "deepseek-v4-flash",
      cwd: process.env.DSH_WORKSPACE ?? process.cwd(),
      dshHome,
      maxTokens: positiveInteger(process.env.DSH_MAX_TOKENS, 512),
      initializeTimeoutMs: positiveInteger(
        process.env.DSH_INITIALIZE_TIMEOUT_MS,
        10_000,
      ),
    },
    dshHome,
    mcpEventFile,
  );
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
