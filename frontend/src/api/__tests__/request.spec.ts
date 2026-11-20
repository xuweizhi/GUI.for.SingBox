import { afterEach, describe, expect, it, vi } from 'vitest'

import { Request } from '@/api/request'

describe('Request', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('recognizes missing optional API methods and surfaces genuine lookup errors', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', {status:404}))
      .mockResolvedValueOnce(new Response('', {status:405}))
      .mockResolvedValueOnce(new Response('lookup failed', {status:500}))
    vi.stubGlobal('fetch', fetch)
    const request = new Request()
    await expect(request.getOptional('/karing/outboundQuery')).resolves.toBeUndefined()
    await expect(request.postOptional('/karing/dnsQuery')).resolves.toBeUndefined()
    await expect(request.getOptional('/karing/outboundQuery')).rejects.toBe('lookup failed')
  })

  it('throws the API message for a non-success JSON response', async () => {
    const onUnauthorized = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'invalid node' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const request = new Request({ onUnauthorized })

    await expect(request.put('/proxies/Proxy', { name: 'Missing' })).rejects.toBe('invalid node')
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('does not log out when the proxied core returns 401', async () => {
    const onUnauthorized = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('invalid core secret', { status: 401 })),
    )
    const request = new Request({ onUnauthorized })

    await expect(request.get('/configs')).rejects.toBe('invalid core secret')
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('logs out when the WebUI gateway returns an auth challenge', async () => {
    const onUnauthorized = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('Unauthorized', {
          status: 401,
          headers: { 'X-GFS-WebUI-Auth': 'required' },
        }),
      ),
    )
    const request = new Request({ onUnauthorized })

    await expect(request.get('/configs')).rejects.toBe('auth.invalidToken')
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })
})
