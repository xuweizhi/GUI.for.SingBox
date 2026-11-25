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
  it('round-trips action options exactly once and keeps unmodeled match conditions editable', async () => {
    const base = raw()
    const profile = restoreProfile({
      ...base,
      route: {
        ...base.route,
        rules: [{ action: 'route-options', auth_user: 'alice', override_port: 443 }],
      },
      dns: { ...base.dns, rules: [{ action: 'predefined', query_type: 'A', rcode: 'NXDOMAIN' }] },
    })
    const route = profile.route.rules[0]!
    const dns = profile.dns.rules[0]!
    expect(JSON.parse(route.payload)).toEqual({ auth_user: 'alice' })
    expect(JSON.parse(dns.payload)).toEqual({ query_type: 'A' })
    route.outbound = '{"override_port":8443}'
    dns.server = '{}'
    const config = await gen(profile)
    expect(config.route.rules[0]).toMatchObject({ auth_user: 'alice', override_port: 8443 })
    expect(config.dns.rules[0]).not.toHaveProperty('rcode')
  })

  it('normalizes native list fields, passwordless users and DNS cache options', async () => {
    const profile = restoreProfile({
      ...raw(),
      experimental: { cache_file: { store_rdrc: false } },
      inbounds: [
        { type: 'tun', tag: 'tun', address: '10.1.0.1/30', route_address: '10.0.0.0/8' },
        { type: 'mixed', tag: 'in', users: [{ username: 'alice' }] },
      ],
      dns: { servers: [{ type: 'hosts', tag: 'hosts', path: '/etc/hosts' }] },
    })
    const config = await gen(profile)
    expect(config.inbounds[0].address).toEqual(['10.1.0.1/30'])
    expect(config.inbounds[0].route_address).toEqual(['10.0.0.0/8'])
    expect(config.inbounds[1].users).toEqual([{ username: 'alice', password: '' }])
    expect(config.dns.servers.find((s: Recordable) => s.tag === 'hosts').path).toEqual([
      '/etc/hosts',
    ])
    expect(config.experimental.cache_file.store_dns).toBe(false)
    expect(config.experimental.cache_file).not.toHaveProperty('store_rdrc')
  })

  it('retains a legacy DNS target in every modeled reference and a native download detour', async () => {
    const base = raw()
    const profile = restoreProfile({
      ...base,
      experimental: { clash_api: { external_ui_download_detour: 'direct' } },
      dns: {
        servers: [{ tag: 'old', address: '9.9.9.9' }],
        final: 'old',
        rules: [{ domain: 'example.org', server: 'old' }],
      },
      route: {
        ...base.route,
        default_domain_resolver: 'old',
        rules: [{ action: 'resolve', server: 'old' }],
      },
    })
    const config = await gen(profile)
    expect(config.experimental.clash_api.external_ui_download_detour).toBe('direct')
    expect(config.dns.final).toBe('old')
    expect(config.dns.rules[0].server).toBe('old')
    expect(config.route.rules[0].server).toBe('old')
    expect(config.route.default_domain_resolver.server).toBe('old')
  })

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
