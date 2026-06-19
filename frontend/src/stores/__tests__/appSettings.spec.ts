import { describe, expect, it, vi } from 'vitest'

vi.mock('@/bridge', () => ({
  GetSystemProxyBypass: vi.fn(),
  ReadFile: vi.fn(),
  WindowIsMaximised: vi.fn(),
  WindowIsMinimised: vi.fn(),
  WindowSetSystemDefaultTheme: vi.fn(),
  WriteFile: vi.fn(),
}))

vi.mock('@/lang', () => ({
  default: {
    global: {
      availableLocales: ['en'],
      locale: { value: 'en' },
    },
  },
  loadLocale: vi.fn(),
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    loadLocales: vi.fn(),
    locales: [],
  }),
}))

vi.mock('@/stores/env', () => ({
  useEnvStore: () => ({
    setSystemProxy: vi.fn(),
    systemProxy: false,
  }),
}))

import { normalizeLogSettings } from '@/stores/appSettings'

describe('app settings store helpers', () => {
  it('defaults missing or invalid log retention days to 14', () => {
    expect(normalizeLogSettings(undefined)).toEqual({ retentionDays: 14 })
    expect(normalizeLogSettings({ retentionDays: 0 })).toEqual({ retentionDays: 14 })
    expect(normalizeLogSettings({ retentionDays: -5 })).toEqual({ retentionDays: 14 })
  })

  it('keeps positive log retention days', () => {
    expect(normalizeLogSettings({ retentionDays: 30 })).toEqual({ retentionDays: 30 })
  })
})
