import { describe, expect, it, vi } from 'vitest'

describe('kernel constants', () => {
  it('uses daily managed core log files', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-19T10:00:00'))

    const { getCoreLogFilePath } = await import('@/constant/kernel')

    expect(getCoreLogFilePath()).toBe('logs/core-2026-06-19.log')

    vi.useRealTimers()
  })
})
