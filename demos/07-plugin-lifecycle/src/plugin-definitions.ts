import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginId } from "./plugins/contracts.js";

export interface PluginDefinition {
  id: PluginId;
  description: string;
  patch: string;
}

const root = fileURLToPath(new URL("../", import.meta.url));
const patchRoot = resolve(root, "patches");
const manifestPath = resolve(root, "config/plugins.json");
const definitions = loadDefinitions();

export function listPlugins(): PluginDefinition[] {
  return Object.values(definitions).map((definition) => ({ ...definition }));
}

export function getPlugin(id: string): PluginDefinition | undefined {
  const definition = definitions[id as PluginId];
  return definition ? { ...definition } : undefined;
}

function loadDefinitions(): Record<PluginId, PluginDefinition> {
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest))
    throw new Error("plugin manifest must be an array");

  const entries = manifest.map(parseDefinition);
  const definitions = Object.fromEntries(
    entries.map((definition) => [definition.id, definition]),
  ) as Partial<Record<PluginId, PluginDefinition>>;
  if (entries.length !== 2 || !definitions.observer || !definitions.enforcer) {
    throw new Error("plugin manifest must define observer and enforcer once");
  }
  return {
    observer: definitions.observer,
    enforcer: definitions.enforcer,
  };
}

function parseDefinition(value: unknown): PluginDefinition {
  if (!isRecord(value)) throw new Error("invalid plugin definition");
  const { id, description, patch } = value;
  if (
    (id !== "observer" && id !== "enforcer") ||
    typeof description !== "string" ||
    typeof patch !== "string"
  ) {
    throw new Error("invalid plugin definition");
  }

  const absolutePatch = resolve(root, patch);
  const patchRelative = relative(patchRoot, absolutePatch);
  if (
    patchRelative === "" ||
    patchRelative.startsWith("..") ||
    isAbsolute(patchRelative)
  ) {
    throw new Error(`plugin patch must be inside patches/: ${patch}`);
  }
  return { id, description, patch: absolutePatch };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
