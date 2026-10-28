import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settings: { app: { requestProxyMode: 'none', customProxy: '', userAgent: 'proxy-test' } },
  getSystemProxy: vi.fn().mockResolvedValue('http://environment-proxy.test:8080'),
  getProxyEndpoint: vi.fn(),
  requests: vi.fn(),
}))

vi.mock('@/stores', () => ({
  useAppSettingsStore: () => mocks.settings,
  useKernelApiStore: () => ({ getProxyEndpoint: mocks.getProxyEndpoint }),
  useAppStore: vi.fn(),
  useEnvStore: vi.fn(),
  usePluginsStore: vi.fn(),
  useRulesetsStore: vi.fn(),
}))
vi.mock('@/api/kernel', () => ({
  deleteConnection: vi.fn(),
  getConnections: vi.fn(),
  useProxy: vi.fn(),
}))
vi.mock('@/bridge', () => ({
  GetSystemProxy: mocks.getSystemProxy,
  ReadFile: vi.fn(),
  WriteFile: vi.fn(),
  RestartApp: vi.fn(),
  WindowReloadApp: vi.fn(),
}))
vi.mock('@/bridge/browser/go/bridge/App', () => ({ Requests: mocks.requests }))
vi.mock('@/bridge/browser/runtime/runtime', () => ({
  EventsOn: vi.fn(),
  EventsOff: vi.fn(),
  EventsEmit: vi.fn(),
}))
vi.mock('@/lang', () => ({ default: { global: { t: (key: string) => key } } }))
vi.mock('@/utils', async () => ({
  ...(await vi.importActual<typeof import('@/utils/others')>('@/utils/others')),
  ...(await vi.importActual<typeof import('@/utils/format')>('@/utils/format')),
  message: {},
  confirm: vi.fn(),
}))

import { Requests } from '@/bridge/net'

import { RequestProxyMode } from '@/enums/app'
import { GetRequestProxy } from '@/utils/helper'

describe('request proxy mode across the frontend bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.settings.app.requestProxyMode = RequestProxyMode.None
    mocks.settings.app.customProxy = ''
    mocks.getProxyEndpoint.mockReturnValue(undefined)
    mocks.requests.mockResolvedValue({ flag: true, status: 200, headers: {}, body: 'ok' })
  })

  it('sends explicit direct transport when None is selected', async () => {
    await Requests({ method: 'GET', url: 'https://destination.test/' })
    expect(mocks.requests).toHaveBeenCalledWith(
      'GET',
      'https://destination.test/',
      expect.any(Object),
      '',
      expect.objectContaining({ Proxy: 'direct' }),
    )
    expect(mocks.getSystemProxy).not.toHaveBeenCalled()
  })

  it('keeps the configured mode when an options object contains an undefined override', async () => {
    await Requests({
      method: 'GET',
      url: 'https://destination.test/',
      options: { Proxy: undefined },
    })
    expect(mocks.requests.mock.calls[0]![4].Proxy).toBe('direct')
  })

  it('leaves System resolution to the backend so destination-specific NO_PROXY applies', async () => {
    mocks.settings.app.requestProxyMode = RequestProxyMode.System
    await Requests({ method: 'GET', url: 'https://destination.test/' })
    expect(mocks.requests).toHaveBeenCalledWith(
      'GET',
      'https://destination.test/',
      expect.any(Object),
      '',
      expect.objectContaining({ Proxy: '' }),
    )
    expect(mocks.getSystemProxy).not.toHaveBeenCalled()
  })

  it.each(['', 'direct', 'socks5://proxy.test:1080'])(
    'preserves explicit bridge override %j instead of replacing it with global defaults',
    async (proxy) => {
      mocks.settings.app.requestProxyMode = RequestProxyMode.Custom
      mocks.settings.app.customProxy = 'global-proxy.test:8080'
      await Requests({ method: 'GET', url: 'https://destination.test/', options: { Proxy: proxy } })
      expect(mocks.requests.mock.calls[0]![4].Proxy).toBe(proxy)
    },
  )

  it('resolves Global through current application settings', async () => {
    expect(await GetRequestProxy(RequestProxyMode.Global)).toBe('direct')
    mocks.settings.app.requestProxyMode = RequestProxyMode.Custom
    mocks.settings.app.customProxy = ' proxy.test:8080 '
    expect(await GetRequestProxy(RequestProxyMode.Global)).toBe('http://proxy.test:8080')
    expect(await GetRequestProxy(RequestProxyMode.Custom, 'socks5://other.test:1080')).toBe(
      'socks5://other.test:1080',
    )
  })

  it('retains kernel endpoint authentication and IPv6 URL formatting', async () => {
    mocks.getProxyEndpoint.mockReturnValue({
      schema: 'socks5',
      host: '::1',
      port: 1080,
      username: 'user@host',
      password: 'p:a/ss',
    })
    expect(await GetRequestProxy(RequestProxyMode.Kernel)).toBe(
      'socks5://user%40host:p%3Aa%2Fss@[::1]:1080',
    )
  })
})
