import {
  DeepSeekHarness,
  type DeepSeekHarnessOptions,
  type RunResult,
} from '@deepseek-ai/dsh-sdk-client'

export interface TaskResult {
  sessionId: string
  finalResponse: string
  eventCount: number
  notificationCount: number
  durationMs: number
}

export interface HarnessTaskClient {
  run(input: string): Promise<RunResult>
  close(): Promise<void>
}

type HarnessFactory = (options: DeepSeekHarnessOptions) => HarnessTaskClient

const defaultFactory: HarnessFactory = (options) => new DeepSeekHarness(options)

export class TaskExecutor {
  private readonly harness: HarnessTaskClient

  constructor(
    options: DeepSeekHarnessOptions,
    factory: HarnessFactory = defaultFactory,
  ) {
    this.harness = factory(options)
  }

  async execute(prompt: string): Promise<TaskResult> {
    const input = prompt.trim()
    if (input.length === 0) throw new Error('prompt must not be empty')

    const startedAt = performance.now()
    const result = await this.harness.run(input)

    return {
      sessionId: result.sessionId,
      finalResponse: result.finalResponse,
      eventCount: result.events.length,
      notificationCount: result.notifications.length,
      durationMs: Math.round(performance.now() - startedAt),
    }
  }

  async close(): Promise<void> {
    await this.harness.close()
  }
}
