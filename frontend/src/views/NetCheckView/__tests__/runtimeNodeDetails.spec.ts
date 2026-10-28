import { describe, expect, it } from 'vitest'

import { resolveRuntimeNodeDetails } from '../runtimeNodeDetails'

describe('runtime node DNS and transport details', () => {
  it('uses the selected node resolver rather than the website DNS final', () => {
    const config = {
      outbounds: [{ tag: 'HK', type: 'socks', domain_resolver: { server: 'subscription-a' } }],
      dns: {
        servers: [{ tag: 'subscription-a', type: 'https', server: 'dns.example' }],
        final: 'website',
      },
      route: { default_domain_resolver: 'system' },
    }
    expect(resolveRuntimeNodeDetails(config, 'HK')).toMatchObject({
      resolver: 'subscription-a',
      resolverAddress: 'https dns.example',
      kind: 'outbound',
    })
  })

  it('identifies endpoints and default resolver fallback', () => {
    expect(
      resolveRuntimeNodeDetails(
        {
          endpoints: [{ tag: 'WG', type: 'wireguard' }],
          route: { default_domain_resolver: { server: 'bootstrap' } },
          dns: { servers: [{ tag: 'bootstrap', type: 'local' }] },
        },
        'WG',
      ),
    ).toMatchObject({ kind: 'endpoint', resolver: 'bootstrap', resolverAddress: 'local' })
  })

  it('follows runtime selections through multiple upstreams without claiming ignored DNS', () => {
    const details = resolveRuntimeNodeDetails(
      {
        outbounds: [
          { tag: 'landing', type: 'socks', detour: 'relay', domain_resolver: 'ignored' },
          { tag: 'relay', type: 'urltest', outbounds: ['first', 'chosen'] },
          { tag: 'chosen', type: 'socks', detour: 'entry' },
          { tag: 'entry', type: 'socks' },
        ],
      },
      'landing',
      { relay: { now: 'chosen' } },
    )
    expect(details).toEqual({
      kind: 'outbound',
      via: 'relay',
      chain: ['entry', 'chosen', 'landing'],
      incomplete: false,
    })
    expect(details?.resolver).toBeUndefined()
  })

  it('does not guess a strategy selection and terminates cycles', () => {
    const config = {
      outbounds: [
        { tag: 'node', type: 'socks', detour: 'group' },
        { tag: 'group', type: 'selector', outbounds: ['node'] },
      ],
    }
    expect(resolveRuntimeNodeDetails(config, 'node')).toMatchObject({
      incomplete: true,
      chain: ['node'],
    })
    expect(resolveRuntimeNodeDetails(config, 'node', { group: { now: 'node' } })).toMatchObject({
      incomplete: true,
      chain: ['node'],
    })
  })

  it('never exposes DNS URL credentials and does not invent missing nodes', () => {
    const config = {
      outbounds: [{ tag: 'node', type: 'socks' }],
      dns: { servers: [{ tag: 'only', address: 'https://alice:secret@dns.example/query' }] },
    }
    expect(resolveRuntimeNodeDetails(config, 'node')?.resolverAddress).toBe(
      'https://dns.example/query',
    )
    expect(resolveRuntimeNodeDetails(config, 'absent')).toBeUndefined()
  })
})
