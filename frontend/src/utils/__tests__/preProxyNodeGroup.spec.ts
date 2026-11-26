import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSubscribes: App.Subscription[] = []
const mockNodeGroups: App.NodeGroup[] = []
const mockFiles: Record<string, string> = {}

vi.mock('@/bridge', () => ({
  ReadFile: vi.fn(async (path: string) => {
    if (!(path in mockFiles)) throw new Error(`File not found: ${path}`)
    return mockFiles[path]
  }),
  WriteFile: vi.fn(),
}))

vi.mock('@/stores', () => ({
  useAppSettingsStore: () => ({ app: { kernel: { branch: 'main' } } }),
  usePluginsStore: () => ({ onGenerateTrigger: async (config: unknown) => config }),
  useProfilesStore: () => ({ getProfileTemplate: () => createProfile() }),
  useNodeGroupsStore: () => ({
    nodeGroups: mockNodeGroups,
    getNodeGroupById: (id: string) => mockNodeGroups.find((group) => group.id === id),
  }),
  useRulesetsStore: () => ({ getRulesetById: vi.fn() }),
  useSubscribesStore: () => ({
    subscribes: mockSubscribes,
    getSubscribeById: (id: string) => mockSubscribes.find((sub) => sub.id === id),
  }),
}))

import { DefaultNodeGroup } from '@/constant/nodeGroup'
import {
  DefaultDns,
  DefaultExperimental,
  DefaultInbounds,
  DefaultLog,
  DefaultMixin,
  DefaultOutbound,
  DefaultRoute,
  DefaultScript,
} from '@/constant/profile'
import { Outbound } from '@/enums/kernel'
import { generateConfig } from '@/utils/generator'
import {
  findNodeGroupGraphIssues,
  getNodeGroupDependencies,
  profileUsesSubscription,
  removeNodeGroupReferences,
  resolveNodeGroupPreProxyChain,
  wouldCreateNodeGroupCycle,
} from '@/utils/nodeGroup'
import { ensureNodeGroupOutlet, pruneUnusedNodeGroupOutlets } from '@/utils/nodeGroupOutlet'
import { findOutboundGraphIssues } from '@/utils/outboundPolicy'

const createProfile = (): App.Profile => ({
  id: 'p-1',
  name: 'Profile 1',
  log: DefaultLog(),
  experimental: DefaultExperimental(),
  inbounds: DefaultInbounds(),
  outbounds: [],
  route: DefaultRoute(),
  dns: DefaultDns(),
  mixin: DefaultMixin(),
  script: DefaultScript(),
})

const configOptions = {
  enableStableConfigCompat: false,
  enablePluginProcessing: false,
  enableMixinProcessing: false,
  enableScriptProcessing: false,
}

const socks = (tag: string, server = '192.0.2.1', server_port = 1080) => ({
  type: 'socks',
  tag,
  server,
  server_port,
})

const setupSub = (id: string, nodes: Recordable[]) => {
  const path = `data/subscribes/${id}.json`
  mockFiles[path] = JSON.stringify(nodes)
  mockSubscribes.push({
    id,
    name: id,
    path,
    disabled: false,
    proxies: nodes.map((node) => ({ id: `${id}:${node.tag}`, tag: node.tag, type: node.type })),
  } as unknown as App.Subscription)
}

const addGroup = (overrides: Partial<App.NodeGroup>): App.NodeGroup => {
  const g: App.NodeGroup = {
    ...DefaultNodeGroup(),
    id: overrides.id || 'g',
    name: overrides.name || 'G',
    mode: 'filter',
    source_scope: 'selected',
    ...overrides,
  }
  mockNodeGroups.push(g)
  return g
}

describe('pre-proxy node groups', () => {
  beforeEach(() => {
    mockSubscribes.length = 0
    mockNodeGroups.length = 0
    Object.keys(mockFiles).forEach((key) => delete mockFiles[key])
  })

  it('detects cycles, missing pre-proxy groups, and resolves transport chain order', () => {
    const entry = addGroup({ id: 'entry', name: 'Entry' })
    const mid = addGroup({
      id: 'mid',
      name: 'Mid',
      pre_proxy_group_id: 'entry',
      pre_proxy_behavior: 'auto',
    })
    const landing = addGroup({
      id: 'landing',
      name: 'Landing',
      pre_proxy_group_id: 'mid',
      pre_proxy_behavior: 'manual',
    })

    expect(findNodeGroupGraphIssues([entry, mid, landing])).toEqual([])
    expect(wouldCreateNodeGroupCycle('entry', 'landing', [entry, mid, landing])).toBe(true)
    expect(wouldCreateNodeGroupCycle('landing', 'entry', [entry, mid, landing])).toBe(false)

    const chain = resolveNodeGroupPreProxyChain('landing', [entry, mid, landing])
    expect(chain.error).toBeUndefined()
    expect(chain.hops).toEqual([
      { id: 'entry', name: 'Entry', behavior: 'auto' },
      { id: 'mid', name: 'Mid', behavior: 'manual' },
      { id: 'landing', name: 'Landing' },
    ])

    entry.pre_proxy_group_id = 'landing'
    expect(findNodeGroupGraphIssues([entry, mid, landing])).toEqual([
      expect.objectContaining({ type: 'pre-proxy-cycle' }),
    ])
  })

  it('tracks recursive dependencies and subscription usage across pre-proxy node groups', () => {
    setupSub('sub-entry', [socks('entry-1')])
    setupSub('sub-landing', [socks('landing-1')])
    addGroup({ id: 'entry', name: 'Entry', subscription_ids: ['sub-entry'] })
    addGroup({
      id: 'landing',
      name: 'Landing',
      subscription_ids: ['sub-landing'],
      pre_proxy_group_id: 'entry',
    })

    const profile = createProfile()
    profile.outbounds = [
      {
        ...DefaultOutbound(),
        id: 'out-ai',
        tag: 'AI',
        outbounds: [{ id: 'landing', tag: 'Landing', type: 'NodeGroup' }],
      },
    ]

    expect(profileUsesSubscription(profile, 'sub-entry', mockNodeGroups)).toBe(true)
    expect(getNodeGroupDependencies('entry', [profile], mockNodeGroups)).toEqual([
      {
        profileId: 'p-1',
        profileName: 'Profile 1',
        outboundId: 'out-ai',
        outboundName: 'AI',
        viaGroupName: 'Landing',
      },
    ])
  })

  it('generates multi-hop pre-proxy node group chains and stacks strategy-level pre-proxy outside them', async () => {
    setupSub('sub-outer', [socks('outer-node', '192.0.2.1')])
    setupSub('sub-mid', [socks('mid-node', '192.0.2.2')])
    setupSub('sub-landing', [socks('landing-node', '192.0.2.3')])

    addGroup({ id: 'mid', name: 'Mid Relay', subscription_ids: ['sub-mid'] })
    addGroup({
      id: 'landing',
      name: 'Landing',
      subscription_ids: ['sub-landing'],
      pre_proxy_group_id: 'mid',
      pre_proxy_behavior: 'auto',
    })

    const profile = createProfile()
    profile.outbounds = [
      {
        ...DefaultOutbound(),
        id: 'outer-relay',
        tag: 'Outer Relay',
        outbounds: [{ id: 'sub-outer', tag: 'sub-outer', type: 'Subscription' }],
      },
      {
        ...DefaultOutbound(),
        id: 'normal-landing',
        tag: 'Normal Landing',
        outbounds: [{ id: 'landing', tag: 'Landing', type: 'NodeGroup' }],
      },
      {
        ...DefaultOutbound(),
        id: 'stacked-landing',
        tag: 'Stacked Landing',
        pre_proxy: 'outer-relay',
        outbounds: [{ id: 'landing', tag: 'Landing', type: 'NodeGroup' }],
      },
      {
        ...DefaultOutbound(),
        id: 'direct-sub',
        tag: 'Direct Landing',
        outbounds: [{ id: 'sub-landing', tag: 'sub-landing', type: 'Subscription' }],
      },
    ]

    const config = await generateConfig(profile, configOptions)
    const byTag = new Map<string, Recordable>(
      config.outbounds.map((entry: Recordable) => [entry.tag, entry]),
    )

    // Direct usage of the same landing node stays untouched (no detour).
    expect(byTag.get('landing-node')).not.toHaveProperty('detour')

    // Normal Landing uses synthesized auto pre-proxy for Mid Relay.
    const normalGroup = byTag.get('Normal Landing')!
    const normalLeaf = byTag.get(normalGroup.outbounds[0])!
    expect(normalLeaf.detour).toBe('Mid Relay · Auto Pre-proxy')
    const midPreProxy = byTag.get('Mid Relay · Auto Pre-proxy')!
    expect(midPreProxy.type).toBe('urltest')
    expect(midPreProxy.outbounds).toEqual(['mid-node'])

    // Stacked Landing stacks Outer Relay outside Mid Relay -> Landing.
    const stackedGroup = byTag.get('Stacked Landing')!
    const stackedLeaf = byTag.get(stackedGroup.outbounds[0])!
    const stackedMid = byTag.get(stackedLeaf.detour)!
    expect(stackedMid.type).toBe('urltest')
    const stackedMidLeaf = byTag.get(stackedMid.outbounds[0])!
    expect(stackedMidLeaf.detour).toBe('Outer Relay')
  })

  it('replaces node-group default pre-proxy when pre_proxy_override is enabled via outlet shortcut', async () => {
    setupSub('sub-a', [socks('hop-a', '192.0.2.1')])
    setupSub('sub-b', [socks('hop-b', '192.0.2.2')])
    setupSub('sub-exit', [socks('exit-node', '192.0.2.3')])

    addGroup({ id: 'relay-a', name: 'Relay A', subscription_ids: ['sub-a'] })
    const relayB = addGroup({ id: 'relay-b', name: 'Relay B', subscription_ids: ['sub-b'] })
    const exitGroup = addGroup({
      id: 'exit',
      name: 'Exit',
      subscription_ids: ['sub-exit'],
      pre_proxy_group_id: 'relay-a',
      pre_proxy_behavior: 'manual',
    })

    const profile = createProfile()
    const replacedOutlet = ensureNodeGroupOutlet(profile.outbounds, exitGroup, 'manual', 'Manual', {
      role: 'outlet',
      preProxy: {
        mode: 'replace-group',
        group: relayB,
        behavior: 'manual',
        behaviorLabel: 'Manual',
      },
    })
    const directOutlet = ensureNodeGroupOutlet(profile.outbounds, exitGroup, 'auto', 'Auto', {
      role: 'outlet',
      preProxy: { mode: 'none' },
    })

    const config = await generateConfig(profile, configOptions)
    const byTag = new Map<string, Recordable>(
      config.outbounds.map((entry: Recordable) => [entry.tag, entry]),
    )

    // Replaced outlet routes via Relay B, NOT Relay A.
    const replacedLeaf = byTag.get(byTag.get(replacedOutlet.tag)!.outbounds[0])!
    expect(replacedLeaf.detour).toBe('Relay B · Manual')
    expect(byTag.has('Relay A · Pre-proxy')).toBe(false)

    // Override-to-none outlet dials exit node directly without detour.
    const directLeaf = byTag.get(byTag.get(directOutlet.tag)!.outbounds[0])!
    expect(directLeaf).not.toHaveProperty('detour')
  })

  it('reports outbound graph issues for missing or cyclic node-group pre-proxies and prunes unused outlets', () => {
    const a = addGroup({ id: 'a', name: 'A', pre_proxy_group_id: 'missing-g' })
    const outbound: App.Outbound = {
      ...DefaultOutbound(),
      id: 'out-1',
      tag: 'Out 1',
      outbounds: [{ id: 'a', tag: 'A', type: 'NodeGroup' }],
    }
    expect(findOutboundGraphIssues([outbound], [a])).toEqual([
      expect.objectContaining({ type: 'missing-node-group', targetId: 'missing-g' }),
    ])

    const profile = createProfile()
    const keepGroup = addGroup({ id: 'keep', name: 'Keep' })
    const unusedGroup = addGroup({ id: 'unused', name: 'Unused' })
    const used = ensureNodeGroupOutlet(profile.outbounds, keepGroup, 'manual', 'Manual')
    ensureNodeGroupOutlet(profile.outbounds, unusedGroup, 'manual', 'Manual')
    profile.route.final = used.id

    const removed = pruneUnusedNodeGroupOutlets(profile)
    expect(removed).toEqual(['Unused · Manual'])
    expect(profile.outbounds.map((item) => item.id)).toEqual([used.id])
  })

  it('reuses an existing matching profile strategy instead of synthesizing a duplicate pre-proxy', async () => {
    setupSub('sub-relay', [socks('relay-1')])
    setupSub('sub-exit', [socks('exit-1')])
    const relay = addGroup({ id: 'relay', name: 'Relay', subscription_ids: ['sub-relay'] })
    addGroup({
      id: 'exit',
      name: 'Exit',
      subscription_ids: ['sub-exit'],
      pre_proxy_group_id: 'relay',
      pre_proxy_behavior: 'manual',
    })

    const profile = createProfile()
    const existingRelay = ensureNodeGroupOutlet(profile.outbounds, relay, 'manual', 'Manual')
    profile.outbounds.push({
      ...DefaultOutbound(),
      id: 'exit-strategy',
      tag: 'Exit Strategy',
      type: Outbound.Selector,
      outbounds: [{ id: 'exit', tag: 'Exit', type: 'NodeGroup' }],
    })

    const config = await generateConfig(profile, configOptions)
    const byTag = new Map<string, Recordable>(
      config.outbounds.map((entry: Recordable) => [entry.tag, entry]),
    )
    const exitLeaf = byTag.get(byTag.get('Exit Strategy')!.outbounds[0])!
    expect(exitLeaf.detour).toBe(existingRelay.tag)
    expect(byTag.has('Relay · Pre-proxy')).toBe(false)
  })

  it('does not emit dead synthesized pre-proxy strategies when downstream group nodes are filtered out', async () => {
    setupSub('sub-relay', [socks('relay-1')])
    setupSub('sub-exit', [socks('jp-1')])
    setupSub('sub-us', [socks('us-only-1')])
    addGroup({ id: 'relay', name: 'Relay', subscription_ids: ['sub-relay'] })
    addGroup({
      id: 'exit',
      name: 'Exit',
      subscription_ids: ['sub-exit'],
      pre_proxy_group_id: 'relay',
      pre_proxy_behavior: 'auto',
    })

    const profile = createProfile()
    profile.outbounds.push({
      ...DefaultOutbound(),
      id: 'filtered-exit',
      tag: 'Filtered Exit',
      type: Outbound.Selector,
      include: 'us-only',
      outbounds: [
        { id: 'exit', tag: 'Exit', type: 'NodeGroup' },
        { id: 'sub-us', tag: 'sub-us', type: 'Subscription' },
      ],
    })

    const config = await generateConfig(profile, configOptions)
    const tags = config.outbounds.map((entry: Recordable) => entry.tag)
    expect(tags).toContain('us-only-1')
    expect(tags).not.toContain('Relay · Auto Pre-proxy')
  })

  it('does not hijack filtered user strategies in ensureNodeGroupOutlet and cleans up generated outlets on group deletion', () => {
    const group = addGroup({ id: 'ng-1', name: 'HK Nodes' })
    const profile = createProfile()
    profile.outbounds.push({
      ...DefaultOutbound(),
      id: 'user-filtered',
      tag: 'HK Special',
      type: Outbound.Selector,
      include: 'IPLC',
      outbounds: [{ id: 'ng-1', tag: 'HK Nodes', type: 'NodeGroup' }],
    })

    const outlet = ensureNodeGroupOutlet(profile.outbounds, group, 'manual', 'Manual')
    expect(outlet.id).not.toBe('user-filtered')
    expect(profile.outbounds.find((o) => o.id === 'user-filtered')!.tag).toBe('HK Special')

    profile.route.final = outlet.id
    profile.route.rules.push({
      id: 'r-ng',
      type: 'domain_suffix' as any,
      enable: true,
      payload: 'example.com',
      invert: false,
      action: 'route' as any,
      outbound: outlet.id,
      sniffer: [],
      strategy: 'default' as any,
      server: '',
    })

    const removed = removeNodeGroupReferences('ng-1', [profile])
    expect(removed).toBe(2)
    expect(profile.outbounds.some((o) => o.id === outlet.id)).toBe(false)
    expect(profile.route.final).toBe('')
    expect(profile.route.rules.some((r) => r.id === 'r-ng')).toBe(false)
  })

  it('allows Select to switch between independent node-group subgroups while preserving default pre-proxy chains', async () => {
    setupSub('sub-hk', [socks('hk-1', '192.0.2.10')])
    setupSub('sub-landing', [socks('landing-1', '192.0.2.20')])
    const hk = addGroup({ id: 'hk', name: 'HK', subscription_ids: ['sub-hk'] })
    const landing = addGroup({
      id: 'landing',
      name: 'Landing',
      subscription_ids: ['sub-landing'],
      pre_proxy_group_id: 'hk',
      pre_proxy_behavior: 'auto',
    })

    const profile = createProfile()
    const hkSub = ensureNodeGroupOutlet(profile.outbounds, hk, 'auto', 'Auto', { role: 'outlet' })
    const landingSub = ensureNodeGroupOutlet(profile.outbounds, landing, 'manual', 'Manual', {
      role: 'outlet',
    })
    profile.outbounds.unshift({
      ...DefaultOutbound(),
      id: 'Select',
      tag: 'Select',
      type: Outbound.Selector,
      outbounds: [
        { id: hkSub.id, tag: hkSub.tag, type: 'Built-in' },
        { id: landingSub.id, tag: landingSub.tag, type: 'Built-in' },
      ],
    })

    const config = await generateConfig(profile, configOptions)
    const byTag = new Map<string, Recordable>(
      config.outbounds.map((entry: Recordable) => [entry.tag, entry]),
    )

    expect(byTag.get('Select')!.outbounds).toEqual(['HK · Auto', 'Landing · Manual'])
    expect(byTag.get('HK · Auto')!.type).toBe('urltest')
    expect(byTag.get('Landing · Manual')!.type).toBe('selector')
    const landingLeaf = byTag.get(byTag.get('Landing · Manual')!.outbounds[0])!
    expect(landingLeaf.detour).toBe('HK · Auto')
  })
})
