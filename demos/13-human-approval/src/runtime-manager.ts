import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DeepSeekHarness,
  type DeepSeekHarnessOptions,
  type HarnessNotification,
  type RunResult,
} from "@deepseek-ai/dsh-sdk-client";
import { approvalMode, type ApprovalMode } from "./plugins/human-approval.js";

export interface RuntimeStatus {
  state: "stopped" | "running";
  activeRuns: number;
  startedAt: string | null;
  approvalMode: ApprovalMode;
  patchPath: string | null;
}

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

type HarnessFactory = (options: DeepSeekHarnessOptions) => HarnessRuntime;

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const moduleParent = dirname(moduleDirectory);
const projectRoot =
  basename(moduleParent) === "dist" ? dirname(moduleParent) : moduleParent;

export class RuntimeBusyError extends Error {
  constructor() {
    super("runtime has an active run");
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
    private readonly dshHome: string,
    private readonly mode: ApprovalMode,
    private readonly factory: HarnessFactory = (options) =>
      new DeepSeekHarness(options),
  ) {}

  status(): RuntimeStatus {
    return {
      state: this.harness ? "running" : "stopped",
      activeRuns: this.activeRuns,
      startedAt: this.startedAt,
      approvalMode: this.mode,
      patchPath: this.patchPath,
    };
  }

  async start(): Promise<RuntimeStatus> {
    if (this.harness) return this.status();
    const patchPath = await materializePatch(this.dshHome);
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

  async run(
    prompt: string,
    sessionId: string,
    onNotification: (notification: HarnessNotification) => void,
  ): Promise<RunResult> {
    if (this.activeRuns > 0) throw new RuntimeBusyError();
    await this.start();
    const harness = this.harness;
    if (!harness) throw new Error("runtime did not start");
    this.activeRuns += 1;
    try {
      return await harness.run(prompt, { sessionId, onNotification });
    } finally {
      this.activeRuns -= 1;
    }
  }

  async stop(): Promise<RuntimeStatus> {
    if (this.activeRuns > 0) throw new RuntimeBusyError();
    const harness = this.harness;
    if (!harness) return this.status();
    await harness.close();
    this.harness = undefined;
    this.startedAt = null;
    return this.status();
  }

  async close(): Promise<void> {
    const harness = this.harness;
    if (!harness) return;
    await harness.close();
    this.harness = undefined;
    this.startedAt = null;
  }
}

export async function materializePatch(dshHome: string): Promise<string> {
  const templatePath = join(projectRoot, "patches/human-approval.patch.yml");
  const pluginUrl = pathToFileURL(
    join(projectRoot, "dist/plugins/human-approval.js"),
  ).href;
  const template = await readFile(templatePath, "utf8");
  const patch = template.replace("__HUMAN_APPROVAL_PLUGIN_URL__", pluginUrl);
  if (patch.includes("__HUMAN_APPROVAL_PLUGIN_URL__")) {
    throw new Error("unresolved human approval patch");
  }
  await mkdir(dshHome, { recursive: true });
  const output = join(dshHome, "human-approval.resolved.patch.yml");
  await writeFile(output, patch, { encoding: "utf8", mode: 0o600 });
  return output;
}

export function createRuntime(): RuntimeManager {
  const dshHome = process.env.DSH_HOME ?? "/tmp/dsh-demo-13-home";
  return new RuntimeManager(
    {
      profile: "sdk",
      provider: "deepseek-official",
      model: process.env.DSH_MODEL ?? "mock-model",
      cwd: process.env.DSH_WORKSPACE ?? process.cwd(),
      dshHome,
      maxTokens: positiveInteger(process.env.DSH_MAX_TOKENS, 256),
      initializeTimeoutMs: positiveInteger(
        process.env.DSH_INITIALIZE_TIMEOUT_MS,
        10_000,
      ),
    },
    dshHome,
    approvalMode(),
  );
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
