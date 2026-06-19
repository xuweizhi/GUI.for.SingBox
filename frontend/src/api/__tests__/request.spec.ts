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
})
