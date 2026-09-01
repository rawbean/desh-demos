import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DeepSeekHarness,
  type DeepSeekHarnessOptions,
  type HarnessNotification,
  type RunResult,
} from "@deepseek-ai/dsh-sdk-client";

export interface RuntimeStatus {
  state: "stopped" | "running";
  activeRuns: number;
  startedAt: string | null;
  patchPath: string | null;
  workspace: string;
  permissionMode: "workspace-write";
}

export interface RuntimeRun {
  result: RunResult;
  notifications: HarnessNotification[];
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
    private readonly dshHome: string,
    readonly workspace: string,
    private readonly factory: HarnessFactory = (options) =>
      new DeepSeekHarness(options),
  ) {}

  status(): RuntimeStatus {
    return {
      state: this.harness ? "running" : "stopped",
      activeRuns: this.activeRuns,
      startedAt: this.startedAt,
      patchPath: this.patchPath,
      workspace: this.workspace,
      permissionMode: "workspace-write",
    };
  }

  async start(): Promise<RuntimeStatus> {
    if (this.harness) return this.status();
    await mkdir(this.workspace, { recursive: true });
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

  async run(prompt: string, sessionId: string): Promise<RuntimeRun> {
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

export async function materializePatch(dshHome: string): Promise<string> {
  const templatePath = join(projectRoot, "patches/workspace-sandbox.patch.yml");
  const pluginUrl = pathToFileURL(
    join(projectRoot, "dist/plugins/capability-deny.js"),
  ).href;
  const template = await readFile(templatePath, "utf8");
  const patch = template.replace("__CAPABILITY_DENY_URL__", pluginUrl);
  if (patch.includes("__")) throw new Error("unresolved sandbox patch");
  await mkdir(dshHome, { recursive: true });
  const output = join(dshHome, "workspace-sandbox.resolved.patch.yml");
  await writeFile(output, patch, { encoding: "utf8", mode: 0o600 });
  return output;
}
