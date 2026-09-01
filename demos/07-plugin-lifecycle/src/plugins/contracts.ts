import type { Context } from "@deepseek-ai/cordis";

export type PluginId = "observer" | "enforcer";

export interface ProbeService {
  readonly pluginId: PluginId;
  inspect(prompt: string): string;
}

export interface LifecycleEvent {
  sequence: number;
  generation: number;
  pluginId: PluginId;
  phase:
    "provider-start" | "consumer-start" | "consumer-stop" | "provider-stop";
}

export class LifecycleJournal {
  private events: LifecycleEvent[] = [];

  record(event: Omit<LifecycleEvent, "sequence">): void {
    this.events.push({ ...event, sequence: this.events.length + 1 });
  }

  snapshot(): LifecycleEvent[] {
    return this.events.map((event) => ({ ...event }));
  }
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    lifecycleProbe: ProbeService;
  }
}

export interface PluginConfig {
  pluginId: PluginId;
  generation: number;
  journal: LifecycleJournal;
}

export type CordisContext = Context;
