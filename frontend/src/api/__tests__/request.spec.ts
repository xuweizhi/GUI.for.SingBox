import { afterEach, describe, expect, it, vi } from 'vitest'

import { Request } from '@/api/request'

describe('Request', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
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
