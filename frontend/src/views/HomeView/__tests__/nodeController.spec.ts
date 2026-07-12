import { describe, expect, it } from 'vitest'

import {
  classifyDelayError,
  filterAndSortNodes,
  getDelayTestableNodeNames,
  isDelayTestableNode,
  getVisibleGroups,
  resolvePrimaryNode,
  resolveProxyChain,
} from '@/views/HomeView/nodeController'

import type { CoreApiProxy } from '@/types/kernel'

const proxy = (
  value: Partial<CoreApiProxy> & Pick<CoreApiProxy, 'name' | 'type'>,
): CoreApiProxy => ({
  alive: true,
  all: [],
  now: '',
  udp: false,
  history: [],
  ...value,
})

const proxies: Record<string, CoreApiProxy> = {
  GLOBAL: proxy({ name: 'GLOBAL', type: 'Selector', all: ['Proxy', 'direct'], now: 'Proxy' }),
  Proxy: proxy({ name: 'Proxy', type: 'Selector', all: ['Auto', 'HK 01'], now: 'Auto' }),
  Auto: proxy({ name: 'Auto', type: 'URLTest', all: ['HK 01', 'JP 01'], now: 'HK 01' }),
  'HK 01': proxy({ name: 'HK 01', type: 'VLESS', udp: true, history: [{ delay: 86 }] }),
  'JP 01': proxy({ name: 'JP 01', type: 'Trojan' }),
  direct: proxy({ name: 'direct', type: 'Direct' }),
}

const profile = {
  route: { final: 'proxy-id' },
  outbounds: [
    { id: 'proxy-id', tag: 'Proxy', hidden: false },
    { id: 'auto-id', tag: 'Auto', hidden: false },
    { id: 'hidden-id', tag: 'Hidden', hidden: true },
  ],
} as Pick<IProfile, 'route' | 'outbounds'>

describe('resolvePrimaryNode', () => {
  it('uses GLOBAL in global mode', () => {
    const result = resolvePrimaryNode('global', profile, proxies)

    expect(result.kind).toBe('group')
    expect(result.groupName).toBe('GLOBAL')
    expect(result.chain).toEqual(['GLOBAL', 'Proxy', 'Auto', 'HK 01'])
    expect(result.leafName).toBe('HK 01')
    expect(result.delay).toBe(86)
  })

  it('returns a read-only direct state in direct mode', () => {
    expect(resolvePrimaryNode('direct', profile, proxies)).toMatchObject({
      kind: 'direct',
      groupName: 'direct',
      chain: ['direct'],
      leafName: 'direct',
      readonly: true,
    })
  })

  it('maps route.final id to the first Selector in rule mode', () => {
    const result = resolvePrimaryNode('rule', profile, proxies)

    expect(result.groupName).toBe('Proxy')
    expect(result.chain).toEqual(['Proxy', 'Auto', 'HK 01'])
  })

  it('falls back to the first visible non-GLOBAL Selector', () => {
    const missingProfile = {
      ...profile,
      route: { final: 'missing-id' },
    } as Pick<IProfile, 'route' | 'outbounds'>

    expect(resolvePrimaryNode('rule', missingProfile, proxies).groupName).toBe('Proxy')
  })

  it('does not expose a hidden route selector as the primary group', () => {
    const hiddenProfile = {
      ...profile,
      route: { final: 'hidden-id' },
    } as Pick<IProfile, 'route' | 'outbounds'>
    const values = {
      ...proxies,
      Hidden: proxy({ name: 'Hidden', type: 'Selector', all: ['HK 01'], now: 'HK 01' }),
    }

    expect(resolvePrimaryNode('rule', hiddenProfile, values).groupName).toBe('Proxy')
  })

  it('returns unavailable when no Selector can be discovered', () => {
    expect(resolvePrimaryNode('rule', profile, { direct: proxies.direct! })).toMatchObject({
      kind: 'unavailable',
      readonly: true,
      chain: [],
    })
  })
})

describe('resolveProxyChain', () => {
  it('returns a partial result for a missing now target', () => {
    const broken = {
      ...proxies,
      Proxy: proxy({ name: 'Proxy', type: 'Selector', all: ['Missing'], now: 'Missing' }),
    }

    expect(resolveProxyChain('Proxy', broken)).toMatchObject({
      chain: ['Proxy', 'Missing'],
      error: 'missing',
    })
  })

  it('stops circular selector references', () => {
    const circular = {
      A: proxy({ name: 'A', type: 'Selector', all: ['B'], now: 'B' }),
      B: proxy({ name: 'B', type: 'Selector', all: ['A'], now: 'A' }),
    }

    expect(resolveProxyChain('A', circular)).toMatchObject({
      chain: ['A', 'B'],
      error: 'cycle',
    })
  })
})

describe('getVisibleGroups', () => {
  it('keeps GLOBAL as a system group and excludes hidden groups', () => {
    const groups = getVisibleGroups('rule', profile, {
      ...proxies,
      Hidden: proxy({ name: 'Hidden', type: 'Selector' }),
    })

    expect(groups.map((group) => group.name)).toEqual(['Proxy', 'Auto', 'GLOBAL'])
  })

  it('moves GLOBAL to the front in global mode', () => {
    expect(getVisibleGroups('global', profile, proxies)[0]?.name).toBe('GLOBAL')
  })
})

describe('filterAndSortNodes', () => {
  it('filters case-insensitively and sorts valid latency before untested nodes', () => {
    const nodes = filterAndSortNodes(proxies.Auto!, proxies, '0', true, new Map())

    expect(nodes.map((node) => node.name)).toEqual(['HK 01', 'JP 01'])
    expect(nodes.map((node) => node.delayStatus)).toEqual(['success', 'untested'])
  })

  it('marks zero-delay history as unavailable', () => {
    const failed = {
      ...proxies,
      'JP 01': proxy({ name: 'JP 01', type: 'Trojan', history: [{ delay: 0 }] }),
    }

    const nodes = filterAndSortNodes(proxies.Auto!, failed, '', false, new Map())
    expect(nodes[1]).toMatchObject({ name: 'JP 01', delayStatus: 'failed' })
  })

  it('marks local errors as unavailable', () => {
    const error = {
      category: 'timeout',
      message: 'deadline exceeded',
      attempts: 3,
      maxAttempts: 3,
    } as const
    const errors = new Map([['JP 01', error]])
    const nodes = filterAndSortNodes(proxies.Auto!, proxies, '', false, errors)

    expect(nodes[1]).toMatchObject({
      name: 'JP 01',
      delayStatus: 'failed',
      error,
    })
  })

  it('includes the successful attempt count', () => {
    const nodes = filterAndSortNodes(
      proxies.Auto!,
      proxies,
      '',
      false,
      new Map(),
      new Map([['JP 01', 120]]),
      new Map([['JP 01', 2]]),
    )

    expect(nodes[1]).toMatchObject({
      name: 'JP 01',
      delay: 120,
      delayStatus: 'success',
      attempts: 2,
    })
  })

  it('keeps original order when valid delays are equal', () => {
    const equal = {
      ...proxies,
      'JP 01': proxy({ name: 'JP 01', type: 'Trojan', history: [{ delay: 86 }] }),
    }
    const nodes = filterAndSortNodes(proxies.Auto!, equal, '', true, new Map())

    expect(nodes.map((node) => node.name)).toEqual(['HK 01', 'JP 01'])
  })
})

describe('classifyDelayError', () => {
  it('classifies uppercase ASCII keywords independently of locale', () => {
    expect(classifyDelayError('TIMEOUT')).toBe('timeout')
    expect(classifyDelayError('NXDOMAIN')).toBe('dns')
  })

  it.each([
    ['LOOKUP example.com failed', 'dns'],
    ['no such host', 'dns'],
    ['NXDOMAIN', 'dns'],
    ['Authentication failed', 'authentication'],
    ['UNAUTHORIZED', 'authentication'],
    ['TLS handshake failed', 'tls'],
    ['x509 CERTIFICATE expired', 'tls'],
    ['Reality verification failed', 'tls'],
    ['CONNECTION REFUSED', 'connection-refused'],
    ['Network is unreachable', 'network-unreachable'],
    ['NO ROUTE to host', 'network-unreachable'],
    ['RESET BY PEER', 'connection-reset'],
    ['unexpected EOF', 'connection-reset'],
    ['request TIMEOUT', 'timeout'],
    ['Deadline Exceeded', 'timeout'],
    ['generic transport failure', 'unknown'],
  ] as const)('classifies %s as %s', (message, category) => {
    expect(classifyDelayError(message)).toBe(category)
  })
})

describe('delay test filtering', () => {
  it('filters out reject nodes and subscription info placeholders', () => {
    const values: Record<string, CoreApiProxy> = {
      ...proxies,
      block: proxy({ name: 'block', type: 'Reject' }),
      '剩余流量：959.91 GB': proxy({ name: '剩余流量：959.91 GB', type: 'VLESS' }),
      Proxy: proxy({
        name: 'Proxy',
        type: 'Selector',
        all: ['Auto', '剩余流量：959.91 GB', 'block', 'HK 01'],
        now: 'Auto',
      }),
    }

    expect(isDelayTestableNode('HK 01', values['HK 01'])).toBe(true)
    expect(isDelayTestableNode('Auto', values.Auto)).toBe(true)
    expect(isDelayTestableNode('block', values.block)).toBe(false)
    expect(isDelayTestableNode('剩余流量：959.91 GB', values['剩余流量：959.91 GB'])).toBe(false)
    expect(getDelayTestableNodeNames(values.Proxy!, values)).toEqual(['Auto', 'HK 01'])
  })
})
