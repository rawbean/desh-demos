import type { DeepSeekHarnessOptions } from "@deepseek-ai/dsh-sdk-client";

export interface ModelRoute {
  provider: string;
  model: string;
  label: string;
}

export interface ResolvedModelRoute extends ModelRoute {
  sdkProvider: string;
}

const MOCK_ROUTES: ResolvedModelRoute[] = [
  {
    provider: "mock-primary",
    model: "mock-blue",
    label: "Deterministic blue mock",
    sdkProvider: "deepseek-official",
  },
  {
    provider: "mock-secondary",
    model: "mock-green",
    label: "Deterministic green mock",
    sdkProvider: "deepseek-official",
  },
];

export class UnknownModelRouteError extends Error {
  constructor(provider: string, model: string) {
    super(`unknown provider/model route: ${provider}/${model}`);
    this.name = "UnknownModelRouteError";
  }
}

export class ModelCatalog {
  private readonly routes: ResolvedModelRoute[];

  constructor(routes: ResolvedModelRoute[] = routesFromEnvironment()) {
    if (routes.length < 1)
      throw new Error("at least one model route is required");
    this.routes = routes.map((route) => ({ ...route }));
  }

  list(): ModelRoute[] {
    return this.routes.map((route) => ({
      provider: route.provider,
      model: route.model,
      label: route.label,
    }));
  }

  resolve(provider: string, model: string): ResolvedModelRoute {
    const route = this.routes.find(
      (candidate) =>
        candidate.provider === provider && candidate.model === model,
    );
    if (!route) throw new UnknownModelRouteError(provider, model);
    return { ...route };
  }

  initial(): ResolvedModelRoute {
    const provider = process.env.DSH_PROVIDER;
    const model = process.env.DSH_MODEL;
    if (provider !== undefined || model !== undefined) {
      return this.resolve(
        provider ?? this.routes[0]!.provider,
        model ?? this.routes[0]!.model,
      );
    }
    return { ...this.routes[0]! };
  }
}

export function harnessBaseOptions(): Omit<
  DeepSeekHarnessOptions,
  "provider" | "model"
> {
  return {
    profile: process.env.DSH_PROFILE ?? "sdk",
    cwd: process.env.DSH_WORKSPACE ?? process.cwd(),
    dshHome: process.env.DSH_HOME ?? "/tmp/dsh-home",
    maxTokens: positiveInteger(process.env.DSH_MAX_TOKENS, 256),
    initializeTimeoutMs: positiveInteger(
      process.env.DSH_INITIALIZE_TIMEOUT_MS,
      10_000,
    ),
  };
}

function routesFromEnvironment(): ResolvedModelRoute[] {
  if (process.env.ENABLE_MOCK_PROVIDER === "true") return MOCK_ROUTES;
  return [
    {
      provider: process.env.DSH_PROVIDER ?? "deepseek-official",
      model: process.env.DSH_MODEL ?? "deepseek-v4-flash",
      label: "Configured DeepSeek route",
      sdkProvider: process.env.DSH_PROVIDER ?? "deepseek-official",
    },
  ];
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
