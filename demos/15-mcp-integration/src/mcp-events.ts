import { readFile } from "node:fs/promises";

export interface McpEvent {
  source: "mcp-server";
  event: string;
  pid: number;
  timestamp: string;
  [key: string]: unknown;
}

export async function readMcpEvents(path: string): Promise<McpEvent[]> {
  try {
    const content = await readFile(path, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as McpEvent);
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
}

export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isMissingProcess(error);
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isMissingProcess(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ESRCH"
  );
}
