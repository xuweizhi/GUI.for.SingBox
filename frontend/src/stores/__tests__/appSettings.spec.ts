import { describe, expect, it, vi } from 'vitest'

vi.mock('@/bridge', () => ({
  ReadFile: vi.fn(),
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

import {
  mergeSettingsDefaults,
  normalizeKernelSettings,
  normalizeLogSettings,
} from '@/stores/appSettings'

describe('app settings store helpers', () => {
  it('defaults missing or invalid log retention days to 14', () => {
    expect(normalizeLogSettings(undefined)).toEqual({ retentionDays: 14 })
    expect(normalizeLogSettings({ retentionDays: 0 })).toEqual({ retentionDays: 14 })
    expect(normalizeLogSettings({ retentionDays: -5 })).toEqual({ retentionDays: 14 })
  })

  it('keeps positive log retention days', () => {
    expect(normalizeLogSettings({ retentionDays: 30 })).toEqual({ retentionDays: 30 })
  })

  it('normalizes latency and controller settings to safe runtime ranges', () => {
    const settings = normalizeKernelSettings({
      branch: 'invalid',
      profile: 'profile-1',
      realMemoryUsage: false,
      autoClose: true,
      unAvailable: true,
      cardMode: true,
      sortByDelay: false,
      cardColumns: 99,
      testUrl: 'file:///tmp/probe',
      testTimeout: 250,
      concurrencyLimit: 50,
      controllerCloseMode: 'invalid',
      controllerSensitivity: 0,
      main: { env: {}, args: [] },
      alpha: { env: {}, args: [] },
    } as unknown as App.AppSettings['kernel'])

    expect(settings).toMatchObject({
      branch: 'main',
      cardColumns: 12,
      testUrl: 'https://www.gstatic.com/generate_204',
      testTimeout: 1000,
      concurrencyLimit: 8,
      controllerCloseMode: 'all',
      controllerSensitivity: 1,
    })
  })

  it('fills missing defaults without dropping dynamic settings', () => {
    expect(
      mergeSettingsDefaults(
        { theme: 'auto', pluginSettings: {} as Record<string, unknown> },
        { pluginSettings: { customPlugin: { enabled: true } } },
      ),
    ).toEqual({
      theme: 'auto',
      pluginSettings: { customPlugin: { enabled: true } },
    })
  })
})
