import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { writeFile, getSystemProxy, getProxyEndpoint } = vi.hoisted(() => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  getSystemProxy: vi.fn().mockResolvedValue(''),
  getProxyEndpoint: vi.fn(),
}))

vi.mock('@/bridge', () => ({
  FileExists: vi.fn(),
  RemoveFile: vi.fn(),
  ReadFile: vi.fn(),
  WriteFile: writeFile,
  Requests: vi.fn(),
  GetSystemProxy: getSystemProxy,
  ReadDir: vi.fn().mockResolvedValue([]),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/lang', () => ({
  default: {
    global: {
      t: (key: string) => key,
      locale: { value: 'en' },
      availableLocales: ['en'],
    },
  },
  loadLocale: vi.fn(),
}))

vi.mock('@/utils/env', () => ({
  APP_TITLE: 'GUI.for.SingBox',
  APP_VERSION: 'test-version',
  APP_VERSION_API: 'test-version-api',
  APP_LOCALES_URL: '',
  PROJECT_URL: '',
  TG_GROUP: '',
  TG_CHANNEL: '',
  isDev: false,
}))

vi.mock('@/stores/kernelApi', () => ({
  useKernelApiStore: () => ({
    getProxyEndpoint,
  }),
}))

vi.mock('@/stores/env', () => ({
  useEnvStore: () => ({
    env: {},
  }),
}))

import { FileExists, ReadFile, RemoveFile, Requests } from '@/bridge'
import { RequestMethod, RequestProxyMode } from '@/enums/app'
import { useAppSettingsStore } from '@/stores/appSettings'
import { useProfilesStore } from '@/stores/profiles'
import { useSubscribesStore } from '@/stores/subscribes'

import type { Subscription } from '@/types/app'

const subscription = (id: string): Subscription => ({
  id,
  name: id,
  upload: 0,
  download: 0,
  total: 0,
  expire: 0,
  updateTime: 0,
  type: 'Http',
  url: 'https://example.test/sub',
  website: '',
  decryptPassword: '',
  path: `data/subscribes/${id}.json`,
  include: '',
  exclude: '',
  includeProtocol: '',
  excludeProtocol: '',
  proxyPrefix: '',
  requestProxyMode: RequestProxyMode.System,
  customProxy: '',
  proxies: [],
  disabled: false,
  inSecure: false,
  requestMethod: RequestMethod.Get,
  requestTimeout: 60,
  header: { request: {}, response: {} },
  script: '',
})

import { parse } from 'yaml'

import { SubscribesFilePath, ProfilesFilePath, NodeGroupsFilePath } from '@/constant/app'
import { DefaultNodeGroup } from '@/constant/nodeGroup'
import { useNodeGroupsStore } from '@/stores/nodeGroups'
import { eventBus } from '@/utils/eventBus'
describe('configuration store transaction regressions', () => {
  beforeEach(() => {
    vi.mocked(FileExists).mockResolvedValue(false)
    vi.mocked(RemoveFile).mockResolvedValue('')
    setActivePinia(createPinia())
    writeFile.mockReset()
    vi.stubGlobal(
      'matchMedia',
      vi
        .fn()
        .mockReturnValue({
          matches: false,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }),
    )
  })
  const init = () => {
    const settings = useAppSettingsStore()
    settings.app.kernel.profile = 'p'
    const profiles = useProfilesStore()
    profiles.profiles = [
      {
        id: 'p',
        outbounds: [{ id: 'outbound-select', tag: 'select', type: 'selector', outbounds: [] }],
      },
    ] as any
    const store = useSubscribesStore()
    return { profiles, store }
  }
  it('add failure restores persisted metadata without changing profile references', async () => {
    const { profiles, store } = init()
    const disk = new Map<string, string>()
    disk.set(SubscribesFilePath, '[]')
    vi.mocked(FileExists).mockImplementation(async (path) => disk.has(path))
    vi.mocked(ReadFile).mockImplementation(async (path) => disk.get(path)!)
    vi.mocked(RemoveFile).mockImplementation(async (path) => {
      disk.delete(path)
      return ''
    })
    let failed = false
    writeFile.mockImplementation(async (path: string, value: string) => {
      if (path === ProfilesFilePath && !failed) {
        failed = true
        throw Error('disk full')
      }
      disk.set(path, value)
      return ''
    })
    await expect(store.addSubscribe(subscription('new'))).rejects.toThrow('disk full')
    expect(store.subscribes).toHaveLength(0)
    expect(parse(disk.get(SubscribesFilePath)!)).toHaveLength(0)
    expect(profiles.profiles[0]!.outbounds[0]!.outbounds).toHaveLength(0)
  })
  it('delete failure restores persisted subscription and preserves profile references', async () => {
    const { profiles, store } = init()
    store.subscribes = [subscription('s')]
    profiles.profiles[0]!.outbounds[0]!.outbounds = [{ id: 's', type: 'Subscription', tag: 's' }]
    const disk = new Map<string, string>()
    disk.set(SubscribesFilePath, JSON.stringify(store.subscribes))
    vi.mocked(FileExists).mockImplementation(async (path) => disk.has(path))
    vi.mocked(ReadFile).mockImplementation(async (path) => disk.get(path)!)
    vi.mocked(RemoveFile).mockImplementation(async (path) => {
      disk.delete(path)
      return ''
    })
    let failed = false
    writeFile.mockImplementation(async (path: string, value: string) => {
      if (path === ProfilesFilePath && !failed) {
        failed = true
        throw Error('disk full')
      }
      disk.set(path, value)
      return ''
    })
    await expect(store.deleteSubscribe('s')).rejects.toThrow('disk full')
    expect(store.subscribes).toHaveLength(1)
    expect(parse(disk.get(SubscribesFilePath)!)).toHaveLength(1)
    expect(profiles.profiles[0]!.outbounds[0]!.outbounds).toHaveLength(1)
  })
  it('failed cascade deletion restores profile references on disk', async () => {
    const { profiles } = init()
    const groups = useNodeGroupsStore()
    groups.nodeGroups = [{ ...DefaultNodeGroup(), id: 'g', name: 'G' }]
    profiles.profiles[0]!.outbounds[0]!.outbounds = [{ id: 'g', type: 'NodeGroup', tag: 'G' }]
    const disk = new Map<string, string>()
    disk.set(ProfilesFilePath, JSON.stringify(profiles.profiles))
    vi.mocked(FileExists).mockImplementation(async (path) => disk.has(path))
    vi.mocked(ReadFile).mockImplementation(async (path) => disk.get(path)!)
    vi.mocked(RemoveFile).mockImplementation(async (path) => {
      disk.delete(path)
      return ''
    })
    let failed = false
    writeFile.mockImplementation(async (path: string, value: string, options) => {
      if (
        options.Related.some((file: { path: string }) => file.path === NodeGroupsFilePath) &&
        !failed
      ) {
        failed = true
        throw Error('disk full')
      }
      disk.set(path, value)
      return ''
    })
    await expect(groups.deleteNodeGroup('g', { cascade: true })).rejects.toThrow('disk full')
    expect(groups.nodeGroups).toHaveLength(1)
    expect(profiles.profiles[0]!.outbounds[0]!.outbounds).toHaveLength(1)
    expect(parse(disk.get(ProfilesFilePath)!)[0].outbounds[0].outbounds).toHaveLength(1)
  })
  it('editing referenced node group emits a successful change event', async () => {
    const { profiles } = init()
    const groups = useNodeGroupsStore()
    const original = {
      ...DefaultNodeGroup(),
      id: 'g',
      name: 'G',
      mode: 'filter' as const,
      include: 'HK',
    }
    groups.nodeGroups = [original]
    profiles.profiles[0]!.outbounds[0]!.outbounds = [{ id: 'g', type: 'NodeGroup', tag: 'G' }]
    const emit = vi.spyOn(eventBus, 'emit')
    writeFile.mockResolvedValue('')
    await groups.editNodeGroup('g', { ...original, include: 'JP' })
    expect(groups.nodeGroups[0]!.include).toBe('JP')
    expect(emit).toHaveBeenCalledWith('nodeGroupChange', { id: 'g' })
    emit.mockRestore()
  })
  it('restores cache and leaves metadata unchanged after a failed refresh commit', async () => {
    const { store } = init()
    const s = store.getSubscribeTemplate('S')
    s.id = 's'
    s.path = 'cache.json'
    s.requestProxyMode = 'none'
    s.proxies = [{ id: 'old-id', tag: 'Old node', type: 'socks' }]
    store.subscribes = [s]
    const disk = new Map<string, string>([
      [
        s.path,
        JSON.stringify([
          { type: 'socks', tag: 'Old node', server: '192.0.2.1', server_port: 1080 },
        ]),
      ],
      [SubscribesFilePath, JSON.stringify(store.subscribes)],
    ])
    const before = new Map(disk)
    Object.assign(window, {
      AsyncFunction: Object.getPrototypeOf(async function () {}).constructor,
    })
    vi.mocked(FileExists).mockImplementation(async (path) => disk.has(path))
    vi.mocked(ReadFile).mockImplementation(async (path) => disk.get(path)!)
    vi.mocked(RemoveFile).mockImplementation(async (path) => {
      disk.delete(path)
      return ''
    })
    vi.mocked(Requests).mockResolvedValue({
      headers: {},
      body: JSON.stringify({
        outbounds: [{ type: 'socks', tag: 'New node', server: '192.0.2.1', server_port: 1080 }],
      }),
    } as any)
    let failed = false
    writeFile.mockImplementation(async (path: string, value: string) => {
      if (path === SubscribesFilePath && !failed) {
        failed = true
        throw Error('metadata failed')
      }
      disk.set(path, value)
      return ''
    })
    await expect(store.updateSubscribe('s')).rejects.toContain('metadata failed')
    expect(disk).toEqual(before)
    expect(store.subscribes[0]!.proxies).toEqual([{ id: 'old-id', tag: 'Old node', type: 'socks' }])
  })
  it('serializes concurrent adds so rollback cannot remove the next successful subscription', async () => {
    const { profiles, store } = init()
    let failed = false
    writeFile.mockImplementation(async (path: string) => {
      if (path === ProfilesFilePath && !failed) {
        failed = true
        throw Error('failed')
      }
      return ''
    })
    const first = store.addSubscribe(subscription('first'))
    const failure = expect(first).rejects.toThrow('failed')
    const second = store.addSubscribe(subscription('second'))
    await failure
    await second
    expect(store.subscribes.map((s) => s.id)).toEqual(['second'])
    expect(profiles.profiles[0]!.outbounds[0]!.outbounds.map((v) => v.id)).toEqual(['second'])
  })
  it('does not change a dynamic group or notify the core when adding a member fails', async () => {
    init()
    const groups = useNodeGroupsStore()
    groups.nodeGroups = [{ ...DefaultNodeGroup(), id: 'g', name: 'G', mode: 'filter' }]
    const emit = vi.spyOn(eventBus, 'emit')
    writeFile.mockRejectedValueOnce(Error('failed'))
    await expect(
      groups.addMember('g', { subscription_id: 's', node_id: 'n', last_known_tag: 'N' }),
    ).rejects.toThrow('failed')
    expect(groups.nodeGroups[0]!.mode).toBe('filter')
    expect(groups.nodeGroups[0]!.members).toEqual([])
    expect(emit).not.toHaveBeenCalled()
    emit.mockRestore()
  })

  it('clears the replacement subscription loading state when reloaded during download', async () => {
    const { store } = init()
    const s = store.getSubscribeTemplate('S')
    s.requestProxyMode = 'none'
    store.subscribes = [s]
    const disk = new Map<string, string>([
      [s.path, '[]'],
      [SubscribesFilePath, JSON.stringify([s])],
    ])
    vi.mocked(FileExists).mockImplementation(async (path) => disk.has(path))
    vi.mocked(ReadFile).mockImplementation(async (path) => disk.get(path)!)
    writeFile.mockImplementation(async (path: string, value: string) => {
      disk.set(path, value)
      return ''
    })
    Object.assign(window, {
      AsyncFunction: Object.getPrototypeOf(async function () {}).constructor,
    })
    const requested = Promise.withResolvers<void>()
    const response = Promise.withResolvers<any>()
    vi.mocked(Requests).mockImplementationOnce(async () => {
      requested.resolve()
      return response.promise
    })
    const update = store.updateSubscribe(s.id)
    await requested.promise
    await store.reloadFromDisk()
    response.resolve({
      headers: {},
      body: JSON.stringify({
        outbounds: [{ type: 'socks', tag: 'Node', server: '192.0.2.1', server_port: 1080 }],
      }),
    })
    await update
    expect(store.subscribes[0]!.updating).toBe(false)
    expect(store.subscribes[0]!.proxies[0]!.tag).toBe('Node')
  })
  it('rejects stale downloaded content if the subscription is edited while downloading', async () => {
    const { store } = init()
    const s = store.getSubscribeTemplate('S')
    s.requestProxyMode = 'none'
    store.subscribes = [s]
    const disk = new Map<string, string>([
      [s.path, '[]'],
      [SubscribesFilePath, JSON.stringify([s])],
    ])
    vi.mocked(FileExists).mockImplementation(async (path) => disk.has(path))
    vi.mocked(ReadFile).mockImplementation(async (path) => disk.get(path)!)
    writeFile.mockImplementation(async (path: string, value: string) => {
      disk.set(path, value)
      return ''
    })
    Object.assign(window, {
      AsyncFunction: Object.getPrototypeOf(async function () {}).constructor,
    })
    const requested = Promise.withResolvers<void>()
    const response = Promise.withResolvers<any>()
    vi.mocked(Requests).mockImplementationOnce(async () => {
      requested.resolve()
      return response.promise
    })
    const update = store.updateSubscribe(s.id)
    const rejected = expect(update).rejects.toContain('changed while updating')
    await requested.promise
    await store.editSubscribe(s.id, { ...s, name: 'Edited during download' })
    response.resolve({
      headers: {},
      body: JSON.stringify({
        outbounds: [{ type: 'socks', tag: 'Node', server: '192.0.2.1', server_port: 1080 }],
      }),
    })
    await rejected
    expect(store.subscribes[0]!.name).toBe('Edited during download')
    expect(disk.get(s.path)).toBe('[]')
  })
  it('stale profiles in a second client cannot overwrite a successful addition', async () => {
    const { default: sha256 } = await import('crypto-js/sha256')
    vi.mocked(FileExists).mockResolvedValue(true)
    const clientA = useProfilesStore(createPinia())
    const clientB = useProfilesStore(createPinia())
    const p = (id: string) => ({ ...clientA.getProfileTemplate(id), id })
    let disk = JSON.stringify([p('base')])
    vi.mocked(ReadFile).mockImplementation(async () => disk)
    writeFile.mockImplementation(async (_path, content, opts) => {
      if (opts.ExpectedSHA256 !== sha256(disk).toString()) throw new Error('conflict')
      disk = content
    })
    await clientA.setupProfiles()
    await clientB.setupProfiles()
    await clientA.addProfile(p('alpha'))
    expect(parse(disk).map((p: App.Profile) => p.id)).toEqual(['base', 'alpha'])
    await expect(clientB.editProfile('base', { ...p('base'), name: 'edited' })).rejects.toThrow(
      'conflict',
    )
    expect(parse(disk).map((p: App.Profile) => p.id)).toEqual(['base', 'alpha'])
  })
  it('initializes both pages when they concurrently create the same default settings', async () => {
    const first = useAppSettingsStore(createPinia())
    const second = useAppSettingsStore(createPinia())
    let disk: string | undefined
    writeFile.mockImplementation(async (_path, content, options) => {
      expect(options.ExpectedSHA256).toBe('missing')
      if (disk !== undefined) throw new Error('already created')
      disk = content
    })
    vi.mocked(ReadFile).mockImplementation(async () => disk!)
    await Promise.all([first.setupAppSettings(), second.setupAppSettings()])
    expect(writeFile).toHaveBeenCalledTimes(2)
    expect(first.app).toEqual(second.app)
  })
  it('persists the final switch value after a quick undo', async () => {
    const { nextTick } = await import('vue')
    vi.useFakeTimers()
    try {
      vi.mocked(FileExists).mockResolvedValue(true)
      vi.mocked(ReadFile).mockResolvedValue('autoStartKernel: false')
      const store = useAppSettingsStore()
      await store.setupAppSettings()
      await nextTick()
      writeFile.mockClear()
      store.app.autoStartKernel = true
      await nextTick()
      store.app.autoStartKernel = false
      await nextTick()
      await Promise.resolve()
      store.app.autoStartKernel = true
      await nextTick()
      await vi.advanceTimersByTimeAsync(600)
      expect(store.app.autoStartKernel).toBe(true)
      expect(parse(writeFile.mock.calls.at(-1)![1]).autoStartKernel).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('one transient settings read error preserves existing user.yaml', async () => {
    vi.mocked(FileExists).mockResolvedValue(true)
    let disk = JSON.stringify({
      kernel: { profile: 'existing-profile' },
      githubApiToken: 'test-only',
    })
    vi.mocked(ReadFile).mockImplementation(async (path) => {
      if (path === 'data/user.yaml') throw new Error('Transient RPC read error')
      return ''
    })
    writeFile.mockImplementation(async (path, content) => {
      if (path === 'data/user.yaml') disk = content
    })
    await expect(useAppSettingsStore().setupAppSettings()).rejects.toThrow(
      'Transient RPC read error',
    )
    expect(parse(disk).kernel.profile).toBe('existing-profile')
    expect(writeFile).not.toHaveBeenCalled()
  })
})
