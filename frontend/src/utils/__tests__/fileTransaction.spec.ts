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

import { mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { withConfigMutation } from '@/utils/configPersistence'
import { writeFilesWithRollback } from '@/utils/fileTransaction'

describe('related configuration file writes', () => {
  const diskOps = {
    exists: async (path: string) =>
      access(path).then(
        () => true,
        () => false,
      ),
    read: (path: string) => readFile(path, 'utf8'),
    write: (path: string, content: string) => writeFile(path, content),
    remove: (path: string) => rm(path, { force: true }),
  }

  it('restores actual original files and removes newly created files after a later write fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gfs-transaction-'))
    const existing = join(dir, 'profiles.yaml')
    const created = join(dir, 'cache.json')
    const failed = join(dir, 'subscriptions.yaml')
    try {
      await writeFile(existing, 'original profile\n')
      await writeFile(failed, 'original subscriptions\n')
      let failedOnce = false
      await expect(
        writeFilesWithRollback(
          [
            { path: existing, content: 'new profile' },
            { path: created, content: 'new cache' },
            { path: failed, content: 'new subscriptions' },
          ],
          {
            ...diskOps,
            write: async (path, content) => {
              if (path === failed && !failedOnce) {
                failedOnce = true
                throw new Error('metadata write failed')
              }
              return diskOps.write(path, content)
            },
          },
        ),
      ).rejects.toThrow('metadata write failed')
      expect(await readFile(existing, 'utf8')).toBe('original profile\n')
      expect(await readFile(failed, 'utf8')).toBe('original subscriptions\n')
      expect(await diskOps.exists(created)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports original and rollback failures and continues restoring the remaining files', async () => {
    const writes = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('commit failed'))
      .mockRejectedValueOnce(new Error('restore failed'))
      .mockResolvedValue(undefined)
    await expect(
      writeFilesWithRollback(
        [
          { path: 'a', content: 'new a' },
          { path: 'b', content: 'new b' },
        ],
        {
          exists: async () => true,
          read: async (path) => `old ${path}`,
          write: writes,
          remove: vi.fn(),
        },
      ),
    ).rejects.toThrow(
      'Failed to save configuration (commit failed). Failed to restore original files: b: restore failed',
    )
    expect(writes).toHaveBeenLastCalledWith('a', 'old a')
  })

  it('serializes complete mutations through rollback and allows later changes after failure', async () => {
    const gate = Promise.withResolvers<void>()
    const order: string[] = []
    const first = withConfigMutation(async () => {
      order.push('first read')
      await gate.promise
      order.push('first rollback')
      throw new Error('failed')
    })
    const rejected = expect(first).rejects.toThrow('failed')
    const second = withConfigMutation(async () => {
      order.push('second read')
      return 'saved'
    })
    await Promise.resolve()
    expect(order).toEqual(['first read'])
    gate.resolve()
    await rejected
    await expect(second).resolves.toBe('saved')
    expect(order).toEqual(['first read', 'first rollback', 'second read'])
  })
})
