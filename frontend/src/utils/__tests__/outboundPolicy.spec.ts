import { describe, expect, it, vi } from 'vitest'

import { DefaultOutboundIds } from '@/constant/outbound'
import { migrateProfiles } from '@/utils/migration'
import {
  findOutboundGraphIssues,
  getOutboundRole,
  getPrimaryProxyOutbound,
  resolveConfiguredOutboundChain,
  setInitialOutboundTarget,
} from '@/utils/outboundPolicy'

const group = (
  id: string,
  tag: string,
  outbounds: App.Proxy[] = [],
  role?: App.OutboundRole,
): App.Outbound => ({
  id,
  tag,
  type: 'selector',
  role,
  outbounds,
  url: '',
  interval: '3m',
  tolerance: 150,
  interrupt_exist_connections: true,
  include: '',
  exclude: '',
  icon: '',
  hidden: false,
})

describe('outbound policy model', () => {
  it('infers stable default roles and resolves the configured primary proxy group', () => {
    const proxy = group(DefaultOutboundIds.Select, 'Proxy')
    const fallback = group(DefaultOutboundIds.Fallback, 'Fallback')
    const profile = {
      primary_proxy_outbound: proxy.id,
      outbounds: [fallback, proxy],
    }

    expect(getOutboundRole(proxy)).toBe('proxy')
    expect(getOutboundRole(fallback)).toBe('fallback')
    expect(getPrimaryProxyOutbound(profile)?.id).toBe(proxy.id)
  })

  it('detects missing and circular group references', () => {
    const a = group('a', 'A', [
      { id: 'b', tag: 'B', type: 'Built-in' },
      { id: 'missing', tag: 'Missing', type: 'Built-in' },
    ])
    const b = group('b', 'B', [{ id: 'a', tag: 'A', type: 'Built-in' }])

    expect(
      findOutboundGraphIssues([a, b])
        .map((issue) => issue.type)
        .sort(),
    ).toEqual(['cycle', 'missing'])
  })

  it('reports missing node groups without treating them as strategy cycles', () => {
    const a = group('a', 'A', [
      { id: 'a', tag: 'Existing collection', type: 'NodeGroup' },
      { id: 'missing-group', tag: 'Missing collection', type: 'NodeGroup' },
    ])

    expect(findOutboundGraphIssues([a], [{ id: 'a' }])).toEqual([
      {
        type: 'missing-node-group',
        groupId: 'a',
        targetId: 'missing-group',
        chain: ['a', 'missing-group'],
      },
    ])
  })

  it('resolves the configured initial chain and reorders semantic targets', () => {
    const direct = group('direct-group', 'Direct', [
      { id: 'direct', tag: 'direct', type: 'Built-in' },
    ])
    const fallback = group('fallback', 'Fallback', [
      { id: direct.id, tag: direct.tag, type: 'Built-in' },
      { id: 'proxy', tag: 'Proxy', type: 'Built-in' },
    ])
    const proxy = group('proxy', 'Proxy')

    expect(resolveConfiguredOutboundChain(fallback.id, [fallback, direct, proxy]).labels).toEqual([
      'Fallback',
      'Direct',
      'direct',
    ])

    setInitialOutboundTarget(fallback, proxy.id, proxy.tag)
    expect(fallback.outbounds[0]).toMatchObject({ id: 'proxy', tag: 'Proxy' })
  })

  it('migrates legacy profiles without renaming runtime tags', async () => {
    const proxy = group(DefaultOutboundIds.Select, '🚀 Legacy Proxy')
    delete proxy.role
    const profile = {
      outbounds: [proxy],
      route: { rules: [] },
      dns: { rules: [] },
    } as unknown as App.Profile
    const save = vi.fn().mockResolvedValue('ok')

    await migrateProfiles([profile], save)

    expect(proxy.role).toBe('proxy')
    expect(proxy.tag).toBe('🚀 Legacy Proxy')
    expect(profile.primary_proxy_outbound).toBe(DefaultOutboundIds.Select)
    expect(save).toHaveBeenCalledOnce()
  })
})
