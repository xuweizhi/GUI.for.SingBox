import { describe, expect, it } from 'vitest'

import { parseNetworkCheckTarget } from '@/views/NetCheckView/networkCheckTarget'

describe('parseNetworkCheckTarget', () => {
  it('normalizes an https URL', () => {
    expect(parseNetworkCheckTarget('https://example.com/path')).toMatchObject({
      input: 'https://example.com/path',
      requestUrl: 'https://example.com/path',
      requestHost: 'example.com',
      tcpHost: 'example.com',
      tcpPort: 443,
      displayHost: 'example.com',
      dnsLookupHost: 'example.com',
      targetKind: 'domain',
    })
  })

  it('uses port 80 for http URLs without an explicit port', () => {
    expect(parseNetworkCheckTarget('http://example.com')).toMatchObject({
      requestUrl: 'http://example.com/',
      tcpHost: 'example.com',
      tcpPort: 80,
    })
  })

  it('defaults bare hosts to https and port 443', () => {
    expect(parseNetworkCheckTarget('example.com')).toMatchObject({
      requestUrl: 'https://example.com/',
      tcpHost: 'example.com',
      tcpPort: 443,
    })
  })

  it('keeps an explicit host port', () => {
    expect(parseNetworkCheckTarget('example.com:8443')).toMatchObject({
      requestUrl: 'https://example.com:8443/',
      tcpHost: 'example.com',
      tcpPort: 8443,
    })
  })

  it('marks IPv4 input as an IP target and skips DNS later', () => {
    expect(parseNetworkCheckTarget('1.1.1.1')).toMatchObject({
      requestUrl: 'https://1.1.1.1/',
      tcpHost: '1.1.1.1',
      tcpPort: 443,
      targetKind: 'ip',
      dnsLookupHost: '',
    })
  })

  it('keeps bracketed IPv6 host and explicit port', () => {
    expect(parseNetworkCheckTarget('[2606:4700:4700::1111]:8443')).toMatchObject({
      requestUrl: 'https://[2606:4700:4700::1111]:8443/',
      tcpHost: '2606:4700:4700::1111',
      tcpPort: 8443,
      targetKind: 'ip',
    })
  })

  it('keeps domain targets DNS-queryable', () => {
    expect(parseNetworkCheckTarget('https://example.com/path')).toMatchObject({
      targetKind: 'domain',
      dnsLookupHost: 'example.com',
      requestHost: 'example.com',
    })
  })

  it('throws for invalid targets', () => {
    expect(() => parseNetworkCheckTarget('http://')).toThrow('netCheck.invalidTarget')
  })
})
