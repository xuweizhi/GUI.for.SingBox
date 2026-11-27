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
  DefaultOutbounds,
  DefaultRoute,
  DefaultScript,
} from '@/constant/profile'
import { Outbound } from '@/enums/kernel'
import { generateConfig } from '@/utils/generator'
import {
  HOME_PRE_PROXY_OUTBOUND_ID,
  applyHomePreProxyNode,
  applyHomePreProxyNodeGroup,
  clearHomePreProxy,
  findRestoredExitNodeTag,
  findRuntimeNodeTag,
  resolveActivePreProxyState,
  stripViaSuffix,
} from '@/utils/homePreProxy'

const createProfile = (): App.Profile => ({
  id: 'p-home',
  name: 'Home Test',
  primary_proxy_outbound: 'outbound-select',
  log: DefaultLog(),
  experimental: DefaultExperimental(),
  inbounds: DefaultInbounds(),
  outbounds: DefaultOutbounds(),
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

const setupSub = (id: string, name: string, nodes: Recordable[]) => {
  const path = `data/subscribes/${id}.json`
  mockFiles[path] = JSON.stringify(nodes)
  const sub = {
    id,
    name,
    path,
    disabled: false,
    proxies: nodes.map((node) => ({ id: `${id}:${node.tag}`, tag: node.tag, type: node.type })),
  } as unknown as App.Subscription
  mockSubscribes.push(sub)
  return sub
}

describe('home pre-proxy quick selection helpers', () => {
  beforeEach(() => {
    mockSubscribes.length = 0
    mockNodeGroups.length = 0
    Object.keys(mockFiles).forEach((k) => delete mockFiles[k])
  })

  it('creates a managed hot-switchable pre-proxy selector with direct + subscriptions and chains Select through it', async () => {
    const sub = setupSub('sub-1', 'MainSub', [socks('HK-01', '192.0.2.1'), socks('US-01', '192.0.2.2')])
    const profile = createProfile()
    const select = profile.outbounds.find((o) => o.id === 'outbound-select')!
    const auto = profile.outbounds.find((o) => o.id === 'outbound-urltest')!
    select.outbounds.push({ id: sub.id, tag: sub.name, type: 'Subscription' })
    auto.outbounds.push({ id: sub.id, tag: sub.name, type: 'Subscription' })

    const { preProxyTag } = applyHomePreProxyNode(profile, {
      subscriptions: mockSubscribes,
      preProxyLabel: '前置代理',
    })

    expect(preProxyTag).toBe('前置代理')
    expect(select.pre_proxy).toBe(HOME_PRE_PROXY_OUTBOUND_ID)

    const config = await generateConfig(profile, configOptions)
    const byTag = new Map<string, Recordable>(
      config.outbounds.map((entry: Recordable) => [entry.tag, entry]),
    )

    const preGroup = byTag.get('前置代理')!
    expect(preGroup.type).toBe('selector')
    expect(preGroup.outbounds).toEqual(['direct', 'HK-01', 'US-01'])

    const runtimeSelect = byTag.get(select.tag)!
    expect(runtimeSelect.outbounds).toContain('US-01 [via 前置代理]')
    expect(byTag.get('US-01 [via 前置代理]')!.detour).toBe('前置代理')
    expect(byTag.get('HK-01')).not.toHaveProperty('detour')

    // Clearing removes managed pre-proxy cleanly
    clearHomePreProxy(profile)
    expect(select.pre_proxy).toBe('')
    expect(profile.outbounds.some((o) => o.id === HOME_PRE_PROXY_OUTBOUND_ID)).toBe(false)
  })

  it('resolves active pre-proxy states for direct, active node, and node-group via-chain', () => {
    const profile = createProfile()
    const select = profile.outbounds.find((o) => o.id === 'outbound-select')!
    applyHomePreProxyNode(profile, { subscriptions: [], preProxyLabel: '前置代理' })

    const directState = resolveActivePreProxyState(profile, {
      前置代理: {
        name: '前置代理',
        type: 'Selector',
        all: ['direct', 'HK-01'],
        now: 'direct',
        alive: true,
        udp: false,
        history: [],
      },
      direct: { name: 'direct', type: 'Direct', all: [], now: '', alive: true, udp: false, history: [] },
    })
    expect(directState.status).toBe('direct')
    expect(directState.canHotSwitch).toBe(true)
    expect(directState.hasDirectOption).toBe(true)
    expect(directState.isManagedHomePreProxy).toBe(true)

    const activeState = resolveActivePreProxyState(profile, {
      前置代理: {
        name: '前置代理',
        type: 'Selector',
        all: ['direct', 'HK-01'],
        now: 'HK-01',
        alive: true,
        udp: false,
        history: [],
      },
      'HK-01': { name: 'HK-01', type: 'Trojan', all: [], now: '', alive: true, udp: true, history: [] },
    })
    expect(activeState.status).toBe('active')
    expect(activeState.nodeName).toBe('HK-01')

    // Node-group implicit via-group detection when primary.pre_proxy is empty
    select.pre_proxy = ''
    const viaState = resolveActivePreProxyState(
      profile,
      {
        'Relay · Pre-proxy': {
          name: 'Relay · Pre-proxy',
          type: 'Selector',
          all: ['HK-01'],
          now: 'HK-01',
          alive: true,
          udp: false,
          history: [],
        },
        'HK-01': { name: 'HK-01', type: 'Trojan', all: [], now: '', alive: true, udp: true, history: [] },
      },
      'Landing-01 [via Relay · Pre-proxy]',
    )
    expect(viaState.status).toBe('active')
    expect(viaState.groupName).toBe('Relay · Pre-proxy')
    expect(viaState.nodeName).toBe('HK-01')
    expect(viaState.canHotSwitch).toBe(true)
  })

  it('applies node-group pre-proxy, restores exit tags, and blocks direct/block members in primary', () => {
    const profile = createProfile()
    const ng = { ...DefaultNodeGroup(), id: 'ng-hk', name: 'HK Relay' }
    mockNodeGroups.push(ng)

    const { preProxyTag } = applyHomePreProxyNodeGroup(profile, ng, 'auto', 'Auto', mockNodeGroups)
    expect(preProxyTag).toBe('HK Relay · Auto')

    expect(stripViaSuffix('US-01 [via 前置代理]')).toBe('US-01')
    expect(findRuntimeNodeTag(['direct', 'HK-01 [SubA]'], 'HK-01', 'SubA')).toBe('HK-01 [SubA]')
    expect(
      findRestoredExitNodeTag(['US-01 [via 前置代理]', 'JP-01 [via 前置代理]'], 'US-01', '前置代理'),
    ).toBe('US-01 [via 前置代理]')
    expect(findRestoredExitNodeTag(['US-01', 'JP-01'], 'US-01 [via 前置代理]', '')).toBe('US-01')

    const badProfile = createProfile()
    badProfile.outbounds
      .find((o) => o.id === 'outbound-select')!
      .outbounds.push({ id: Outbound.Direct, tag: 'direct', type: 'Built-in' })
    expect(() =>
      applyHomePreProxyNode(badProfile, { subscriptions: [], preProxyLabel: '前置代理' }),
    ).toThrow('home.nodes.preProxyDirectMemberConflict')
  })
})
