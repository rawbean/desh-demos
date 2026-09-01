import { fileURLToPath } from "node:url";

export type CompositionId = "focused" | "planner";

export interface Composition {
  id: CompositionId;
  description: string;
  profile: "sdk";
  patches: string[];
  capabilities: string[];
}

const root = fileURLToPath(new URL("../", import.meta.url));

const compositions: Record<CompositionId, Composition> = {
  focused: {
    id: "focused",
    description: "Direct persona with todo capability removed",
    profile: "sdk",
    patches: [`${root}patches/focused.patch.yml`],
    capabilities: ["focused-persona", "no-todo-tool"],
  },
  planner: {
    id: "planner",
    description: "Planning persona with serialized todo capability",
    profile: "sdk",
    patches: [`${root}patches/planner.patch.yml`],
    capabilities: ["planning-persona", "serialized-todo-tool"],
  },
};

export function listCompositions(): Composition[] {
  return Object.values(compositions).map(copyComposition);
}

export function getComposition(id: string): Composition | undefined {
  const composition = compositions[id as CompositionId];
  return composition ? copyComposition(composition) : undefined;
}

function copyComposition(composition: Composition): Composition {
  return {
    ...composition,
    patches: [...composition.patches],
    capabilities: [...composition.capabilities],
  };
}
