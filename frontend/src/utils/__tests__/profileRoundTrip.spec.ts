import { describe, expect, it, vi } from 'vitest'

const mockGetSubscribeById = vi.fn()
const mockSubscribes: App.Subscription[] = []
const mockNodeGroups: App.NodeGroup[] = []

vi.mock('@/bridge', () => ({
  ReadFile: vi.fn(),
  WriteFile: vi.fn(),
}))

const mockAppSettingsStore = {
  app: {
    kernel: {
      branch: 'main',
    },
  },
}

vi.mock('@/stores', () => ({
  useAppSettingsStore: () => mockAppSettingsStore,
  usePluginsStore: () => ({
    onGenerateTrigger: async (config: unknown) => config,
  }),
  useProfilesStore: () => ({
    getProfileTemplate: () => createProfile(),
  }),
  useNodeGroupsStore: () => ({
    nodeGroups: mockNodeGroups,
    getNodeGroupById: (id: string) => mockNodeGroups.find((group) => group.id === id),
  }),
  useRulesetsStore: () => ({
    getRulesetById: vi.fn(),
    rulesets: [],
  }),
  useSubscribesStore: () => ({
    getSubscribeById: mockGetSubscribeById,
    subscribes: mockSubscribes,
  }),
}))

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')

  return {
    ...actual,
    useI18n: () => ({
      t: (key: string) => key,
    }),
  }
})

import {
  DefaultOutbound,
  DefaultDns,
  DefaultExperimental,
  DefaultInbounds,
  DefaultLog,
  DefaultMixin,
  DefaultOutbounds,
  DefaultRoute,
  DefaultScript,
} from '@/constant/profile'
import { generateConfig } from '@/utils/generator'
import { restoreProfile } from '@/utils/restorer'

const createProfile = (): IProfile => ({
  id: 'test-profile',
  name: 'Test Profile',
  log: DefaultLog(),
  experimental: DefaultExperimental(),
  inbounds: DefaultInbounds(),
  outbounds: DefaultOutbounds(),
  route: DefaultRoute(),
  dns: DefaultDns(),
  mixin: DefaultMixin(),
  script: DefaultScript(),
})

const gen = (p: App.Profile) =>
  generateConfig(p, {
    enableStableConfigCompat: false,
    enablePluginProcessing: false,
    enableMixinProcessing: false,
    enableScriptProcessing: false,
  })
const raw = () => ({
  inbounds: [{ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 1080 }],
  outbounds: [{ type: 'direct', tag: 'direct' }],
  dns: { servers: [{ type: 'local', tag: 'local' }], final: 'local', rules: [] },
  route: { final: 'direct', rules: [], rule_set: [], default_domain_resolver: 'local' },
})

describe('native profile round-trip regressions', () => {
  it('preserves additional DNS conditions through the raw editor baseline flow', async () => {
    const profile = restoreProfile(raw())
    const baseline = await gen(profile)
    const edited = structuredClone(baseline)
    edited.dns.rules = [
      { domain: 'example.com', query_type: ['AAAA'], action: 'route', server: 'local' },
    ]
    const next = await gen(restoreProfile(edited, 'x', { profile, baseline }))
    expect(next.dns.rules[0]).toMatchObject(edited.dns.rules[0])
  })
  it('preserves unmodeled route matching and action options', async () => {
    const profile = restoreProfile(raw())
    const baseline = await gen(profile)
    const edited = structuredClone(baseline)
    edited.route.rules = [
      {
        domain: 'example.com',
        auth_user: ['alice'],
        action: 'route',
        outbound: 'direct',
        override_port: 8443,
      },
    ]
    const next = await gen(restoreProfile(edited, 'x', { profile, baseline }))
    expect(next.route.rules[0]).toMatchObject(edited.route.rules[0])
  })
  it('preserves the default route action targets and DNS options', async () => {
    const profile = restoreProfile(raw())
    const baseline = await gen(profile)
    const edited = structuredClone(baseline)
    edited.route.rules = [{ domain: 'example.com', outbound: 'direct' }]
    edited.dns.rules = [
      { domain: 'example.com', server: 'local', disable_cache: true, strategy: 'ipv4_only' },
    ]
    const next = await gen(restoreProfile(edited, 'x', { profile, baseline }))
    expect(next.route.rules[0]).toMatchObject({ ...edited.route.rules[0], action: 'route' })
    expect(next.dns.rules[0]).toMatchObject({ ...edited.dns.rules[0], action: 'route' })
  })
  it('preserves an unregistered local ruleset path in raw editor save', async () => {
    const profile = restoreProfile(raw())
    const baseline = await gen(profile)
    const edited = structuredClone(baseline)
    edited.route.rule_set = [
      { type: 'local', tag: 'custom', format: 'source', path: '/tmp/custom-rules.json' },
    ]
    const restored = restoreProfile(edited, 'x', { profile, baseline })
    const next = await gen(restored)
    expect(next.route.rule_set[0].path).toBe('/tmp/custom-rules.json')
    restored.route.rule_set[0]!.path = 'missing-gui-id'
    await expect(gen(restored)).rejects.toThrow('Local rule-set not found')
  })
  it('retains DHCP interface when DNS servers are changed in raw editor', async () => {
    const profile = restoreProfile(raw())
    const baseline = await gen(profile)
    const edited = structuredClone(baseline)
    edited.dns.servers = [{ type: 'dhcp', tag: 'local', interface: 'eth123' }]
    const next = await gen(restoreProfile(edited, 'x', { profile, baseline }))
    expect(next.dns.servers.find((s: any) => s.type === 'dhcp').interface).toBe('eth123')
  })
  it.each(['direct', 'block'])(
    'rejects reserved strategy name %s before builtin tag replacement',
    async (tag) => {
      const profile = restoreProfile(raw())
      delete profile.native
      profile.outbounds = [
        {
          ...DefaultOutbound(),
          id: 'proxy-group',
          tag,
          outbounds: [{ id: 's', type: 'Subscription', tag: 'S' }],
        },
        {
          ...DefaultOutbound(),
          id: 'bypass-group',
          tag: 'Bypass',
          outbounds: [{ id: 'direct', type: 'Built-in', tag: 'direct' }],
        },
      ]
      profile.route.final = 'proxy-group'
      await expect(gen(profile)).rejects.toThrow('reserved-tag')
    },
  )
})
