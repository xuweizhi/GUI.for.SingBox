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
