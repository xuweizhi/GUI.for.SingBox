import { FileExists, ReadFile, RemoveFile, WriteFile } from '@/bridge'

import { writeFilesWithRollback, type ConfigFileWrite } from './fileTransaction'

let pending: Promise<unknown> = Promise.resolve()

/** Serialize complete configuration mutations, including their disk rollback and publication. */
export const withConfigMutation = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = pending.then(operation, operation)
  pending = result.catch(() => undefined)
  return result
}

/** Must be called inside withConfigMutation; does not recursively acquire the lock. */
export const persistConfigFiles = (files: ConfigFileWrite[]) =>
  writeFilesWithRollback(files, {
    exists: FileExists,
    read: ReadFile,
    write: WriteFile,
    remove: RemoveFile,
  })
