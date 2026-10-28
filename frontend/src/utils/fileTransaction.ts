export type FileTransactionOps = {
  exists: (path: string) => Promise<boolean>
  move: (source: string, target: string) => Promise<unknown>
  remove: (path: string) => Promise<unknown>
}

type ReplaceFileOptions = {
  activePath: string
  replacementPath: string
  backupPath: string
}

const errorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Replaces an active file only after its replacement is ready. If committing the
 * replacement fails, the previous active file is restored before the error is
 * returned to the caller.
 */
export const replaceFileWithRollback = async (
  { activePath, replacementPath, backupPath }: ReplaceFileOptions,
  ops: FileTransactionOps,
) => {
  const hadActiveFile = await ops.exists(activePath)
  if (hadActiveFile) {
    await ops.remove(backupPath)
    await ops.move(activePath, backupPath)
  }

  try {
    await ops.move(replacementPath, activePath)
  } catch (commitError) {
    if (hadActiveFile) {
      try {
        await ops.remove(activePath)
        await ops.move(backupPath, activePath)
      } catch (rollbackError) {
        throw new Error(
          `Failed to install replacement (${errorMessage(commitError)}) and restore backup (${errorMessage(rollbackError)})`,
        )
      }
    }
    throw commitError
  }
}

export type ConfigFileWrite = { path: string; content: string }
export type ConfigFileOps = {
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  write: (path: string, content: string) => Promise<unknown>
  remove: (path: string) => Promise<unknown>
}

/** The bridge writes each individual file atomically. Restore original disk contents
 * if any file in a related update fails; callers serialize the complete read/modify/write. */
export const writeFilesWithRollback = async (files: ConfigFileWrite[], ops: ConfigFileOps) => {
  const paths = new Set<string>()
  const snapshots: Array<{ path: string; content?: string }> = []
  for (const file of files) {
    if (paths.has(file.path)) throw new Error(`Duplicate transaction path: ${file.path}`)
    paths.add(file.path)
    const exists = await ops.exists(file.path)
    snapshots.push({ path: file.path, ...(exists ? { content: await ops.read(file.path) } : {}) })
  }
  let attempted = 0
  try {
    for (const file of files) {
      attempted++
      await ops.write(file.path, file.content)
    }
  } catch (error) {
    const rollbackErrors: string[] = []
    for (const snapshot of snapshots.slice(0, attempted).reverse()) {
      try {
        if (snapshot.content === undefined) await ops.remove(snapshot.path)
        else await ops.write(snapshot.path, snapshot.content)
      } catch (rollbackError) {
        rollbackErrors.push(`${snapshot.path}: ${errorMessage(rollbackError)}`)
      }
    }
    if (rollbackErrors.length) {
      throw new Error(
        `Failed to save configuration (${errorMessage(error)}). Failed to restore original files: ${rollbackErrors.join('; ')}`,
        { cause: error },
      )
    }
    throw error
  }
}
