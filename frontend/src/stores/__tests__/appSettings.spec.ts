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
  normalizeAppearanceSettings,
  normalizeKernelSettings,
  normalizeLogSettings,
} from '@/stores/appSettings'
import {
  createCustomFontPresetId,
  matchedFontPresetKey,
  normalizeCustomFontPresets,
  normalizeFontStylesheetUrl,
  suggestFontPresetLabel,
  syncCustomFontStylesheets,
} from '@/utils/fontPresets'

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

  it('normalizes appearance settings with safe defaults and preserves valid presets', () => {
    expect(
      normalizeAppearanceSettings({
        uiStyle: 'invalid' as any,
        navLayout: 'unknown' as any,
        uiDensity: '' as any,
        fontSize: 99,
      }),
    ).toEqual({
      uiStyle: 'modern',
      navLayout: 'sidebar',
      uiDensity: 'comfortable',
      fontSize: 18,
      customFontPresets: [],
    })

    expect(
      normalizeAppearanceSettings({
        uiStyle: 'glass',
        navLayout: 'topnav',
        uiDensity: 'compact',
        fontSize: 16,
        customFontPresets: [
          {
            id: 'custom-font-1',
            label: '霞鹜文楷',
            fontFamily: '"LXGW WenKai", serif',
            stylesheetUrl: 'https://example.com/font.css',
          },
        ],
      }),
    ).toEqual({
      uiStyle: 'glass',
      navLayout: 'topnav',
      uiDensity: 'compact',
      fontSize: 16,
      customFontPresets: [
        {
          id: 'custom-font-1',
          label: '霞鹜文楷',
          fontFamily: '"LXGW WenKai", serif',
          stylesheetUrl: 'https://example.com/font.css',
        },
      ],
    })

    expect(normalizeAppearanceSettings({ fontSize: 6 })).toMatchObject({ fontSize: 12 })
    expect(normalizeAppearanceSettings({})).toMatchObject({ fontSize: 14, customFontPresets: [] })
  })

  it('sanitizes custom font presets, stylesheet URLs, IDs, and document stylesheet links', () => {
    expect(normalizeFontStylesheetUrl('https://fonts.example.com/css2?family=Inter')).toBe(
      'https://fonts.example.com/css2?family=Inter',
    )
    expect(normalizeFontStylesheetUrl('/fonts/custom.css')).toBe('/fonts/custom.css')
    expect(normalizeFontStylesheetUrl('//evil.example/font.css')).toBeUndefined()
    expect(normalizeFontStylesheetUrl('javascript:alert(1)')).toBeUndefined()
    expect(normalizeFontStylesheetUrl('data:text/css,body{}')).toBeUndefined()

    const normalized = normalizeCustomFontPresets([
      null,
      { label: '', fontFamily: 'Inter' },
      { label: 'Missing Family', fontFamily: '   ' },
      {
        id: 'dup',
        label: '  霞鹜文楷  ',
        fontFamily: '  "LXGW WenKai", serif  ',
        stylesheetUrl: '/fonts/lxgw.css',
      },
      {
        id: 'dup',
        label: 'Duplicate Family Ignored',
        fontFamily: '"LXGW WenKai", serif',
      },
      {
        id: 'dup',
        label: 'Maple Mono',
        fontFamily: '"Maple Mono", monospace',
        stylesheetUrl: 'javascript:alert(1)',
      },
    ])

    expect(normalized).toEqual([
      {
        id: 'dup',
        label: '霞鹜文楷',
        fontFamily: '"LXGW WenKai", serif',
        stylesheetUrl: '/fonts/lxgw.css',
      },
      {
        id: 'dup-2',
        label: 'Maple Mono',
        fontFamily: '"Maple Mono", monospace',
      },
    ])

    expect(createCustomFontPresetId(normalized)).toBe('custom-font-3')
    expect(suggestFontPresetLabel('"Maple Mono", monospace')).toBe('Maple Mono')
    expect(matchedFontPresetKey('"LXGW WenKai", serif', normalized)).toBe('preset:dup')
    expect(matchedFontPresetKey('"Unknown Font", sans-serif', normalized)).toBe('custom')

    syncCustomFontStylesheets(normalized)
    expect(
      document.head.querySelectorAll('link[data-gfs-font-css="1"][data-gfs-font-href="/fonts/lxgw.css"]'),
    ).toHaveLength(1)

    // Re-syncing is idempotent and removing the preset cleans up the head link
    syncCustomFontStylesheets(normalized)
    expect(document.head.querySelectorAll('link[data-gfs-font-css="1"]')).toHaveLength(1)

    syncCustomFontStylesheets([])
    expect(document.head.querySelectorAll('link[data-gfs-font-css="1"]')).toHaveLength(0)

    const overflow = Array.from({ length: 25 }, (_, i) => ({
      id: `f-${i + 1}`,
      label: `Font ${i + 1}`,
      fontFamily: `"Font ${i + 1}", sans-serif`,
    }))
    expect(normalizeCustomFontPresets(overflow)).toHaveLength(20)
  })
})
