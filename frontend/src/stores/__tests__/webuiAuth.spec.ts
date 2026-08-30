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

    expect(fetchMock).toHaveBeenCalledWith('/__webui/api/session', { method: 'GET' })
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
})
