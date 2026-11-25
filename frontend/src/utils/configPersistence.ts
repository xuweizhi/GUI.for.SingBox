import { parse } from 'yaml'

import { AbsolutePath, FileExists, ReadFile, RemoveFile, WriteFile } from '@/bridge'

import { writeFilesWithRollback, type ConfigFileWrite } from './fileTransaction'

export const parseResourceList = <T>(data?: string): T[] => {
  const items = data ? parse(data) : null
  if (items == null) return []
  if (!Array.isArray(items)) throw new Error('Resource file must contain an array')
  return items
}

let pending: Promise<unknown> = Promise.resolve()

/** Serialize complete configuration mutations, including their disk rollback and publication. */
export const withConfigMutation = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = pending.then(operation, operation)
  pending = result.catch(() => undefined)
  return result
}

type CachedResource = Pick<App.Subscription | App.RuleSet, 'type' | 'url' | 'path'>

/** Remove an unreferenced cache only after committing the resource deletion. */
export async function removeUnusedResourceCache(
  resource: CachedResource,
  remaining: CachedResource[],
) {
  const paths = remaining.flatMap((item) =>
    item.type === 'File' ? [item.path, item.url] : [item.path],
  )
  if (resource.type === 'File') paths.push(resource.url)
  if (paths.includes(resource.path)) return
  const candidate = await AbsolutePath(resource.path)
  const references = await Promise.all([...new Set(paths.filter(Boolean))].map(AbsolutePath))
  if (!references.some((path) => path.toLowerCase() === candidate.toLowerCase())) {
    await RemoveFile(resource.path)
  }
}

/** Must be called inside withConfigMutation; does not recursively acquire the lock. */
export const persistConfigFiles = (files: ConfigFileWrite[]) =>
  writeFilesWithRollback(files, {
    exists: FileExists,
    read: ReadFile,
    write: WriteFile,
    remove: RemoveFile,
  })
