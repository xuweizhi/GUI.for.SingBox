import { effectScope } from 'vue'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { useNetworkCheck } from '@/views/NetCheckView/useNetworkCheck'

const mocks = {
  probeApiAvailability: vi.fn(),
  httpHead: vi.fn(),
  httpGet: vi.fn(),
  tcpPing: vi.fn(),
  getKernelProxyEndpoint: vi.fn(),
}

describe('useNetworkCheck', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('runs core, proxy and tcp checks in order', async () => {
    mocks.probeApiAvailability.mockResolvedValue({ version: 'ok' })
    mocks.getKernelProxyEndpoint.mockResolvedValue({
      schema: 'http',
      host: '127.0.0.1',
      port: 7890,
      username: '',
      password: '',
      proxyType: 'mixed',
    })
    mocks.httpHead.mockResolvedValue({ status: 204, headers: {}, body: '' })
    mocks.tcpPing.mockResolvedValue(86)

    const scope = effectScope()
    const vm = scope.run(() => useNetworkCheck(mocks))!

    await vm.run('https://example.com')

    expect(vm.results.value.map((item) => item.id)).toEqual(['core', 'proxy-http', 'tcp'])
    expect(vm.results.value[0]).toMatchObject({ status: 'success' })
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

  it('skips proxy http when core is unavailable but still runs tcp', async () => {
    mocks.probeApiAvailability.mockRejectedValue(new Error('offline'))
    mocks.tcpPing.mockResolvedValue(120)

    const scope = effectScope()
    const vm = scope.run(() => useNetworkCheck(mocks))!

    await vm.run('example.com')

    expect(vm.results.value[0]).toMatchObject({ id: 'core', status: 'failed' })
    expect(vm.results.value[1]).toMatchObject({ id: 'proxy-http', status: 'skipped' })
    expect(vm.results.value[2]).toMatchObject({ id: 'tcp', status: 'success' })
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
      proxyType: 'mixed',
    })
    mocks.httpHead.mockRejectedValue({ status: 405, message: 'Method Not Allowed' })
    mocks.httpGet.mockResolvedValue({ status: 200, headers: {}, body: '' })
    mocks.tcpPing.mockResolvedValue(42)

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
