import { describe, expect, it, vi } from 'vitest'

import { replaceFileWithRollback } from '@/utils/fileTransaction'

describe('replaceFileWithRollback', () => {
  it('keeps the previous active file as a backup after a successful replacement', async () => {
    const exists = vi.fn().mockResolvedValue(true)
    const move = vi.fn().mockResolvedValue(undefined)
    const remove = vi.fn().mockResolvedValue(undefined)

    await replaceFileWithRollback(
      { activePath: 'active', replacementPath: 'staged', backupPath: 'backup' },
      { exists, move, remove },
    )

    expect(remove).toHaveBeenCalledWith('backup')
    expect(move.mock.calls).toEqual([
      ['active', 'backup'],
      ['staged', 'active'],
    ])
  })

  it('restores the active file when committing the replacement fails', async () => {
    const exists = vi.fn().mockResolvedValue(true)
    const move = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('commit failed'))
      .mockResolvedValueOnce(undefined)
    const remove = vi.fn().mockResolvedValue(undefined)

    await expect(
      replaceFileWithRollback(
        { activePath: 'active', replacementPath: 'staged', backupPath: 'backup' },
        { exists, move, remove },
      ),
    ).rejects.toThrow('commit failed')

    expect(move.mock.calls).toEqual([
      ['active', 'backup'],
      ['staged', 'active'],
      ['backup', 'active'],
    ])
  })

  it('installs directly when no active file exists', async () => {
    const exists = vi.fn().mockResolvedValue(false)
    const move = vi.fn().mockResolvedValue(undefined)
    const remove = vi.fn().mockResolvedValue(undefined)

    await replaceFileWithRollback(
      { activePath: 'active', replacementPath: 'staged', backupPath: 'backup' },
      { exists, move, remove },
    )

    expect(remove).not.toHaveBeenCalled()
    expect(move).toHaveBeenCalledOnce()
    expect(move).toHaveBeenCalledWith('staged', 'active')
  })
})
