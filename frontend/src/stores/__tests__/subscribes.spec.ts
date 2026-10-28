import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { writeFile, getSystemProxy, getProxyEndpoint } = vi.hoisted(() => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  getSystemProxy: vi.fn().mockResolvedValue(''),
  getProxyEndpoint: vi.fn(),
}))

vi.mock('@/bridge', () => ({
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

import { ReadFile, Requests } from '@/bridge'
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

describe('subscribes store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.assign(window, {
      AsyncFunction: Object.getPrototypeOf(async function () {}).constructor,
    })
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    )
    writeFile.mockClear()
    vi.mocked(ReadFile).mockReset()
    getSystemProxy.mockReset()
    getSystemProxy.mockResolvedValue('')
    getProxyEndpoint.mockReset()
  })

  it('adds a new subscription to the default selector and urltest groups', async () => {
    const appSettingsStore = useAppSettingsStore()
    const profilesStore = useProfilesStore()
    const subscribesStore = useSubscribesStore()
    const profile = {
      id: 'profile-id',
      outbounds: [
        {
          id: 'outbound-select',
          tag: '🚀 节点选择',
          type: 'selector',
          outbounds: [{ id: 'outbound-urltest', type: 'Built-in', tag: '🎈 自动选择' }],
        },
        {
          id: 'outbound-urltest',
          tag: '🎈 自动选择',
          type: 'urltest',
          outbounds: [],
        },
      ],
    } as IProfile
    profilesStore.profiles = [profile]
    appSettingsStore.app.kernel.profile = profile.id

    await subscribesStore.addSubscribe(subscription('sub-id'))

    expect(profile.outbounds[0]!.outbounds).toContainEqual({
      id: 'sub-id',
      tag: 'sub-id',
      type: 'Subscription',
    })
    expect(profile.outbounds[1]!.outbounds).toContainEqual({
      id: 'sub-id',
      tag: 'sub-id',
      type: 'Subscription',
    })
  })

  it('does not duplicate an existing subscription reference in default groups', async () => {
    const appSettingsStore = useAppSettingsStore()
    const profilesStore = useProfilesStore()
    const subscribesStore = useSubscribesStore()
    const existingRef = { id: 'sub-id', tag: 'sub-id', type: 'Subscription' as const }
    const profile = {
      id: 'profile-id',
      outbounds: [
        {
          id: 'outbound-select',
          tag: '🚀 节点选择',
          type: 'selector',
          outbounds: [{ ...existingRef }],
        },
        {
          id: 'outbound-urltest',
          tag: '🎈 自动选择',
          type: 'urltest',
          outbounds: [{ ...existingRef }],
        },
      ],
    } as IProfile
    profilesStore.profiles = [profile]
    appSettingsStore.app.kernel.profile = profile.id

    await subscribesStore.addSubscribe(subscription('sub-id'))

    expect(profile.outbounds[0]!.outbounds).toHaveLength(1)
    expect(profile.outbounds[1]!.outbounds).toHaveLength(1)
  })

  it('removes a deleted subscription reference from every profile outbound group', async () => {
    const profilesStore = useProfilesStore()
    const subscribesStore = useSubscribesStore()
    const deletedRef = { id: 'sub-id', tag: 'sub-id', type: 'Subscription' as const }
    const keptRef = { id: 'other-sub-id', tag: 'other-sub-id', type: 'Subscription' as const }
    const firstProfile = {
      id: 'profile-1',
      outbounds: [
        {
          id: 'outbound-select',
          tag: '🚀 节点选择',
          type: 'selector',
          outbounds: [{ ...deletedRef }, { ...keptRef }],
        },
        {
          id: 'custom-urltest',
          tag: 'Custom Auto',
          type: 'urltest',
          outbounds: [{ ...deletedRef }],
        },
      ],
    } as IProfile
    const secondProfile = {
      id: 'profile-2',
      outbounds: [
        {
          id: 'custom-selector',
          tag: 'Custom Select',
          type: 'selector',
          outbounds: [{ ...deletedRef }],
        },
      ],
    } as IProfile
    profilesStore.profiles = [firstProfile, secondProfile]
    subscribesStore.subscribes = [subscription('sub-id'), subscription('other-sub-id')]

    await subscribesStore.deleteSubscribe('sub-id')

    expect(firstProfile.outbounds[0]!.outbounds).toEqual([{ ...keptRef }])
    expect(firstProfile.outbounds[1]!.outbounds).toEqual([])
    expect(secondProfile.outbounds[0]!.outbounds).toEqual([])
    expect(subscribesStore.getSubscribeById('sub-id')).toBeUndefined()
  })

  it('syncs current profile defaults and removes stale references from all profiles', async () => {
    const appSettingsStore = useAppSettingsStore()
    const profilesStore = useProfilesStore()
    const subscribesStore = useSubscribesStore()
    const staleRef = { id: 'stale-sub-id', tag: 'stale-sub-id', type: 'Subscription' as const }
    const firstProfile = {
      id: 'profile-1',
      outbounds: [
        {
          id: 'outbound-select',
          tag: '🚀 节点选择',
          type: 'selector',
          outbounds: [{ ...staleRef }],
        },
        {
          id: 'outbound-urltest',
          tag: '🎈 自动选择',
          type: 'urltest',
          outbounds: [],
        },
      ],
    } as IProfile
    const secondProfile = {
      id: 'profile-2',
      outbounds: [
        {
          id: 'outbound-select',
          tag: 'Another Select',
          type: 'selector',
          outbounds: [{ ...staleRef }],
        },
        {
          id: 'outbound-urltest',
          tag: 'Another Auto',
          type: 'urltest',
          outbounds: [],
        },
      ],
    } as IProfile
    profilesStore.profiles = [firstProfile, secondProfile]
    appSettingsStore.app.kernel.profile = firstProfile.id
    subscribesStore.subscribes = [subscription('sub-id'), subscription('other-sub-id')]

    await subscribesStore.syncSubscribeOutboundRefs()

    expect(firstProfile.outbounds[0]!.outbounds).toEqual([
      { id: 'sub-id', tag: 'sub-id', type: 'Subscription' },
      { id: 'other-sub-id', tag: 'other-sub-id', type: 'Subscription' },
    ])
    expect(firstProfile.outbounds[1]!.outbounds).toEqual([
      { id: 'sub-id', tag: 'sub-id', type: 'Subscription' },
      { id: 'other-sub-id', tag: 'other-sub-id', type: 'Subscription' },
    ])
    expect(secondProfile.outbounds[0]!.outbounds).toEqual([])
    expect(secondProfile.outbounds[1]!.outbounds).toEqual([])
  })

  it('updates share-link subscriptions without requiring the node-convert plugin', async () => {
    const subscribesStore = useSubscribesStore()
    subscribesStore.subscribes = [subscription('sub-share-link')].map((item) => ({
      ...item,
      script: 'const onSubscribe = async (proxies, subscription) => ({ proxies, subscription })',
    }))

    vi.mocked(Requests).mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: 'ss://YWVzLTEyOC1nY206cGFzc3dvcmRAZXhhbXBsZS5jb206ODM4OA==#ss-node',
    } as Awaited<ReturnType<typeof Requests>>)

    await expect(subscribesStore.updateSubscribe('sub-share-link')).resolves.toBe(
      'Subscription [sub-share-link] updated successfully.',
    )

    expect(subscribesStore.subscribes[0]?.proxies).toEqual([
      expect.objectContaining({
        tag: 'ss-node',
        type: 'shadowsocks',
      }),
    ])
  })

  it('keeps a proxy id when a subscription renames the same endpoint', async () => {
    const subscribesStore = useSubscribesStore()
    subscribesStore.subscribes = [subscription('sub-stable-id')].map((item) => ({
      ...item,
      proxies: [{ id: 'stable-node-id', tag: 'old-name', type: 'vmess' }],
      script: 'const onSubscribe = async (proxies, subscription) => ({ proxies, subscription })',
    }))
    vi.mocked(ReadFile).mockResolvedValueOnce(
      JSON.stringify([
        { tag: 'old-name', type: 'vmess', server: 'node.example', server_port: 443, uuid: 'old' },
      ]),
    )
    vi.mocked(Requests).mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: JSON.stringify({
        outbounds: [
          { tag: 'new-name', type: 'vmess', server: 'node.example', server_port: 443, uuid: 'new' },
        ],
      }),
    } as Awaited<ReturnType<typeof Requests>>)

    await subscribesStore.updateSubscribe('sub-stable-id')

    expect(subscribesStore.subscribes[0]?.proxies).toEqual([
      { id: 'stable-node-id', tag: 'new-name', type: 'vmess' },
    ])
  })

  it('falls back to the kernel proxy in webui when a subscription uses system mode but no system proxy is available', async () => {
    const appSettingsStore = useAppSettingsStore()
    const subscribesStore = useSubscribesStore()
    appSettingsStore.app.requestProxyMode = RequestProxyMode.Kernel
    getProxyEndpoint.mockReturnValue({
      schema: 'http',
      host: '127.0.0.1',
      port: 20122,
      username: '',
      password: '',
      proxyType: 'mixed',
    })
    subscribesStore.subscribes = [subscription('sub-webui-system-fallback')].map((item) => ({
      ...item,
      script: 'const onSubscribe = async (proxies, subscription) => ({ proxies, subscription })',
    }))

    vi.mocked(Requests).mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: '{"outbounds":[{"tag":"node-a","type":"vmess"}]}',
    } as Awaited<ReturnType<typeof Requests>>)

    await expect(subscribesStore.updateSubscribe('sub-webui-system-fallback')).resolves.toBe(
      'Subscription [sub-webui-system-fallback] updated successfully.',
    )

    expect(Requests).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          Proxy: 'http://127.0.0.1:20122',
        }),
      }),
    )
  })

  it('keeps failed subscription update results in bulk updates', async () => {
    const subscribesStore = useSubscribesStore()
    subscribesStore.subscribes = [subscription('sub-ok'), subscription('sub-fail')].map((item) => ({
      ...item,
      script: 'const onSubscribe = async (proxies, subscription) => ({ proxies, subscription })',
    }))

    vi.mocked(Requests)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: '{"outbounds":[{"tag":"node-a","type":"vmess"}]}',
      } as Awaited<ReturnType<typeof Requests>>)
      .mockRejectedValueOnce(new Error('network down'))

    const result = await subscribesStore.updateSubscribes()

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ok: true,
          id: 'sub-ok',
          result: 'Subscription [sub-ok] updated successfully.',
        }),
        expect.objectContaining({
          ok: false,
          id: 'sub-fail',
          result: 'Failed to update subscription [sub-fail]. Reason: network down',
        }),
      ]),
    )
  })

  it('throws the failed results when bulk updates request strict handling', async () => {
    const subscribesStore = useSubscribesStore()
    subscribesStore.subscribes = [subscription('sub-ok'), subscription('sub-fail')].map((item) => ({
      ...item,
      script: 'const onSubscribe = async (proxies, subscription) => ({ proxies, subscription })',
    }))

    vi.mocked(Requests)
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: '{"outbounds":[{"tag":"node-a","type":"vmess"}]}',
      } as Awaited<ReturnType<typeof Requests>>)
      .mockRejectedValueOnce(new Error('network down'))

    await expect(subscribesStore.updateSubscribes({ throwOnFailure: true })).rejects.toThrowError(
      'Failed to update subscription [sub-fail]. Reason: network down',
    )
  })
  it('persists mixed endpoint fields and imported DNS while preserving manual DNS overrides', async () => {
    const store = useSubscribesStore()
    const item = {
      ...subscription('endpoint-dns'),
      preferOutboundDns: true,
      outboundDns: ['https://manual.example/dns-query'],
      script: 'const onSubscribe = async (proxies, subscription) => ({ proxies, subscription })',
    }
    store.subscribes = [item]
    const endpoint = {
      type: 'wireguard',
      tag: 'WG',
      private_key: 'private',
      peers: [{ address: 'wg.example', port: 51820, public_key: 'public', reserved: [1, 2, 3] }],
      mtu: 1420,
    }
    vi.mocked(Requests).mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: JSON.stringify({
        outbounds: [
          { type: 'vless', tag: 'VLESS', server: 'node.example', domain_resolver: 'provider' },
        ],
        endpoints: [endpoint],
        dns: {
          servers: [{ type: 'tls', tag: 'provider', server: '1.1.1.1' }],
          final: 'provider',
          rules: [{ domain: ['web.example'], server: 'provider' }],
        },
      }),
    } as Awaited<ReturnType<typeof Requests>>)
    await store.updateSubscribe(item.id)
    const result = store.subscribes[0]!
    expect(result.preferOutboundDns).toBe(true)
    expect(result.outboundDns).toEqual(item.outboundDns)
    expect(result.importedDns).toEqual({
      servers: [{ type: 'tls', tag: 'provider', server: '1.1.1.1' }],
      resolver: 'provider',
    })
    expect(result.proxies).toContainEqual(
      expect.objectContaining({ type: 'wireguard', kind: 'endpoint', tag: 'WG' }),
    )
    const cached = JSON.parse(writeFile.mock.calls.find(([path]) => path === item.path)![1])
    expect(cached).toContainEqual({ ...endpoint, _gui_kind: 'endpoint' })
    expect(cached[0].domain_resolver).toBe('provider')
  })

  it('refreshes endpoint identities across name and credential changes and clears stale imported DNS', async () => {
    const store = useSubscribesStore()
    const previous = {
      type: 'wireguard',
      tag: 'old',
      _gui_kind: 'endpoint',
      private_key: 'old-key',
      peers: [{ address: 'wg.example', port: 51820, public_key: 'old-public' }],
    }
    const item: Subscription = {
      ...subscription('endpoint-refresh'),
      preferOutboundDns: true,
      outboundDns: ['1.1.1.1'],
      importedDns: { servers: [{ type: 'local', tag: 'stale' }], resolver: 'stale' },
      proxies: [{ id: 'stable', tag: 'old', type: 'wireguard', kind: 'endpoint' }],
      script: 'const onSubscribe = async (proxies, subscription) => ({ proxies, subscription })',
    }
    store.subscribes = [item]
    vi.mocked(ReadFile).mockResolvedValueOnce(JSON.stringify([previous]))
    vi.mocked(Requests).mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: JSON.stringify({
        endpoints: [
          {
            ...previous,
            tag: 'new',
            private_key: 'rotated',
            peers: [{ address: 'wg.example', port: 51820, public_key: 'rotated-public' }],
          },
        ],
      }),
    } as Awaited<ReturnType<typeof Requests>>)
    await store.updateSubscribe(item.id)
    expect(store.subscribes[0]!.proxies).toEqual([
      { id: 'stable', tag: 'new', type: 'wireguard', kind: 'endpoint' },
    ])
    expect(store.subscribes[0]!.importedDns).toBeUndefined()
    expect(store.subscribes[0]!.outboundDns).toEqual(['1.1.1.1'])
  })

  it('keeps cached manual subscription DNS across refreshes', async () => {
    const store = useSubscribesStore()
    const item: Subscription = {
      ...subscription('manual-dns'),
      type: 'Manual',
      importedDns: { servers: [{ type: 'local', tag: 'provider' }], resolver: 'provider' },
      script: 'const onSubscribe = async (proxies, subscription) => ({ proxies, subscription })',
    }
    store.subscribes = [item]
    vi.mocked(ReadFile).mockResolvedValue(
      JSON.stringify([
        {
          type: 'tailscale',
          tag: 'TS',
          _gui_kind: 'endpoint',
          auth_key: 'secret',
          state_directory: 'data/ts',
        },
      ]),
    )
    await store.updateSubscribe(item.id)
    expect(store.subscribes[0]!.importedDns).toEqual(item.importedDns)
    expect(store.subscribes[0]!.proxies[0]!.kind).toBe('endpoint')
  })

  it('preserves the previous subscription and cache when endpoint validation fails', async () => {
    const store = useSubscribesStore()
    const item: Subscription = {
      ...subscription('bad-endpoint'),
      proxies: [{ id: 'old', tag: 'old', type: 'socks' }],
      importedDns: { servers: [{ type: 'local', tag: 'old' }] },
    }
    store.subscribes = [item]
    vi.mocked(Requests).mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: JSON.stringify({ endpoints: [null] }),
    } as Awaited<ReturnType<typeof Requests>>)
    await expect(store.updateSubscribe(item.id)).rejects.toContain('must have a protocol type')
    expect(store.subscribes[0]!.proxies).toEqual(item.proxies)
    expect(store.subscribes[0]!.importedDns).toEqual(item.importedDns)
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('prefixes node graph references and imported DNS detours together with their tags', async () => {
    const store = useSubscribesStore()
    const item = {
      ...subscription('prefixed'),
      proxyPrefix: 'Provider / ',
      script: 'const onSubscribe = async (proxies, subscription) => ({ proxies, subscription })',
    }
    store.subscribes = [item]
    vi.mocked(Requests).mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: JSON.stringify({
        outbounds: [
          { type: 'socks', tag: 'entry', server: '1.2.3.4' },
          { type: 'trojan', tag: 'exit', detour: 'entry' },
          { type: 'selector', tag: 'choose', outbounds: ['entry', 'exit'], default: 'entry' },
        ],
        dns: { servers: [{ type: 'tls', tag: 'resolver', server: '1.1.1.1', detour: 'entry' }] },
      }),
    } as Awaited<ReturnType<typeof Requests>>)
    await store.updateSubscribe(item.id)
    const cache = JSON.parse(writeFile.mock.calls.find(([path]) => path === item.path)![1])
    expect(cache[1]).toMatchObject({ tag: 'Provider / exit', detour: 'Provider / entry' })
    expect(cache[2]).toMatchObject({
      tag: 'Provider / choose',
      default: 'Provider / entry',
      outbounds: ['Provider / entry', 'Provider / exit'],
    })
    expect(store.subscribes[0]!.importedDns!.servers[0]!.detour).toBe('Provider / entry')
  })
  it('reloads edited file-backed flat endpoint caches while preserving discovered DNS', async () => {
    const store = useSubscribesStore()
    const item: Subscription = {
      ...subscription('same-file'),
      type: 'File',
      url: 'data/subscribes/same-file.json',
      importedDns: { servers: [{ type: 'local', tag: 'provider' }], resolver: 'provider' },
      script: 'const onSubscribe = async (proxies, subscription) => ({ proxies, subscription })',
    }
    store.subscribes = [item]
    const endpoint = {
      type: 'tailscale',
      tag: 'TS',
      _gui_kind: 'endpoint',
      state_directory: 'data/ts',
    }
    vi.mocked(ReadFile).mockResolvedValue(JSON.stringify([endpoint]))
    await store.updateSubscribe(item.id)
    expect(store.subscribes[0]!.importedDns).toEqual(item.importedDns)
    expect(store.subscribes[0]!.proxies[0]).toMatchObject({
      type: 'tailscale',
      tag: 'TS',
      kind: 'endpoint',
    })
    expect(writeFile.mock.calls.some(([path]) => path === item.url)).toBe(false)
  })
})
