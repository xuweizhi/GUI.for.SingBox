import { describe, expect, it } from 'vitest'

import { parseNetworkCheckTarget } from '@/views/NetCheckView/networkCheckTarget'

describe('parseNetworkCheckTarget', () => {
  it('normalizes an https URL', () => {
    expect(parseNetworkCheckTarget('https://example.com/path')).toEqual({
      input: 'https://example.com/path',
      requestUrl: 'https://example.com/path',
      tcpHost: 'example.com',
      tcpPort: 443,
      displayHost: 'example.com',
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

  it('throws for invalid targets', () => {
    expect(() => parseNetworkCheckTarget('http://')).toThrow('netCheck.invalidTarget')
  })
})
