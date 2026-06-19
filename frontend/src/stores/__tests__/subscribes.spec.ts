import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { writeFile } = vi.hoisted(() => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/bridge', () => ({
  ReadFile: vi.fn(),
  WriteFile: writeFile,
  Requests: vi.fn(),
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

vi.mock('@/stores/kernelApi', () => ({
  useKernelApiStore: () => ({}),
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
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    )
    writeFile.mockClear()
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
})
