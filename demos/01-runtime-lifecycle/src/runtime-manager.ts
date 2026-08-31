import {
  DeepSeekHarness,
  type DeepSeekHarnessOptions,
} from '@deepseek-ai/dsh-sdk-client'

export type RuntimeState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'failed'

export interface RuntimeStatus {
  state: RuntimeState
  startedAt: string | null
  lastError: string | null
}

export interface HarnessLifecycle {
  start(): Promise<void>
  close(): Promise<void>
}

type HarnessFactory = (options: DeepSeekHarnessOptions) => HarnessLifecycle

const defaultFactory: HarnessFactory = (options) => new DeepSeekHarness(options)

export class RuntimeManager {
  private state: RuntimeState = 'stopped'
  private harness: HarnessLifecycle | undefined
  private transition: Promise<void> | undefined
  private startedAt: string | null = null
  private lastError: string | null = null

  constructor(
    private readonly options: DeepSeekHarnessOptions,
    private readonly factory: HarnessFactory = defaultFactory,
  ) {}

  status(): RuntimeStatus {
    return {
      state: this.state,
      startedAt: this.startedAt,
      lastError: this.lastError,
    }
  }

  async start(): Promise<RuntimeStatus> {
    if (this.state === 'running') return this.status()

    if (this.state === 'failed' && this.harness) {
      throw new Error('Runtime cleanup failed; stop it before starting a new process')
    }

    if (this.state === 'starting' && this.transition) {
      await this.transition
      return this.status()
    }

    if (this.state === 'stopping' && this.transition) {
      await this.transition
    }

    const harness = this.factory(this.options)
    this.harness = harness
    this.state = 'starting'
    this.startedAt = null
    this.lastError = null

    const transition = (async () => {
      try {
        await harness.start()
        this.state = 'running'
        this.startedAt = new Date().toISOString()
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error)
        this.state = 'failed'
        this.harness = undefined
        await harness.close().catch(() => undefined)
        throw error
      }
    })()

    this.transition = transition
    try {
      await transition
    } finally {
      if (this.transition === transition) this.transition = undefined
    }

    return this.status()
  }

  async stop(): Promise<RuntimeStatus> {
    if (this.state === 'stopped') return this.status()

    if (this.state === 'stopping' && this.transition) {
      await this.transition
      return this.status()
    }

    if (this.state === 'starting' && this.transition) {
      await this.transition.catch(() => undefined)
    }

    const harness = this.harness
    if (!harness) {
      this.state = 'stopped'
      this.startedAt = null
      return this.status()
    }

    this.state = 'stopping'
    const transition = harness.close()
    this.transition = transition

    try {
      await transition
      this.harness = undefined
      this.state = 'stopped'
      this.startedAt = null
      this.lastError = null
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      this.state = 'failed'
      throw error
    } finally {
      if (this.transition === transition) this.transition = undefined
    }

    return this.status()
  }
}
