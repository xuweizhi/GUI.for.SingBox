import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import fs from 'node:fs'
import path from 'node:path'

const captured = vi.fn()
const mockDnsQuery = vi.fn()
const mockGetConnections = vi.fn()
const mockGetProxyDelay = vi.fn()
const mockRefreshConfig = vi.fn()
const mockRefreshProviderProxies = vi.fn()
const mockGetProxyEndpoint = vi.fn()

const kernelApiStore = {
  running: true,
  proxies: {} as Record<string, unknown>,
  config: { mode: 'rule' },
  refreshConfig: mockRefreshConfig,
  refreshProviderProxies: mockRefreshProviderProxies,
  getProxyEndpoint: mockGetProxyEndpoint,
}

const profilesStore = {
  currentProfile: undefined as App.Profile | undefined,
}

const rulesetsStore = {
  rulesets: [] as App.RuleSet[],
}

const appSettingsStore = {
  app: {
    kernel: {
      testUrl: 'https://probe.example',
      testTimeout: 7000,
    },
  },
}

vi.mock('@/views/NetCheckView/useNetworkCheck', () => ({
  useNetworkCheck: (deps: unknown) => {
    captured(deps)
    return {
      input: ref('https://example.com'),
      running: ref(false),
      groups: ref([]),
      clear: vi.fn(),
      run: vi.fn(),
    }
  },
}))

vi.mock('@/api/kernel', () => ({
  dnsQuery: mockDnsQuery,
  getConnections: mockGetConnections,
  getProxyDelay: mockGetProxyDelay,
}))

vi.mock('@/constant/app', () => ({
  DefaultTestURL: 'https://www.gstatic.com/generate_204',
  DefaultTestTimeout: 5000,
}))

vi.mock('@/stores/kernelApi', () => ({
  useKernelApiStore: () => kernelApiStore,
}))

vi.mock('@/stores/profiles', () => ({
  useProfilesStore: () => profilesStore,
}))

vi.mock('@/stores/rulesets', () => ({
  useRulesetsStore: () => rulesetsStore,
}))

vi.mock('@/stores/appSettings', () => ({
  useAppSettingsStore: () => appSettingsStore,
}))

const mockResolvePrimaryNode = vi.fn()

vi.mock('@/views/HomeView/nodeController', () => ({
  resolvePrimaryNode: mockResolvePrimaryNode,
}))

const { useRuntimeNetworkCheck } = await import('@/views/NetCheckView/useRuntimeNetworkCheck')

describe('useRuntimeNetworkCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    kernelApiStore.running = true
    kernelApiStore.proxies = {}
    kernelApiStore.config = { mode: 'rule' }

    profilesStore.currentProfile = undefined
    rulesetsStore.rulesets = []
    appSettingsStore.app.kernel.testUrl = 'https://probe.example'
    appSettingsStore.app.kernel.testTimeout = 7000

    mockDnsQuery.mockResolvedValue({
      Server: '1.1.1.1',
      Status: 0,
      Answer: [{ data: '93.184.216.34', name: 'example.com', type: 1, TTL: 60 }],
    })
    mockGetConnections.mockResolvedValue({ connections: [] })
    mockGetProxyDelay.mockResolvedValue({ delay: 88 })
    mockResolvePrimaryNode.mockReturnValue({
      kind: 'group',
      groupName: 'Proxy',
      leafName: 'HK 01',
      chain: ['Proxy', 'HK 01'],
      delay: 32,
    })
  })

  it('wires dnsQuery, rule matching and ruleset state providers', async () => {
    useRuntimeNetworkCheck()
    const deps = captured.mock.calls[0]?.[0]
    expect(typeof deps.dnsQuery).toBe('function')
    expect(typeof deps.getLatestRuleMatch).toBe('function')
    expect(typeof deps.getRulesetStates).toBe('function')
  })

  it('normalizes dns query responses for useNetworkCheck deps', async () => {
    useRuntimeNetworkCheck()
    const deps = captured.mock.calls[0]?.[0]

    await expect(deps.dnsQuery('example.com')).resolves.toEqual({
      server: '1.1.1.1',
      status: 0,
      answers: ['93.184.216.34'],
    })
    expect(mockDnsQuery).toHaveBeenCalledWith('example.com')
  })

  it('derives the latest rule match from connection records', async () => {
    mockGetConnections.mockResolvedValue({
      connections: [
        {
          id: 'old',
          chains: ['Proxy', 'US 01'],
          download: 0,
          upload: 0,
          rule: 'MATCH',
          rulePayload: '',
          start: '2026-07-05T10:00:00.000Z',
          metadata: {
            host: 'example.com',
            destinationIP: '93.184.216.34',
            destinationPort: '443',
            dnsMode: '',
            network: 'tcp',
            processPath: '',
            sourceIP: '',
            sourcePort: '',
            type: 'http',
          },
        },
        {
          id: 'latest',
          chains: ['Proxy', 'HK 01'],
          download: 0,
          upload: 0,
          rule: 'final => route(Proxy)',
          rulePayload: '',
          start: '2026-07-05T10:01:00.000Z',
          metadata: {
            host: 'example.com',
            destinationIP: '93.184.216.34',
            destinationPort: '443',
            dnsMode: '',
            network: 'tcp',
            processPath: '',
            sourceIP: '',
            sourcePort: '',
            type: 'http',
          },
        },
      ],
    })

    useRuntimeNetworkCheck()
    const deps = captured.mock.calls[0]?.[0]

    await expect(
      deps.getLatestRuleMatch({
        requestHost: 'example.com',
        tcpPort: 443,
      }),
    ).resolves.toEqual({
      host: 'example.com',
      port: 443,
      rule: 'final => route(Proxy)',
      chains: ['Proxy', 'HK 01'],
    })
  })

  it('builds ruleset states from profile and rulesets stores', async () => {
    profilesStore.currentProfile = {
      route: {
        rule_set: [
          {
            id: 'rs-local',
            type: 'local',
            path: '/etc/sing-box/rules/local.srs',
            tag: 'Local RS',
          },
        ],
      },
    } as App.Profile
    rulesetsStore.rulesets = [
      {
        id: '/etc/sing-box/rules/local.srs',
        name: 'GeoIP-CN',
        path: '/etc/sing-box/rules/local.srs',
        count: 123,
      },
    ] as App.RuleSet[]

    useRuntimeNetworkCheck()
    const deps = captured.mock.calls[0]?.[0]

    await expect(deps.getRulesetStates()).resolves.toEqual([
      {
        id: 'ruleset-rs-local',
        title: 'GeoIP-CN',
        status: 'success',
        summary: '123 rules',
        detail: '/etc/sing-box/rules/local.srs',
      },
    ])
  })

  it('keeps dynamic bridge imports for desktop-only bridge code', () => {
    const source = fs.readFileSync(
      path.resolve('src/views/NetCheckView/useRuntimeNetworkCheck.ts'),
      'utf8',
    )

    expect(source).not.toContain("import * as Bridge from '@/bridge/wailsjs/go/bridge/App'")
    expect(source).toContain("import('@/bridge/browser/go/bridge/App')")
    expect(source).toContain("import('@/bridge/wailsjs/go/bridge/App')")
  })
})
