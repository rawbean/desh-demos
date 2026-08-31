import { describe, expect, it, vi } from 'vitest'
import {
  TaskExecutor,
  type HarnessTaskClient,
} from '../src/task-executor.js'

function createHarness(): HarnessTaskClient {
  return {
    run: vi.fn(async () => ({
      sessionId: 'session-001',
      finalResponse: 'task-ok',
      events: [],
      notifications: [],
    })),
    close: vi.fn(async () => undefined),
  }
}

describe('TaskExecutor', () => {
  it('submits a prompt and returns the final task result', async () => {
    const harness = createHarness()
    const executor = new TaskExecutor({}, () => harness)

    const result = await executor.execute('  reply with task-ok  ')

    expect(harness.run).toHaveBeenCalledWith('reply with task-ok')
    expect(result).toMatchObject({
      sessionId: 'session-001',
      finalResponse: 'task-ok',
      eventCount: 0,
      notificationCount: 0,
    })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('rejects an empty prompt before calling the SDK', async () => {
    const harness = createHarness()
    const executor = new TaskExecutor({}, () => harness)

    await expect(executor.execute('   ')).rejects.toThrow(
      'prompt must not be empty',
    )
    expect(harness.run).not.toHaveBeenCalled()
  })

  it('closes the SDK-owned runtime', async () => {
    const harness = createHarness()
    const executor = new TaskExecutor({}, () => harness)

    await executor.close()

    expect(harness.close).toHaveBeenCalledTimes(1)
  })
})
