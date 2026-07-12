import { describe, expect, it, vi } from 'vitest'

import { resolveCoreStopPid } from '@/stores/kernelProcess'

describe('kernel process helpers', () => {
  it('uses the current pid when it is valid', async () => {
    const findListeningProcess = vi.fn()

    await expect(resolveCoreStopPid(123, 20123, findListeningProcess)).resolves.toBe(123)

    expect(findListeningProcess).not.toHaveBeenCalled()
  })

  it('finds the listening core process when current pid is missing', async () => {
    const findListeningProcess = vi.fn().mockResolvedValue(278335)

    await expect(resolveCoreStopPid(-1, 20123, findListeningProcess)).resolves.toBe(278335)

    expect(findListeningProcess).toHaveBeenCalledWith(20123)
  })

  it('falls back to the pid file when the listening process cannot be found', async () => {
    const findListeningProcess = vi.fn().mockRejectedValue('process not found')
    const readPidFile = vi.fn().mockResolvedValue('105992')

    await expect(resolveCoreStopPid(-1, 20123, findListeningProcess, readPidFile)).resolves.toBe(
      105992,
    )

    expect(readPidFile).toHaveBeenCalledOnce()
  })
})
