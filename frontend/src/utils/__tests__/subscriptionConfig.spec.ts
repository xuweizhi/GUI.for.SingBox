import { describe, expect, it } from 'vitest'

import { isValidSubJson } from '@/utils/is'
import {
  extractSubscriptionConfig,
  isSubscriptionEndpoint,
  parseSubscriptionDnsAddresses,
  stripSubscriptionMetadata,
  subscriptionConfigForEditing,
} from '@/utils/subscriptionConfig'
import { normalizeSubscriptionProxies } from '@/utils/subscriptionConvert'
import { reconcileSubscriptionProxyIds } from '@/utils/subscriptionIdentity'

const wireguard = {
  type: 'wireguard',
  tag: 'WG',
  address: ['10.0.0.2/32'],
  private_key: 'private',
  peers: [
    {
      address: 'vpn.example',
      port: 51820,
      public_key: 'public',
      allowed_ips: ['0.0.0.0/0'],
      reserved: [1, 2, 3],
    },
  ],
  mtu: 1408,
}

describe('subscription configuration import and editing', () => {
  it('accepts endpoints-only subscriptions without dropping unknown protocol fields', async () => {
    const source = {
      endpoints: [wireguard, { type: 'future-vpn', tag: 'Future', nested: { field: [1, 2] } }],
    }
    expect(isValidSubJson(JSON.stringify(source))).toBe(true)
    const imported = extractSubscriptionConfig(source)
    expect(imported.outbounds).toEqual(
      source.endpoints.map((entry) => ({ ...entry, _gui_kind: 'endpoint' })),
    )
    expect(await normalizeSubscriptionProxies(imported.outbounds)).toEqual(imported.outbounds)
  })

  it('roundtrips mixed endpoint protocols and DNS through the editor and cache', () => {
    const source = {
      outbounds: [
        {
          type: 'vless',
          tag: 'VLESS',
          server: 'node.example',
          tls: { enabled: true, reality: { public_key: 'key' } },
        },
      ],
      endpoints: [
        wireguard,
        {
          type: 'tailscale',
          tag: 'TS',
          state_directory: 'data/ts',
          auth_key: 'secret',
          advertise_routes: ['10.0.0.0/24'],
        },
      ],
      dns: {
        servers: [{ type: 'https', tag: 'private-dns', server: 'dns.example', path: '/dns-query' }],
        final: 'private-dns',
        rules: [{ domain: ['website.example'], server: 'private-dns' }],
      },
      route: { rules: [{ action: 'reject' }] },
    }
    const imported = extractSubscriptionConfig(source)
    const text = JSON.stringify(
      subscriptionConfigForEditing(imported.outbounds, imported.importedDns),
    )
    const saved = extractSubscriptionConfig(JSON.parse(text))
    const reloaded = extractSubscriptionConfig(JSON.parse(JSON.stringify(saved.outbounds)))
    expect(reloaded.outbounds).toEqual(imported.outbounds)
    expect(saved.importedDns).toEqual(imported.importedDns)
    expect(JSON.parse(text)).not.toHaveProperty('route')
    expect(JSON.parse(text).dns).not.toHaveProperty('rules')
    expect(
      reloaded.outbounds.filter(isSubscriptionEndpoint).map(stripSubscriptionMetadata),
    ).toEqual(source.endpoints)
  })

  it.each([
    { endpoints: {} },
    { endpoints: [null] },
    { endpoints: [{ tag: 'x' }] },
    { outbounds: [], endpoints: 'wrong' },
    { endpoints: [{ type: 'wireguard', tag: '' }] },
    { outbounds: [], dns: { servers: 'wrong' } },
  ])('rejects malformed configuration %j', (value) => {
    expect(() => extractSubscriptionConfig(value)).toThrow()
  })

  it('extracts only node DNS from Clash and the declared resolver from sing-box', () => {
    expect(
      extractSubscriptionConfig({
        proxies: [],
        dns: {
          'proxy-server-nameserver': ['tls://1.1.1.1:853'],
          nameserver: ['8.8.8.8'],
        },
      }).importedDns,
    ).toEqual({
      servers: [{ type: 'tls', tag: 'dns-1', server: '1.1.1.1', server_port: 853 }],
      resolver: 'dns-1',
    })
    expect(
      extractSubscriptionConfig({
        endpoints: [],
        dns: {
          servers: [
            { type: 'local', tag: 'a' },
            { type: 'local', tag: 'b' },
          ],
          final: 'a',
        },
        route: { default_domain_resolver: { server: 'b', strategy: 'ipv4_only' } },
      }).importedDns?.resolver,
    ).toBe('b')
  })

  it('retains endpoint identities and metadata when presentation tags change', () => {
    const previous = extractSubscriptionConfig({ endpoints: [wireguard] }).outbounds
    const metadata: App.Subscription['proxies'] = [
      { id: 'stable', tag: 'WG', type: 'wireguard', kind: 'endpoint' },
    ]
    const next = [{ ...previous[0], tag: 'Renamed WG' }]
    expect(reconcileSubscriptionProxyIds(metadata, previous, next, () => 'new')).toEqual([
      { id: 'stable', tag: 'Renamed WG', type: 'wireguard', kind: 'endpoint' },
    ])
  })

  it('preserves converted resolver references only when their imported DNS server exists', async () => {
    const proxy = {
      name: 'Clash',
      type: 'ss',
      server: 'node.example',
      port: 443,
      cipher: 'aes-128-gcm',
      password: 'password',
      _domain_resolver: { server: 'provider', strategy: 'ipv4_only' },
    }
    const withoutSource = await normalizeSubscriptionProxies([proxy])
    const withSource = await normalizeSubscriptionProxies([proxy], { resolverTags: ['provider'] })
    expect(withoutSource[0]).not.toHaveProperty('domain_resolver')
    expect(withSource[0]!.domain_resolver).toEqual({ server: 'provider', strategy: 'ipv4_only' })
  })

  it('keeps endpoint and native fields when converting a mixed subscription', async () => {
    const endpoint = { ...wireguard, _gui_kind: 'endpoint' }
    const native = {
      type: 'trojan',
      tag: 'native',
      server: 'node.example',
      domain_resolver: 'actual-dns',
      transport: { type: 'ws', headers: { Host: 'host.example' } },
    }
    const converted = await normalizeSubscriptionProxies([
      endpoint,
      native,
      {
        name: 'clash',
        type: 'ss',
        server: 'node.example',
        port: 443,
        cipher: 'aes-128-gcm',
        password: 'password',
      },
    ])
    expect(converted).toContainEqual(endpoint)
    expect(converted).toContainEqual(native)
    expect(converted.find((entry) => entry.tag === 'clash')).toMatchObject({ type: 'shadowsocks' })
    expect(converted.find((entry) => entry.tag === 'clash')).not.toHaveProperty('domain_resolver')
  })
})

describe('subscription DNS addresses', () => {
  it('parses IPv4, IPv6, explicit ports, encrypted DNS, and local without losing paths', () => {
    expect(
      parseSubscriptionDnsAddresses([
        '1.1.1.1',
        '2001:db8::1',
        'tcp://dns.example:5353',
        'https://dns.example/custom',
        'local',
        '1.1.1.1',
      ]),
    ).toEqual([
      { type: 'udp', tag: 'dns-1', server: '1.1.1.1' },
      { type: 'udp', tag: 'dns-2', server: '2001:db8::1' },
      { type: 'tcp', tag: 'dns-3', server: 'dns.example', server_port: 5353 },
      { type: 'https', tag: 'dns-4', server: 'dns.example', path: '/custom' },
      { type: 'local', tag: 'dns-5' },
    ])
  })
  it.each([
    'ftp://dns.example',
    'tls://',
    '1.1.1.1:0',
    'udp://dns.example/path',
    'https://user:pass@dns.example',
    'dns server',
  ])('rejects invalid DNS %s', (address) => {
    expect(() => parseSubscriptionDnsAddresses([address])).toThrow('subscription DNS address')
  })
})
