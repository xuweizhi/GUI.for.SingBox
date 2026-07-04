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
  GetSystemProxyBypass: vi.fn(),
  WindowSetSystemDefaultTheme: vi.fn(),
  WindowIsMaximised: vi.fn().mockResolvedValue(false),
  WindowIsMinimised: vi.fn().mockResolvedValue(false),
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
  APP_RUNTIME: 'webui',
  isWebui: true,
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

import { useAppSettingsStore } from '@/stores/appSettings'
import { useProfilesStore } from '@/stores/profiles'
import { useSubscribesStore } from '@/stores/subscribes'
import { RequestMethod, RequestProxyMode } from '@/enums/app'
import { Requests } from '@/bridge'

import type { Subscription } from '@/types/app'

const subscription = (id: string): Subscription =>
  ({
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
})
