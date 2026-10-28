import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { replace } = vi.hoisted(() => ({
  replace: vi.fn(),
}))

vi.mock('@/router', () => ({
  default: {
    currentRoute: {
      value: {
        fullPath: '/profiles',
        query: {},
      },
    },
    replace,
  },
}))

import { useWebuiAuthStore } from '@/stores/webuiAuth'

const createStorageMock = () => {
  const storage = new Map<string, string>()

  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value)
    },
    removeItem: (key: string) => {
      storage.delete(key)
    },
    clear: () => {
      storage.clear()
    },
  }
}

describe('webui auth store', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', createStorageMock())
    localStorage.clear()
    vi.restoreAllMocks()
    replace.mockReset()
  })

  it('hydrates a persisted token from localStorage', () => {
    localStorage.setItem('gfs.webui.token', 'saved-token')

    const store = useWebuiAuthStore()
    store.hydrate()

    expect(store.token).toBe('saved-token')
    expect(store.status).toBe('idle')
  })

  it('persists token after successful verification', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    })

    vi.stubGlobal('fetch', fetchMock)

    const store = useWebuiAuthStore()
    const passed = await store.verifyToken('next-token')

    expect(fetchMock).toHaveBeenCalledWith('/__webui/api/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: '{"token":"next-token"}',
      signal: expect.any(AbortSignal),
    })
    expect(passed).toBe(true)
    expect(store.status).toBe('authenticated')
    expect(localStorage.getItem('gfs.webui.token')).toBe('next-token')
  })

  it('authenticates an existing cookie session without resubmitting a token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = useWebuiAuthStore()
    const passed = await store.ensureAuthenticated()

    expect(fetchMock).toHaveBeenCalledWith('/__webui/api/session', {
      method: 'GET',
      signal: expect.any(AbortSignal),
    })
    expect(passed).toBe(true)
    expect(store.status).toBe('authenticated')
    expect(store.token).toBe('')
  })

  it('rejects an unauthorized token during verification', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      }),
    )

    const store = useWebuiAuthStore()
    store.setToken('stale-token')
    const passed = await store.verifyToken('next-token')

    expect(passed).toBe(false)
    expect(store.status).toBe('idle')
    expect(store.token).toBe('')
    expect(store.lastError).toBe('auth.invalidToken')
    expect(localStorage.getItem('gfs.webui.token')).toBe(null)
  })

  it('clears token and stores an invalid-token reason on unauthorized reset', async () => {
    const store = useWebuiAuthStore()
    store.setToken('stale-token')

    await store.handleUnauthorized()

    expect(store.token).toBe('')
    expect(store.status).toBe('idle')
    expect(store.lastError).toBe('auth.invalidToken')
    expect(replace).toHaveBeenCalledWith('/login?redirect=%2Fprofiles')
  })

  it('clears token and jumps to login on logout', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
    const store = useWebuiAuthStore()
    store.setToken('logout-token')

    await store.logout()

    expect(store.token).toBe('')
    expect(store.status).toBe('idle')
    expect(store.lastError).toBe('')
    expect(fetchMock).toHaveBeenCalledWith('/__webui/api/session', { method: 'DELETE' })
    expect(replace).toHaveBeenCalledWith('/login')
  })
  it.each(['network', 'server'])(
    'clears checking after a %s failure and allows retry',
    async (failure) => {
      const fetchMock = vi.fn()
      if (failure === 'network') fetchMock.mockRejectedValueOnce(new Error('offline'))
      else fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200 })
      vi.stubGlobal('fetch', fetchMock)
      const store = useWebuiAuthStore()
      await expect(store.verifyToken('token')).rejects.toBeTruthy()
      expect(store.status).toBe('idle')
      expect(await store.verifyToken('token')).toBe(true)
      expect(store.status).toBe('authenticated')
    },
  )

  it('ignores a stale failure after a newer successful verification', async () => {
    let resolveOld!: (value: unknown) => void
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          }),
      )
      .mockResolvedValueOnce({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    const store = useWebuiAuthStore()
    const old = store.verifyToken('old')
    expect(await store.verifyToken('new')).toBe(true)
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true)
    resolveOld({ ok: false, status: 401 })
    expect(await old).toBe(false)
    expect(store.token).toBe('new')
    expect(store.status).toBe('authenticated')
  })

  it('does not authenticate a pending verification after logout', async () => {
    let resolveOld!: (value: unknown) => void
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveOld = resolve
            }),
        )
        .mockResolvedValueOnce({ ok: true, status: 204 }),
    )
    const store = useWebuiAuthStore()
    const old = store.verifyToken('old')
    await store.logout()
    resolveOld({ ok: true, status: 200 })
    expect(await old).toBe(false)
    expect(store.status).toBe('idle')
    expect(store.token).toBe('')
  })
})
