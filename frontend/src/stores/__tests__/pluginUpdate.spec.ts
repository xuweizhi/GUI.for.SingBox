import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
const mocks = vi.hoisted(() => ({
  files: new Map<string, string>(),
  failPath: '',
  http: vi.fn(),
  app: { pluginSettings: {} as Record<string, any> },
}))
vi.mock('@/bridge', () => ({
  HttpGet: mocks.http,
  Requests: vi.fn(),
  FileExists: vi.fn(async (path: string) => mocks.files.has(path)),
  ReadFile: vi.fn(async (path: string) => {
    if (!mocks.files.has(path)) throw new Error('missing')
    return mocks.files.get(path)!
  }),
  WriteFile: vi.fn(async (path: string, content: string) => {
    if (mocks.failPath === path) {
      mocks.failPath = ''
      throw new Error('disk full')
    }
    mocks.files.set(path, content)
  }),
  RemoveFile: vi.fn(async (path: string) => mocks.files.delete(path)),
}))
vi.mock('@/stores', () => ({ useAppSettingsStore: () => ({ app: mocks.app }) }))
vi.mock('@/utils', () => ({
  ignoredError: async (fn: (...args: any[]) => any, ...args: any[]) => {
    try {
      return await fn(...args)
    } catch {
      return undefined
    }
  },
  isNumber: (value: unknown) => typeof value === 'number',
  omitArray: (items: any[], keys: string[]) =>
    items.map((item) =>
      Object.fromEntries(Object.entries(item).filter(([key]) => !keys.includes(key))),
    ),
  deepClone: (value: unknown) => JSON.parse(JSON.stringify(value)),
  confirm: vi.fn(),
  asyncPool: vi.fn(),
  stringifyNoFolding: JSON.stringify,
  readonly: (value: unknown) => value,
  base64Encode: (value: string) => btoa(value),
}))
import { PluginsFilePath } from '@/constant/app'

import { usePluginsStore } from '../plugins'
const configuration = (key: string, value: unknown): App.PluginConfiguration => ({
  id: key,
  title: key,
  description: '',
  key,
  value,
  component: 'Input',
  options: [],
})
const makePlugin = (): App.Plugin =>
  ({
    id: 'plugin-example',
    name: 'Example',
    description: '',
    tags: [],
    group: '',
    version: 'v1.0.0',
    type: 'Http',
    path: 'data/plugins/example.js',
    url: 'https://invalid.example/plugin.js',
    configuration: [configuration('saved', 'default')],
    triggers: [],
    menus: {},
    context: { profiles: {}, subscriptions: {}, rulesets: {}, plugins: {}, scheduledtasks: {} },
    disabled: true,
    status: 7,
    hasUI: false,
  }) as App.Plugin
const oldCode = 'export const version = 1'
const newCode = 'export const version = 2'
beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.failPath = ''
  mocks.files.clear()
  mocks.files.set(makePlugin().path, oldCode)
  mocks.files.set(PluginsFilePath, JSON.stringify([makePlugin()]))
  mocks.app.pluginSettings = { 'plugin-example': { saved: 'custom', unknown: 42 } }
  mocks.http.mockResolvedValue({ status: 200, body: newCode })
})

describe('atomic plugin update', () => {
  it.each(['v1.0.1', 'v2.0.0'])(
    'keeps version/source/settings after %s download failure',
    async (version) => {
      mocks.http.mockRejectedValue(new Error('network failed'))
      const store = usePluginsStore()
      store.plugins.push(makePlugin())
      store.pluginHub.push({
        ...makePlugin(),
        version,
        disabled: false,
        status: 0,
        configuration: [],
      })
      await expect(store.updatePlugin('plugin-example')).rejects.toThrow('network failed')
      expect(store.plugins[0]?.version).toBe('v1.0.0')
      expect(store.hasNewPluginVersion(store.plugins[0]!)).toBe(true)
      expect(mocks.files.get(makePlugin().path)).toBe(oldCode)
      expect(mocks.app.pluginSettings['plugin-example']).toEqual({ saved: 'custom', unknown: 42 })
      expect(store.plugins[0]?.disabled).toBe(true)
    },
  )

  it('rolls source back if writing installed metadata fails', async () => {
    const store = usePluginsStore()
    store.plugins.push(makePlugin())
    store.pluginHub.push({ ...makePlugin(), version: 'v2.0.0' })
    mocks.failPath = PluginsFilePath
    await expect(store.updatePlugin('plugin-example')).rejects.toThrow('disk full')
    expect(mocks.files.get(makePlugin().path)).toBe(oldCode)
    expect(parse(mocks.files.get(PluginsFilePath)!)[0].version).toBe('v1.0.0')
    expect(store.plugins[0]?.version).toBe('v1.0.0')
    expect(mocks.app.pluginSettings['plugin-example']).toEqual({ saved: 'custom', unknown: 42 })
  })

  it('commits new source and major metadata while preserving user state', async () => {
    const store = usePluginsStore()
    store.plugins.push(makePlugin())
    store.pluginHub.push({
      ...makePlugin(),
      version: 'v2.0.0',
      disabled: false,
      status: 0,
      configuration: [configuration('added', 'new default'), configuration('saved', false)],
    } as App.Plugin)
    await store.updatePlugin('plugin-example')
    expect(store.plugins[0]).toMatchObject({
      version: 'v2.0.0',
      disabled: true,
      status: 7,
      updating: false,
    })
    expect(parse(mocks.files.get(PluginsFilePath)!)[0]).toMatchObject({
      version: 'v2.0.0',
      disabled: true,
      status: 7,
    })
    expect(mocks.files.get(makePlugin().path)).toBe(newCode)
    expect(store.getPluginCodefromCache('plugin-example')).toBe(newCode)
    expect(store.getPluginMetadata('plugin-example')).toMatchObject({
      saved: false,
      unknown: 42,
      added: 'new default',
    })
    expect(store.pluginHub[0]).not.toHaveProperty('updating')
  })
})

it('does not overwrite a plugin edited while its update downloads', async () => {
  let finish!: (value: { status: number; body: string }) => void
  mocks.http.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const store = usePluginsStore()
  store.plugins.push(makePlugin())
  store.pluginHub.push({ ...makePlugin(), version: 'v1.0.1' })
  const update = store.updatePlugin('plugin-example')
  await store.editPlugin('plugin-example', { ...makePlugin(), name: 'Edited locally' })
  finish({ status: 200, body: newCode })
  await expect(update).rejects.toThrow('Plugin changed during update')
  expect(store.plugins[0]?.name).toBe('Edited locally')
  expect(mocks.files.get(makePlugin().path)).toBe(oldCode)
})

it('keeps local metadata on disk-save failure and refreshes a later backend update', async () => {
  const store = usePluginsStore()
  store.plugins.push(makePlugin())
  mocks.failPath = PluginsFilePath
  await expect(
    store.editPlugin('plugin-example', { ...makePlugin(), name: 'Unsaved' }),
  ).rejects.toThrow('disk full')
  expect(store.plugins[0]?.name).toBe('Example')
  mocks.files.set(PluginsFilePath, JSON.stringify([{ ...makePlugin(), version: 'v2.0.0' }]))
  mocks.files.set(makePlugin().path, newCode)
  await store.reloadFromDisk()
  expect(store.plugins[0]?.version).toBe('v2.0.0')
  expect(store.getPluginCodefromCache('plugin-example')).toBe(newCode)
})
