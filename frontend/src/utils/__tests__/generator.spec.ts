import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetSubscribeById = vi.fn()

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
  useRulesetsStore: () => ({
    getRulesetById: vi.fn(),
  }),
  useSubscribesStore: () => ({
    getSubscribeById: mockGetSubscribeById,
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

import { ReadFile } from '@/bridge'
import {
  DefaultDns,
  DefaultDnsServer,
  DefaultExperimental,
  DefaultInbounds,
  DefaultInboundDirect,
  DefaultLog,
  DefaultMixin,
  DefaultOutbounds,
  DefaultRoute,
  DefaultScript,
} from '@/constant/profile'
import { DnsServer, Inbound, Strategy } from '@/enums/kernel'
import { generateConfig, generateDnsServerURL } from '@/utils/generator'
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

describe('generateConfig dns servers', () => {
  beforeEach(() => {
    mockAppSettingsStore.app.kernel.branch = 'main'
    mockGetSubscribeById.mockReset()
    vi.mocked(ReadFile).mockReset()
  })

  it('omits domain resolvers for IP-based dns servers', async () => {
    const config = await generateConfig(createProfile(), {
      enableStableConfigCompat: false,
      enablePluginProcessing: false,
      enableMixinProcessing: false,
      enableScriptProcessing: false,
    })

    const localDns = config.dns.servers.find(
      (server: { tag: string }) => server.tag === 'Local-DNS',
    )
    const remoteDns = config.dns.servers.find(
      (server: { tag: string }) => server.tag === 'Remote-DNS',
    )

    expect(localDns).not.toHaveProperty('domain_resolver')
    expect(remoteDns).not.toHaveProperty('domain_resolver')
  })

  it('omits domain resolvers for IPv6 dns servers', async () => {
    const profile = createProfile()
    const remoteDns = profile.dns.servers.find((server) => server.tag === 'Remote-DNS')!
    remoteDns.server = '2606:4700:4700::1111'

    const config = await generateConfig(profile, {
      enableStableConfigCompat: false,
      enablePluginProcessing: false,
      enableMixinProcessing: false,
      enableScriptProcessing: false,
    })

    expect(
      config.dns.servers.find((server: { tag: string }) => server.tag === 'Remote-DNS'),
    ).not.toHaveProperty('domain_resolver')
  })

  it('keeps DNS rule strategy and default resolver client subnet', async () => {
    const profile = createProfile()
    profile.dns.rules[0]!.strategy = Strategy.PreferIPv4
    profile.route.default_domain_resolver.client_subnet = '203.0.113.0/24'

    const config = await generateConfig(profile, {
      enableStableConfigCompat: false,
      enablePluginProcessing: false,
      enableMixinProcessing: false,
      enableScriptProcessing: false,
    })

    expect(config.dns.rules[0]).toMatchObject({ strategy: 'prefer_ipv4' })
    expect(config.route.default_domain_resolver).toMatchObject({
      server: 'System-DNS-Resolver',
      client_subnet: '203.0.113.0/24',
    })
    expect(config.route.default_mark).toBe(128)
  })

  it('migrates legacy public bootstrap resolvers to native DNS', async () => {
    const profile = createProfile()
    profile.dns.servers = profile.dns.servers.filter((server) => server.type !== DnsServer.Local)
    profile.route.default_domain_resolver.server = 'Local-DNS-Resolver'

    const config = await generateConfig(profile, {
      enableStableConfigCompat: false,
      enablePluginProcessing: false,
      enableMixinProcessing: false,
      enableScriptProcessing: false,
    })

    expect(config.dns.servers).toContainEqual({
      tag: 'System-DNS-Resolver',
      type: 'local',
    })
    expect(config.route.default_domain_resolver.server).toBe('System-DNS-Resolver')
  })

  it('preserves an explicitly selected custom default resolver', async () => {
    const profile = createProfile()
    const customResolver = {
      ...DefaultDnsServer(),
      id: 'custom-resolver',
      tag: 'Custom-Resolver',
      type: DnsServer.Udp,
      server: '1.1.1.1',
      server_port: '53',
    }
    profile.dns.servers.push(customResolver)
    profile.route.default_domain_resolver.server = customResolver.id

    const config = await generateConfig(profile, {
      enableStableConfigCompat: false,
      enablePluginProcessing: false,
      enableMixinProcessing: false,
      enableScriptProcessing: false,
    })

    expect(config.route.default_domain_resolver.server).toBe('Custom-Resolver')
  })

  it('formats IPv6 DNS server URLs with brackets', () => {
    expect(
      generateDnsServerURL({
        ...DefaultDnsServer(),
        type: DnsServer.Https,
        server: '2606:4700:4700::1111',
        server_port: '443',
        path: '/dns-query',
      }),
    ).toBe('https://[2606:4700:4700::1111]:443/dns-query')
  })

  it('generates direct inbound configuration without users', async () => {
    const profile = createProfile()
    profile.inbounds = [
      {
        id: 'direct-in',
        type: Inbound.Direct,
        tag: 'direct-in',
        enable: true,
        direct: {
          ...DefaultInboundDirect(),
          network: 'tcp',
        },
      },
    ]

    const config = await generateConfig(profile, {
      enableStableConfigCompat: false,
      enablePluginProcessing: false,
      enableMixinProcessing: false,
      enableScriptProcessing: false,
    })

    expect(config.inbounds).toEqual([
      {
        type: 'direct',
        tag: 'direct-in',
        listen: '127.0.0.1',
        listen_port: 20119,
        tcp_fast_open: false,
        tcp_multi_path: false,
        udp_fragment: false,
        network: 'tcp',
      },
    ])
  })

  it('omits an empty network from direct inbound configuration', async () => {
    const profile = createProfile()
    profile.inbounds = [
      {
        id: 'direct-in',
        type: Inbound.Direct,
        tag: 'direct-in',
        enable: true,
        direct: DefaultInboundDirect(),
      },
    ]

    const config = await generateConfig(profile, {
      enableStableConfigCompat: false,
      enablePluginProcessing: false,
      enableMixinProcessing: false,
      enableScriptProcessing: false,
    })

    expect(config.inbounds[0]).not.toHaveProperty('network')
  })

  it('preserves colons in inbound passwords', async () => {
    const profile = createProfile()
    profile.inbounds[0]!.mixed!.users = ['alice:p:a:ss']

    const config = await generateConfig(profile, {
      enableStableConfigCompat: false,
      enablePluginProcessing: false,
      enableMixinProcessing: false,
      enableScriptProcessing: false,
    })

    expect(config.inbounds[0].users).toEqual([{ username: 'alice', password: 'p:a:ss' }])
  })

  it('reports a missing subscription instead of dereferencing an empty cache entry', async () => {
    const profile = createProfile()
    profile.outbounds[1]!.outbounds = [
      { id: 'missing-subscription', type: 'Subscription', tag: 'missing-subscription' },
    ]

    await expect(
      generateConfig(profile, {
        enableStableConfigCompat: false,
        enablePluginProcessing: false,
        enableMixinProcessing: false,
        enableScriptProcessing: false,
      }),
    ).rejects.toThrow('Subscription not found: missing-subscription')
  })

  it('disambiguates duplicate proxy tags from different subscriptions', async () => {
    const profile = createProfile()
    profile.outbounds[1]!.outbounds = [
      { id: 'sub-a', type: 'Subscription', tag: 'sub-a' },
      { id: 'sub-b', type: 'Subscription', tag: 'sub-b' },
    ]
    mockGetSubscribeById.mockImplementation((id: string) => ({ id, name: id, path: `${id}.json` }))
    vi.mocked(ReadFile).mockResolvedValue(JSON.stringify([{ type: 'socks', tag: 'Same Node' }]))

    const config = await generateConfig(profile, {
      enableStableConfigCompat: false,
      enablePluginProcessing: false,
      enableMixinProcessing: false,
      enableScriptProcessing: false,
    })

    expect(config.outbounds[1].outbounds).toEqual(['Same Node', 'Same Node [sub-b]'])
    expect(config.outbounds.map((outbound: { tag: string }) => outbound.tag)).toEqual(
      expect.arrayContaining(['Same Node', 'Same Node [sub-b]']),
    )
  })

  it('restores direct inbound configuration', () => {
    const profile = restoreProfile(
      {
        experimental: DefaultExperimental(),
        inbounds: [
          {
            type: 'direct',
            tag: 'direct-in',
            listen: '127.0.0.1',
            listen_port: 20119,
            tcp_fast_open: true,
            tcp_multi_path: false,
            udp_fragment: true,
            network: 'udp',
          },
        ],
      },
      'Restored',
    )

    expect(profile.inbounds).toEqual([
      {
        id: 'in-0',
        type: Inbound.Direct,
        tag: 'direct-in',
        enable: true,
        direct: {
          listen: {
            listen: '127.0.0.1',
            listen_port: 20119,
            tcp_fast_open: true,
            tcp_multi_path: false,
            udp_fragment: true,
          },
          network: 'udp',
        },
      },
    ])
  })
})
