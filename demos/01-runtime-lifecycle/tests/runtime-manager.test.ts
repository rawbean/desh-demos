import { describe, expect, it, vi } from 'vitest'
import {
  RuntimeManager,
  type HarnessLifecycle,
} from '../src/runtime-manager.js'

const options = {}

function createHarness(): HarnessLifecycle {
  return {
    start: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
}

describe('RuntimeManager', () => {
  it('starts once and reuses the running runtime', async () => {
    const harness = createHarness()
    const manager = new RuntimeManager(options, () => harness)

    await manager.start()
    await manager.start()

    expect(harness.start).toHaveBeenCalledTimes(1)
    expect(manager.status().state).toBe('running')
  })

  it('stops once and clears runtime state', async () => {
    const harness = createHarness()
    const manager = new RuntimeManager(options, () => harness)

    await manager.start()
    await manager.stop()
    await manager.stop()

    expect(harness.close).toHaveBeenCalledTimes(1)
    expect(manager.status()).toMatchObject({
      state: 'stopped',
      startedAt: null,
      lastError: null,
    })
  })

  it('creates a fresh runtime after a completed stop', async () => {
    const harnesses = [createHarness(), createHarness()]
    const factory = vi
      .fn()
      .mockReturnValueOnce(harnesses[0])
      .mockReturnValueOnce(harnesses[1])
    const manager = new RuntimeManager(options, factory)

    await manager.start()
    await manager.stop()
    await manager.start()

    expect(factory).toHaveBeenCalledTimes(2)
    expect(harnesses[0]?.close).toHaveBeenCalledTimes(1)
    expect(harnesses[1]?.start).toHaveBeenCalledTimes(1)
  })

  it('allows independent managers to run separate runtimes on one host', async () => {
    const harnessA = createHarness()
    const harnessB = createHarness()
    const managerA = new RuntimeManager(options, () => harnessA)
    const managerB = new RuntimeManager(options, () => harnessB)

    await Promise.all([managerA.start(), managerB.start()])

    expect(harnessA.start).toHaveBeenCalledTimes(1)
    expect(harnessB.start).toHaveBeenCalledTimes(1)
    expect(managerA.status().state).toBe('running')
    expect(managerB.status().state).toBe('running')

    await Promise.all([managerA.stop(), managerB.stop()])
  })

  it('reports initialization failures and cleans up the child', async () => {
    const harness = createHarness()
    vi.mocked(harness.start).mockRejectedValueOnce(new Error('handshake failed'))
    const manager = new RuntimeManager(options, () => harness)

    await expect(manager.start()).rejects.toThrow('handshake failed')

    expect(harness.close).toHaveBeenCalledTimes(1)
    expect(manager.status()).toEqual({
      state: 'failed',
      startedAt: null,
      lastError: 'handshake failed',
    })
  })
})
