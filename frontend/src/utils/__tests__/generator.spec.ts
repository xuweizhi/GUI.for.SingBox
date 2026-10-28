import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    mockSubscribes.splice(0)
    mockNodeGroups.splice(0)
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

  it('expands node-group strategy members to ordered leaf outbounds', async () => {
    const profile = createProfile()
    const subscription = {
      id: 'sub-a',
      name: 'Provider A',
      path: 'sub-a.json',
      disabled: false,
      proxies: [
        { id: 'node-a', tag: 'Node A', type: 'socks' },
        { id: 'node-b', tag: 'Node B', type: 'socks' },
      ],
    } as App.Subscription
    mockSubscribes.push(subscription)
    mockGetSubscribeById.mockReturnValue(subscription)
    mockNodeGroups.push({
      id: 'group-a',
      name: 'Work nodes',
      icon: '',
      mode: 'manual',
      members: [
        { subscription_id: 'sub-a', node_id: 'node-b', last_known_tag: 'Node B' },
        { subscription_id: 'sub-a', node_id: 'node-a', last_known_tag: 'Node A' },
      ],
      source_scope: 'all',
      subscription_ids: [],
      include: '',
      exclude: '',
      max_nodes: 0,
    })
    profile.outbounds[1]!.outbounds = [{ id: 'group-a', type: 'NodeGroup', tag: 'Work nodes' }]
    vi.mocked(ReadFile).mockResolvedValue(
      JSON.stringify([
        { type: 'socks', tag: 'Node A', server: 'a.example', server_port: 1080 },
        { type: 'socks', tag: 'Node B', server: 'b.example', server_port: 1080 },
      ]),
    )

    const config = await generateConfig(profile, {
      enableStableConfigCompat: false,
      enablePluginProcessing: false,
      enableMixinProcessing: false,
      enableScriptProcessing: false,
    })

    expect(config.outbounds[1].outbounds).toEqual(['Node B', 'Node A'])
    expect(config.outbounds.some((outbound: Recordable) => outbound.tag === 'Work nodes')).toBe(
      false,
    )
  })

  it('deduplicates node-group overlap and applies the strategy final filter', async () => {
    const profile = createProfile()
    const subscription = {
      id: 'sub-a',
      name: 'Provider A',
      path: 'sub-a.json',
      disabled: false,
      proxies: [
        { id: 'node-a', tag: 'HK Node', type: 'socks' },
        { id: 'node-b', tag: 'US Node', type: 'socks' },
      ],
    } as App.Subscription
    mockSubscribes.push(subscription)
    mockGetSubscribeById.mockReturnValue(subscription)
    mockNodeGroups.push({
      id: 'group-a',
      name: 'Regional',
      icon: '',
      mode: 'filter',
      members: [],
      source_scope: 'all',
      subscription_ids: [],
      include: 'Node',
      exclude: '',
      max_nodes: 0,
    })
    profile.outbounds[1]!.include = 'HK'
    profile.outbounds[1]!.outbounds = [
      { id: 'node-a', type: 'sub-a', tag: 'HK Node' },
      { id: 'group-a', type: 'NodeGroup', tag: 'Regional' },
    ]
    vi.mocked(ReadFile).mockResolvedValue(
      JSON.stringify([
        { type: 'socks', tag: 'HK Node', server: 'hk.example', server_port: 1080 },
        { type: 'socks', tag: 'US Node', server: 'us.example', server_port: 1080 },
      ]),
    )

    const config = await generateConfig(profile, {
      enableStableConfigCompat: false,
      enablePluginProcessing: false,
      enableMixinProcessing: false,
      enableScriptProcessing: false,
    })

    expect(config.outbounds[1].outbounds).toEqual(['HK Node'])
    expect(
      config.outbounds.filter((outbound: Recordable) => outbound.tag === 'HK Node'),
    ).toHaveLength(1)
  })

  it('rejects a strategy whose sources expand to no runtime members', async () => {
    const profile = createProfile()
    mockNodeGroups.push({
      id: 'empty-group',
      name: 'Empty group',
      icon: '',
      mode: 'manual',
      members: [],
      source_scope: 'all',
      subscription_ids: [],
      include: '',
      exclude: '',
      max_nodes: 0,
    })
    profile.outbounds[1]!.outbounds = [{ id: 'empty-group', type: 'NodeGroup', tag: 'Empty group' }]

    await expect(
      generateConfig(profile, {
        enableStableConfigCompat: false,
        enablePluginProcessing: false,
        enableMixinProcessing: false,
        enableScriptProcessing: false,
      }),
    ).rejects.toThrow('Empty group')
  })

  it('preserves an original node-group reference during safe restoration', async () => {
    const profile = createProfile()
    const subscription = {
      id: 'sub-a',
      name: 'Provider A',
      path: 'sub-a.json',
      disabled: false,
      proxies: [
        { id: 'node-a', tag: 'Node A', type: 'socks' },
        { id: 'node-b', tag: 'Node B', type: 'socks' },
      ],
    } as App.Subscription
    const group: App.NodeGroup = {
      id: 'group-a',
      name: 'Work nodes',
      icon: '',
      mode: 'manual',
      members: [
        { subscription_id: 'sub-a', node_id: 'node-a', last_known_tag: 'Node A' },
        { subscription_id: 'sub-a', node_id: 'node-b', last_known_tag: 'Node B' },
      ],
      source_scope: 'all',
      subscription_ids: [],
      include: '',
      exclude: '',
      max_nodes: 0,
    }
    mockSubscribes.push(subscription)
    mockGetSubscribeById.mockReturnValue(subscription)
    mockNodeGroups.push(group)
    profile.outbounds[1]!.outbounds = [{ id: group.id, type: 'NodeGroup', tag: group.name }]
    vi.mocked(ReadFile).mockResolvedValue(
      JSON.stringify([
        { type: 'socks', tag: 'Node A', server: 'a.example', server_port: 1080 },
        { type: 'socks', tag: 'Node B', server: 'b.example', server_port: 1080 },
      ]),
    )
    const config = await generateConfig(profile, {
      enableStableConfigCompat: false,
      enablePluginProcessing: false,
      enableMixinProcessing: false,
      enableScriptProcessing: false,
    })

    const restored = restoreProfile(config, profile.name, {
      profile,
      subscriptionIds: [subscription.id],
    })

    expect(
      restored.outbounds.find((outbound) => outbound.tag === profile.outbounds[1]!.tag)?.outbounds,
    ).toContainEqual({ id: group.id, type: 'NodeGroup', tag: group.name })
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

const configOptions = {
  enableStableConfigCompat: false,
  enablePluginProcessing: false,
  enableMixinProcessing: false,
  enableScriptProcessing: false,
}
const strategy = (id: string, members: App.Proxy[], pre_proxy = ''): App.Outbound => ({
  ...DefaultOutbounds()[1]!,
  id,
  tag: id,
  outbounds: members,
  pre_proxy,
})
const subMember = (id: string): App.Proxy => ({ id, tag: id, type: 'Subscription' })
const groupMember = (id: string): App.Proxy => ({ id, tag: id, type: 'Built-in' })
const subscriptions = (
  definitions: { id: string; nodes: Recordable[]; options?: Partial<App.Subscription> }[],
) => {
  const files = new Map<string, string>()
  definitions.forEach(({ id, nodes, options }) => {
    const subscription = {
      id,
      name: id,
      path: `${id}.json`,
      disabled: false,
      proxies: nodes.map((node, index) => ({
        id: `${id}-${index}`,
        tag: node.tag,
        type: node.type,
      })),
      ...options,
    } as App.Subscription
    mockSubscribes.push(subscription)
    files.set(subscription.path, JSON.stringify(nodes))
  })
  mockGetSubscribeById.mockImplementation((id) => mockSubscribes.find((sub) => sub.id === id))
  vi.mocked(ReadFile).mockImplementation(async (path) => files.get(path)!)
}
const socks = (tag: string, server = 'node.example'): Recordable => ({
  type: 'socks',
  tag,
  server,
  server_port: 1080,
})

describe('subscription DNS, endpoints and chained strategies', () => {
  beforeEach(() => {
    mockGetSubscribeById.mockReset()
    mockSubscribes.splice(0)
    mockNodeGroups.splice(0)
    vi.mocked(ReadFile).mockReset()
  })

  it('isolates same-named subscription resolvers, rewrites bootstrap references and leaves website DNS unchanged', async () => {
    const profile = createProfile()
    profile.outbounds = [strategy('nodes', [subMember('a'), subMember('b')])]
    const importedDns = {
      resolver: 'main',
      servers: [
        {
          tag: 'main',
          type: 'https',
          server: 'dns.example',
          domain_resolver: { server: 'bootstrap', strategy: 'ipv4_only' },
        },
        { tag: 'bootstrap', type: 'udp', server: '1.1.1.1' },
        { tag: 'unused', type: 'udp', server: '9.9.9.9' },
      ],
    }
    subscriptions(
      ['a', 'b'].map((id) => ({
        id,
        nodes: [socks('shared')],
        options: { preferOutboundDns: true, importedDns },
      })),
    )
    const config = await generateConfig(profile, configOptions)
    const nodes = config.outbounds.filter((entry: Recordable) => entry.type === 'socks')
    expect(nodes.map((node: Recordable) => node.domain_resolver)).toEqual([
      'sub:a:main',
      'sub:b:main',
    ])
    expect(
      config.dns.servers.find((server: Recordable) => server.tag === 'sub:a:main').domain_resolver,
    ).toEqual({ server: 'sub:a:bootstrap', strategy: 'ipv4_only' })
    expect(config.dns.servers.some((server: Recordable) => server.tag.includes('unused'))).toBe(
      false,
    )
    expect(config.dns.final).toBe(
      profile.dns.servers.find((server) => server.id === profile.dns.final)!.tag,
    )
    expect(JSON.stringify(config.dns.rules)).not.toContain('sub:')
    expect(config.route.default_domain_resolver.server).toBe('System-DNS-Resolver')
    expect(mockSubscribes[0]!.importedDns).toEqual(importedDns)
  })

  it('preserves manual node references to existing profile DNS and strategy tags', async () => {
    const profile = createProfile()
    profile.outbounds = [
      strategy('upstream', [subMember('up')]),
      strategy('manual', [subMember('manual')]),
    ]
    subscriptions([
      { id: 'up', nodes: [socks('hop', '192.0.2.1')] },
      {
        id: 'manual',
        nodes: [
          {
            ...socks('manual-node'),
            detour: 'upstream',
            domain_resolver: { server: 'Remote-DNS', strategy: 'ipv4_only' },
          },
        ],
      },
    ])
    const config = await generateConfig(profile, configOptions)
    expect(config.outbounds.find((entry: Recordable) => entry.tag === 'manual-node')).toMatchObject(
      {
        detour: 'upstream',
        domain_resolver: { server: 'Remote-DNS', strategy: 'ipv4_only' },
      },
    )
    profile.outbounds[0]!.outbounds = [groupMember('manual')]
    await expect(generateConfig(profile, configOptions)).rejects.toThrow(
      'Circular runtime dependency',
    )
  })

  it('rewrites endpoint-backed DNS dependencies and avoids collisions with profile DNS tags', async () => {
    const profile = createProfile()
    profile.dns.servers.push({
      ...DefaultDnsServer(),
      id: 'reserved',
      tag: 'sub:a:tail-dns',
      type: DnsServer.Local,
    })
    profile.outbounds = [strategy('nodes', [subMember('a'), subMember('b')])]
    subscriptions(
      ['a', 'b'].map((id) => ({
        id,
        nodes: [
          socks(`node-${id}`),
          { type: 'tailscale', tag: 'tail', _gui_kind: 'endpoint', state_directory: `tail-${id}` },
        ],
        options: {
          preferOutboundDns: true,
          importedDns: { servers: [{ type: 'tailscale', tag: 'tail-dns', endpoint: 'tail' }] },
        },
      })),
    )
    const config = await generateConfig(profile, configOptions)
    expect(
      config.outbounds.find((entry: Recordable) => entry.tag === 'node-a').domain_resolver,
    ).toBe('sub:a:tail-dns 2')
    expect(
      config.dns.servers.find((entry: Recordable) => entry.tag === 'sub:a:tail-dns 2').endpoint,
    ).toBe('tail')
    expect(
      config.dns.servers.find((entry: Recordable) => entry.tag === 'sub:b:tail-dns').endpoint,
    ).toBe('tail [b]')
    expect(config.endpoints.map((entry: Recordable) => entry.tag)).toEqual(['tail', 'tail [b]'])
  })

  it('gives manual DNS precedence and uses profile defaults while the subscription option is disabled', async () => {
    const profile = createProfile()
    profile.outbounds = [strategy('nodes', [subMember('a'), subMember('b')])]
    subscriptions(
      ['a', 'b'].map((id) => ({
        id,
        nodes: [{ ...socks(id), domain_resolver: { server: 'missing', strategy: 'ipv4_only' } }],
        options: {
          preferOutboundDns: id === 'a',
          outboundDns: ['https://1.1.1.1/dns-query'],
          importedDns: { servers: [{ tag: 'ignored', type: 'udp', server: '9.9.9.9' }] },
        },
      })),
    )
    const config = await generateConfig(profile, configOptions)
    expect(config.outbounds.find((entry: Recordable) => entry.tag === 'a').domain_resolver).toBe(
      'sub:a:dns-1',
    )
    expect(config.outbounds.find((entry: Recordable) => entry.tag === 'b')).not.toHaveProperty(
      'domain_resolver',
    )
    expect(
      config.dns.servers.filter((entry: Recordable) => entry.tag.startsWith('sub:')),
    ).toHaveLength(1)
  })

  it('rejects unresolved or cyclic imported DNS dependencies with a subscription-specific error', async () => {
    const profile = createProfile()
    profile.outbounds = [strategy('nodes', [subMember('a')])]
    subscriptions([
      {
        id: 'a',
        nodes: [socks('node')],
        options: {
          preferOutboundDns: true,
          importedDns: {
            resolver: 'main',
            servers: [
              { tag: 'main', type: 'https', server: 'dns.example', domain_resolver: 'main' },
            ],
          },
        },
      },
    ])
    await expect(generateConfig(profile, configOptions)).rejects.toThrow(
      'Circular subscription DNS dependency: a',
    )
  })

  it('splits native endpoints without leaking GUI metadata and preserves complete peer configuration', async () => {
    const profile = createProfile()
    profile.outbounds = [strategy('nodes', [subMember('a')])]
    const endpoint = {
      type: 'wireguard',
      tag: 'wg',
      _gui_kind: 'endpoint',
      address: ['10.0.0.2/32'],
      private_key: 'private',
      peers: [
        {
          address: '192.0.2.1',
          port: 51820,
          public_key: 'public',
          allowed_ips: ['0.0.0.0/0'],
          persistent_keepalive_interval: 25,
        },
      ],
    }
    subscriptions([{ id: 'a', nodes: [endpoint] }])
    const config = await generateConfig(profile, configOptions)
    expect(config.outbounds).toEqual([expect.objectContaining({ tag: 'nodes', outbounds: ['wg'] })])
    expect(config.endpoints).toEqual([{ ...endpoint, _gui_kind: undefined }])
    expect(JSON.stringify(config)).not.toContain('_gui_kind')
    const restored = restoreProfile(config, 'native')
    const regenerated = await generateConfig(restored, configOptions)
    expect(regenerated.endpoints).toEqual(config.endpoints)
    expect(regenerated.outbounds[0].outbounds).toEqual(['wg'])
  })

  it('gives each upstream an isolated leaf while keeping direct usage untouched', async () => {
    const profile = createProfile()
    profile.outbounds = [
      strategy('exit', [subMember('exit')]),
      strategy('up-a', [subMember('a')]),
      strategy('up-b', [subMember('b')]),
      strategy('chain-a', [groupMember('exit')], 'up-a'),
      strategy('chain-b', [groupMember('exit')], 'up-b'),
    ]
    subscriptions([
      { id: 'exit', nodes: [socks('leaf')] },
      { id: 'a', nodes: [socks('hop-a')] },
      { id: 'b', nodes: [socks('hop-b')] },
    ])
    const config = await generateConfig(profile, configOptions)
    const entries = new Map<string, Recordable>(
      config.outbounds.map((entry: Recordable) => [entry.tag, entry]),
    )
    expect(entries.get('leaf')).not.toHaveProperty('detour')
    for (const letter of ['a', 'b']) {
      const nested = entries.get(entries.get(`chain-${letter}`)!.outbounds[0])!
      const leaf = entries.get(nested.outbounds[0])!
      expect(leaf.detour).toBe(`up-${letter}`)
      expect(nested).not.toHaveProperty('detour')
      expect(entries.get(`chain-${letter}`)).not.toHaveProperty('detour')
    }
    expect(profile.outbounds.find((entry) => entry.id === 'exit')!.pre_proxy).toBe('')
    expect(new Set(config.outbounds.map((entry: Recordable) => entry.tag)).size).toBe(
      config.outbounds.length,
    )
  })

  it('composes nested pre-proxy chains independently of group ordering', async () => {
    const profile = createProfile()
    profile.outbounds = [
      strategy('first', [subMember('a')]),
      strategy('second', [subMember('b')], 'first'),
      strategy('outer', [groupMember('second')], 'upstream'),
      strategy('upstream', [subMember('c')]),
    ]
    subscriptions(['a', 'b', 'c'].map((id) => ({ id, nodes: [socks(`node-${id}`)] })))
    const config = await generateConfig(profile, configOptions)
    const entries = new Map<string, Recordable>(
      config.outbounds.map((entry: Recordable) => [entry.tag, entry]),
    )
    const inner = entries.get(entries.get('outer')!.outbounds[0])!
    const exit = entries.get(inner.outbounds[0])!
    const first = entries.get(exit.detour)!
    const firstLeaf = entries.get(first.outbounds[0])!
    expect(firstLeaf.detour).toBe('upstream')
    expect(entries.get(entries.get('second')!.outbounds[0])!.detour).toBe('first')
  })

  it('rejects deep mixed member/pre-proxy cycles and missing stable IDs', async () => {
    const profile = createProfile()
    profile.outbounds = [
      strategy('a', [groupMember('b')]),
      strategy('b', [groupMember('c')]),
      strategy('c', [], 'a'),
    ]
    await expect(generateConfig(profile, configOptions)).rejects.toThrow('cycle')
    profile.outbounds[2]!.pre_proxy = 'deleted'
    await expect(generateConfig(profile, configOptions)).rejects.toThrow('deleted')
  })

  it('supports endpoint detours and rejects shared stateful endpoint instances', async () => {
    const profile = createProfile()
    profile.outbounds = [
      strategy('upstream', [subMember('up')]),
      strategy('chain', [subMember('wg')], 'upstream'),
    ]
    subscriptions([
      { id: 'up', nodes: [socks('hop')] },
      {
        id: 'wg',
        nodes: [
          {
            type: 'wireguard',
            tag: 'wg',
            _gui_kind: 'endpoint',
            address: ['10.0.0.2/32'],
            private_key: 'private',
            peers: [],
          },
        ],
      },
    ])
    const config = await generateConfig(profile, configOptions)
    expect(config.endpoints).toHaveLength(1)
    expect(config.endpoints[0].detour).toBe('upstream')
    profile.outbounds.push(strategy('direct-wg', [subMember('wg')]))
    const original = vi.mocked(ReadFile).getMockImplementation()!
    vi.mocked(ReadFile).mockImplementation(async (...args) => {
      const entries = JSON.parse(await original(...args))
      entries.forEach((entry: Recordable) => {
        if (entry.type === 'wireguard') entry.system = true
      })
      return JSON.stringify(entries)
    })
    await expect(generateConfig(profile, configOptions)).rejects.toThrow(
      'separate endpoint definitions',
    )
  })

  it('retains source IDs, subscription DNS, and pre-proxy settings when the generated graph was not edited', async () => {
    const profile = createProfile()
    profile.outbounds = [
      strategy('upstream', [subMember('up')]),
      strategy('chain', [subMember('exit')], 'upstream'),
    ]
    subscriptions([
      { id: 'up', nodes: [socks('hop')] },
      {
        id: 'exit',
        nodes: [socks('leaf')],
        options: { preferOutboundDns: true, outboundDns: ['1.1.1.1'] },
      },
    ])
    const config = await generateConfig(profile, configOptions)
    const restored = restoreProfile(JSON.parse(JSON.stringify(config)), 'restored', {
      profile,
      baseline: config,
      subscriptionIds: ['up', 'exit'],
    })
    expect(restored.outbounds).toEqual(profile.outbounds)
    const regenerated = await generateConfig(restored, configOptions)
    expect(regenerated.outbounds).toEqual(config.outbounds)
    expect(regenerated.dns).toEqual(config.dns)
  })

  it('retains native node edits, DNS transport options and chain detours after editing generated JSON', async () => {
    const profile = createProfile()
    profile.outbounds = [
      strategy('upstream', [subMember('up')]),
      strategy('chain', [subMember('exit')], 'upstream'),
    ]
    subscriptions([
      { id: 'up', nodes: [socks('hop')] },
      {
        id: 'exit',
        nodes: [socks('leaf')],
        options: {
          preferOutboundDns: true,
          importedDns: {
            servers: [
              { tag: 'doh', type: 'https', server: '1.1.1.1', tls: { server_name: 'dns.example' } },
            ],
          },
        },
      },
    ])
    const baseline = await generateConfig(profile, configOptions)
    const config = JSON.parse(JSON.stringify(baseline))
    config.outbounds.find((entry: Recordable) => entry.server === 'node.example').server_port = 1234
    const restored = restoreProfile(config, 'edited', {
      profile,
      baseline,
      subscriptionIds: ['up', 'exit'],
    })
    const regenerated = await generateConfig(restored, configOptions)
    expect(regenerated.outbounds).toEqual(config.outbounds)
    expect(regenerated.dns.servers).toEqual(config.dns.servers)
  })
})

describe('native configuration preservation', () => {
  it('preserves direct dial options and a string default resolver while allowing later DNS form edits', async () => {
    const config = {
      outbounds: [
        { type: 'selector', tag: 'select', outbounds: ['direct'] },
        { type: 'direct', tag: 'direct', bind_interface: 'eth0', domain_resolver: 'custom' },
      ],
      dns: {
        servers: [
          { type: 'local', tag: 'system' },
          { type: 'https', tag: 'custom', server: '1.1.1.1', tls: { server_name: 'dns.example' } },
        ],
        final: 'custom',
      },
      route: { final: 'direct', default_domain_resolver: 'custom' },
    }
    const profile = restoreProfile(config, 'native')
    const regenerated = await generateConfig(profile, configOptions)
    expect(regenerated.outbounds.find((entry: Recordable) => entry.tag === 'direct')).toEqual(
      config.outbounds[1],
    )
    expect(regenerated.route.final).toBe('direct')
    expect(regenerated.route.default_domain_resolver.server).toBe('custom')
    const dns = profile.dns.servers.find((server) => server.tag === 'custom')!
    dns.server = '8.8.8.8'
    const edited = await generateConfig(profile, configOptions)
    expect(edited.dns.servers.find((server: Recordable) => server.tag === 'custom')).toMatchObject({
      server: '8.8.8.8',
      tls: { server_name: 'dns.example' },
    })
    dns.tag = 'renamed'
    const renamed = await generateConfig(profile, configOptions)
    expect(
      renamed.dns.servers.find((server: Recordable) => server.tag === 'renamed'),
    ).toMatchObject({ tls: { server_name: 'dns.example' } })
    expect(renamed.dns.servers.some((server: Recordable) => server.tag === 'custom')).toBe(false)
    expect(
      renamed.outbounds.find((entry: Recordable) => entry.tag === 'direct').domain_resolver,
    ).toBe('renamed')
    profile.dns.servers = profile.dns.servers.filter((server) => server !== dns)
    const removed = await generateConfig(profile, configOptions)
    expect(
      removed.dns.servers.some((server: Recordable) => ['custom', 'renamed'].includes(server.tag)),
    ).toBe(false)
    expect(JSON.stringify(renamed)).not.toContain('_gui_id')
    expect(
      removed.outbounds.find((entry: Recordable) => entry.tag === 'direct'),
    ).not.toHaveProperty('domain_resolver')
  })

  it('does not create an unused original instance of a native system endpoint used only through one chain', async () => {
    const profile = restoreProfile(
      {
        outbounds: [
          { type: 'selector', tag: 'up', outbounds: ['hop'] },
          { type: 'socks', tag: 'hop', server: '192.0.2.1', server_port: 1080 },
          { type: 'urltest', tag: 'chain', outbounds: ['wg'], idle_timeout: '10m' },
        ],
        endpoints: [{ type: 'wireguard', tag: 'wg', system: true, name: 'wg-app', peers: [] }],
      },
      'native',
    )
    profile.outbounds.find((entry) => entry.tag === 'chain')!.pre_proxy = profile.outbounds.find(
      (entry) => entry.tag === 'up',
    )!.id
    const config = await generateConfig(profile, configOptions)
    expect(config.endpoints).toHaveLength(1)
    expect(config.endpoints[0]).toMatchObject({ detour: 'up', system: true, name: 'wg-app' })
    expect(config.outbounds.find((entry: Recordable) => entry.tag === 'chain').idle_timeout).toBe(
      '10m',
    )
  })
})
