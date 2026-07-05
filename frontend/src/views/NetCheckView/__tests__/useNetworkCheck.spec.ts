import { effectScope } from 'vue'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { useNetworkCheck } from '@/views/NetCheckView/useNetworkCheck'

const mocks = {
  probeApiAvailability: vi.fn(),
  httpHead: vi.fn(),
  httpGet: vi.fn(),
  tcpPing: vi.fn(),
  getKernelProxyEndpoint: vi.fn(),
  dnsQuery: vi.fn(),
  getPrimaryOutboundState: vi.fn(),
  getLatestRuleMatch: vi.fn(),
  getRulesetStates: vi.fn(),
}

describe('useNetworkCheck', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('builds the four result groups for a domain target', async () => {
    mocks.probeApiAvailability.mockResolvedValue({ version: 'ok' })
    mocks.getKernelProxyEndpoint.mockResolvedValue({
      schema: 'http',
      host: '127.0.0.1',
      port: 7890,
      username: '',
      password: '',
    })
    mocks.httpHead.mockResolvedValue({ status: 204, headers: {}, body: '' })
    mocks.tcpPing.mockResolvedValue(86)
    mocks.dnsQuery.mockResolvedValue({
      server: 'internal',
      status: 0,
      answers: ['142.250.129.94'],
    })
    mocks.getPrimaryOutboundState.mockResolvedValue({
      mode: 'group',
      groupName: 'Proxy',
      leafName: 'HK 01',
      chain: ['Proxy', 'HK 01'],
      delay: 80,
    })
    mocks.getLatestRuleMatch.mockResolvedValue({
      host: 'example.com',
      port: 443,
      rule: 'final => route(Proxy)',
      chains: ['Proxy', 'HK 01'],
    })
    mocks.getRulesetStates.mockResolvedValue([
      { id: 'rs-1', title: 'GeoIP-CN', status: 'success', summary: '100 rules' },
    ])

    const scope = effectScope()
    const vm = scope.run(() => useNetworkCheck(mocks))!

    await vm.run('https://example.com')

    expect(vm.groups.value.map((group) => group.id)).toEqual(['overview', 'dns', 'outbound', 'rulesets'])
    expect(vm.groups.value[0]).toMatchObject({ status: 'success' })
    expect(vm.groups.value[0]?.items.map((item) => item.id)).toEqual(['core', 'proxy-http', 'tcp'])
    expect(vm.groups.value[1]?.items[0]).toMatchObject({
      id: 'dns-query',
      status: 'success',
      summary: '142.250.129.94',
    })
    expect(vm.groups.value[2]?.items).toMatchObject([
      { id: 'primary-outbound', status: 'success' },
      { id: 'rule-match', status: 'success' },
    ])
    expect(mocks.getLatestRuleMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        requestHost: 'example.com',
        tcpPort: 443,
        targetKind: 'domain',
      }),
    )
    expect(vm.groups.value[3]?.items[0]).toMatchObject({
      id: 'rs-1',
      status: 'success',
      summary: '100 rules',
    })
    expect(vm.results.value.map((item) => item.id)).toEqual(['core', 'proxy-http', 'tcp'])
    expect(vm.results.value[1]).toMatchObject({
      status: 'success',
      summary: 'HEAD https://example.com/ -> 204',
    })
    expect(vm.results.value[2]).toMatchObject({
      status: 'success',
      summary: 'example.com:443, 86 ms',
    })
    scope.stop()
  })

  it('skips DNS when the target is an IP literal', async () => {
    mocks.probeApiAvailability.mockResolvedValue({ version: 'ok' })
    mocks.getKernelProxyEndpoint.mockResolvedValue({
      schema: 'http',
      host: '127.0.0.1',
      port: 7890,
      username: '',
      password: '',
    })
    mocks.httpHead.mockResolvedValue({ status: 204, headers: {}, body: '' })
    mocks.tcpPing.mockResolvedValue(120)
    mocks.getRulesetStates.mockResolvedValue([])

    const scope = effectScope()
    const vm = scope.run(() => useNetworkCheck(mocks))!

    await vm.run('1.1.1.1')

    expect(vm.groups.value.find((group) => group.id === 'dns')?.items[0]).toMatchObject({
      id: 'dns-query',
      status: 'skipped',
    })
    expect(mocks.dnsQuery).not.toHaveBeenCalled()
    scope.stop()
  })

  it('keeps only overview items in results when new deps are missing', async () => {
    mocks.probeApiAvailability.mockResolvedValue({ version: 'ok' })
    mocks.getKernelProxyEndpoint.mockResolvedValue({
      schema: 'http',
      host: '127.0.0.1',
      port: 7890,
      username: '',
      password: '',
    })
    mocks.httpHead.mockResolvedValue({ status: 204, headers: {}, body: '' })
    mocks.tcpPing.mockResolvedValue(33)

    const scope = effectScope()
    const vm = scope.run(() =>
      useNetworkCheck({
        probeApiAvailability: mocks.probeApiAvailability,
        getKernelProxyEndpoint: mocks.getKernelProxyEndpoint,
        httpHead: mocks.httpHead,
        httpGet: mocks.httpGet,
        tcpPing: mocks.tcpPing,
      }),
    )!

    await vm.run('example.com')

    expect(vm.groups.value.map((group) => group.id)).toEqual(['overview', 'dns', 'outbound', 'rulesets'])
    expect(vm.groups.value.find((group) => group.id === 'dns')?.items[0]).toMatchObject({ status: 'skipped' })
    expect(vm.groups.value.find((group) => group.id === 'outbound')?.items).toMatchObject([
      { id: 'primary-outbound', status: 'skipped' },
      { id: 'rule-match', status: 'skipped' },
    ])
    expect(vm.groups.value.find((group) => group.id === 'rulesets')?.items[0]).toMatchObject({
      status: 'skipped',
    })
    expect(vm.results.value.map((item) => item.id)).toEqual(['core', 'proxy-http', 'tcp'])
    scope.stop()
  })

  it('falls back to GET when HEAD returns 405', async () => {
    mocks.probeApiAvailability.mockResolvedValue({ version: 'ok' })
    mocks.getKernelProxyEndpoint.mockResolvedValue({
      schema: 'http',
      host: '127.0.0.1',
      port: 7890,
      username: '',
      password: '',
    })
    mocks.httpHead.mockRejectedValue({ status: 405, message: 'Method Not Allowed' })
    mocks.httpGet.mockResolvedValue({ status: 200, headers: {}, body: '' })
    mocks.tcpPing.mockResolvedValue(42)
    mocks.getRulesetStates.mockResolvedValue([])

    const scope = effectScope()
    const vm = scope.run(() => useNetworkCheck(mocks))!

    await vm.run('example.com')

    expect(mocks.httpGet).toHaveBeenCalledTimes(1)
    expect(vm.results.value[1]).toMatchObject({
      status: 'success',
      summary: 'GET https://example.com/ -> 200',
    })
    scope.stop()
  })
})
