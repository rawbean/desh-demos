import { type Context, Service } from "@deepseek-ai/cordis";

export interface GreetingResult {
  message: string;
  providerInstance: string;
  serviceCall: number;
}

export interface GreetingService {
  greet(name: string): GreetingResult;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    customGreeting: GreetingService;
  }

  interface Events {
    "custom-service/consumed"(result: GreetingResult): void;
  }
}

export const name = "custom-service-provider";
export const provide = "customGreeting";

export interface Config {
  prefix?: string;
  providerInstance?: string;
}

class CustomGreetingService extends Service implements GreetingService {
  private calls = 0;
  private readonly prefix: string;
  private readonly providerInstance: string;

  constructor(ctx: Context, config: Config) {
    super(ctx, "customGreeting");
    this.prefix = config.prefix ?? "Hello";
    this.providerInstance =
      config.providerInstance ?? "cordis-custom-greeting-v1";
  }

  greet(name: string): GreetingResult {
    this.calls += 1;
    return {
      message: `${this.prefix}, ${name}!`,
      providerInstance: this.providerInstance,
      serviceCall: this.calls,
    };
  }
}

export function apply(ctx: Context, config: Config): void {
  new CustomGreetingService(ctx, config);
}
