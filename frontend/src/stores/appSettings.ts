import sha256 from 'crypto-js/sha256'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { parse, stringify } from 'yaml'

import { FileExists, ReadFile, WriteFile } from '@/bridge'
import {
  Colors,
  DefaultCardColumns,
  DefaultConcurrencyLimit,
  DefaultControllerSensitivity,
  DefaultFontFamily,
  DefaultFontSize,
  DefaultPluginHubSources,
  DefaultTestTimeout,
  DefaultTestURL,
  MaxConcurrencyLimit,
  MaxFontSize,
  MinFontSize,
  UserFilePath,
} from '@/constant/app'
import { DefaultConnections, DefaultCoreConfig } from '@/constant/kernel'
import {
  Theme,
  Lang,
  View,
  Color,
  UiStyle,
  NavLayout,
  UiDensity,
  ControllerCloseMode,
  Branch,
  RequestProxyMode,
} from '@/enums/app'
import i18n, { loadLocale } from '@/lang'
import { useAppStore } from '@/stores'
import { debounce, deepClone } from '@/utils'
import { normalizeCustomFontPresets, syncCustomFontStylesheets } from '@/utils/fontPresets'

const VALID_UI_STYLES = new Set<string>(Object.values(UiStyle))
const VALID_NAV_LAYOUTS = new Set<string>(Object.values(NavLayout))
const VALID_UI_DENSITIES = new Set<string>(Object.values(UiDensity))

const normalizeFontSize = (value: unknown) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DefaultFontSize
  return Math.min(MaxFontSize, Math.max(MinFontSize, Math.round(parsed)))
}

export const normalizeAppearanceSettings = (
  settings: Partial<
    Pick<App.AppSettings, 'uiStyle' | 'navLayout' | 'uiDensity' | 'fontSize' | 'customFontPresets'>
  >,
) => ({
  uiStyle: VALID_UI_STYLES.has(String(settings.uiStyle))
    ? (settings.uiStyle as UiStyle)
    : UiStyle.Modern,
  navLayout: VALID_NAV_LAYOUTS.has(String(settings.navLayout))
    ? (settings.navLayout as NavLayout)
    : NavLayout.Sidebar,
  uiDensity: VALID_UI_DENSITIES.has(String(settings.uiDensity))
    ? (settings.uiDensity as UiDensity)
    : UiDensity.Comfortable,
  fontSize: normalizeFontSize(settings.fontSize),
  customFontPresets: normalizeCustomFontPresets(settings.customFontPresets),
})

export const normalizeLogSettings = (settings: App.AppSettings['log'] | undefined) => {
  const retentionDays = Number(settings?.retentionDays)
  return {
    retentionDays:
      Number.isFinite(retentionDays) && retentionDays > 0
        ? Math.min(3650, Math.trunc(retentionDays))
        : 14,
  }
}

const boundedInteger = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback
}

const httpTestUrl = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return DefaultTestURL
  try {
    const url = new URL(value.trim())
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : DefaultTestURL
  } catch {
    return DefaultTestURL
  }
}

export const normalizeKernelSettings = (settings: App.AppSettings['kernel']) => ({
  ...settings,
  branch: String(settings.branch) === Branch.Alpha ? Branch.Alpha : Branch.Main,
  profile: typeof settings.profile === 'string' ? settings.profile : '',
  realMemoryUsage: typeof settings.realMemoryUsage === 'boolean' ? settings.realMemoryUsage : false,
  autoClose: typeof settings.autoClose === 'boolean' ? settings.autoClose : true,
  unAvailable: typeof settings.unAvailable === 'boolean' ? settings.unAvailable : true,
  cardMode: typeof settings.cardMode === 'boolean' ? settings.cardMode : true,
  sortByDelay: typeof settings.sortByDelay === 'boolean' ? settings.sortByDelay : false,
  cardColumns: boundedInteger(settings.cardColumns, DefaultCardColumns, 1, 12),
  testUrl: httpTestUrl(settings.testUrl),
  testTimeout: boundedInteger(settings.testTimeout, DefaultTestTimeout, 1000, 60_000),
  concurrencyLimit: boundedInteger(
    settings.concurrencyLimit,
    DefaultConcurrencyLimit,
    1,
    MaxConcurrencyLimit,
  ),
  controllerCloseMode:
    String(settings.controllerCloseMode) === ControllerCloseMode.Button
      ? ControllerCloseMode.Button
      : ControllerCloseMode.All,
  controllerSensitivity: boundedInteger(
    settings.controllerSensitivity,
    DefaultControllerSensitivity,
    1,
    10,
  ),
})

export const mergeSettingsDefaults = <T>(defaults: T, input: unknown): T => {
  if (Array.isArray(defaults)) {
    return (Array.isArray(input) ? deepClone(input) : deepClone(defaults)) as T
  }
  if (defaults && typeof defaults === 'object') {
    const source =
      input && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {}
    const result = deepClone(source)
    Object.entries(defaults as Record<string, unknown>).forEach(([key, value]) => {
      result[key] = key in source ? mergeSettingsDefaults(value, source[key]) : deepClone(value)
    })
    return result as T
  }
  return (input === undefined || input === null ? defaults : input) as T
}

export const useAppSettingsStore = defineStore('app-settings', () => {
  const appStore = useAppStore()

  let latestUserSettings: string | undefined
  let pendingSave = Promise.resolve()
  type LoginAppearance = Partial<Pick<App.AppSettings, 'lang' | 'theme'>>
  const loginChoiceKey = 'gfs.login.pendingAppearance'
  let loginChoices: LoginAppearance = {}
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(loginChoiceKey) || '{}')
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) loginChoices = saved
  } catch {
    // Preferences can still be carried through login in memory.
  }

  const app = ref<App.AppSettings>({
    lang: Lang.EN,
    theme: Theme.Auto,
    uiStyle: UiStyle.Modern,
    navLayout: NavLayout.Sidebar,
    uiDensity: UiDensity.Comfortable,
    color: Color.Default,
    primaryColor: '#2563eb',
    secondaryColor: '#1d4ed8',
    fontFamily: DefaultFontFamily,
    fontSize: DefaultFontSize,
    customFontPresets: [],
    nodeGroupsView: View.Grid,
    profilesView: View.Grid,
    profileEditorMode: 'simple',
    subscribesView: View.Grid,
    rulesetsView: View.Grid,
    pluginsView: View.Grid,
    scheduledtasksView: View.Grid,
    requestProxyMode: RequestProxyMode.System,
    customProxy: '',
    autoStartKernel: false,
    autoRestartKernel: false,
    userAgent: '',
    nodePreferences: { favorites: [], recent: [] },
    connections: DefaultConnections(),
    log: {
      retentionDays: 14,
    },
    kernel: {
      realMemoryUsage: false,
      branch: Branch.Main,
      profile: '',
      autoClose: true,
      unAvailable: true,
      cardMode: true,
      cardColumns: DefaultCardColumns,
      sortByDelay: false,
      testUrl: DefaultTestURL,
      testTimeout: DefaultTestTimeout,
      concurrencyLimit: DefaultConcurrencyLimit,
      controllerCloseMode: ControllerCloseMode.All,
      controllerSensitivity: DefaultControllerSensitivity,
      main: DefaultCoreConfig(),
      alpha: DefaultCoreConfig(),
    },
    plugins: {
      sources: DefaultPluginHubSources(),
    },
    pluginSettings: {},
    githubApiToken: '',
    githubDownloadAcceleration: false,
    githubDownloadMirror: '',
    navigationVersion: 2,
    pages: [
      'Overview',
      'PolicyGroups',
      'Connections',
      'Logs',
      'NodeGroups',
      'NetCheck',
      'Profiles',
      'Subscriptions',
      'Rulesets',
      'Plugins',
      'ScheduledTasks',
    ],
  })

  const defaultSettings = deepClone(app.value)

  const saveAppSettings = debounce(() => {
    const days = Number(app.value.log?.retentionDays)
    const normalizedDays = Number.isFinite(days)
      ? Math.min(3650, Math.max(1, Math.trunc(days)))
      : 14
    if (app.value.log && app.value.log.retentionDays !== normalizedDays) {
      app.value.log.retentionDays = normalizedDays
    }
    const config = stringify(app.value)
    const save = pendingSave.then(async () => {
      if (latestUserSettings === config) return
      await WriteFile(UserFilePath, config)
      latestUserSettings = config
    })
    pendingSave = save.catch(() => undefined)
    return save
  }, 500)

  const setupAppSettings = async () => {
    const exists = await FileExists(UserFilePath)
    const data = exists ? await ReadFile(UserFilePath) : undefined
    let parsedSettings: unknown = {}
    let originalSettings = ''
    let shouldPersist = !data
    if (data) {
      try {
        parsedSettings = parse(data)
        originalSettings = stringify(parsedSettings)
      } catch (error) {
        console.error('Invalid user settings, restoring defaults:', error)
        await WriteFile(`${UserFilePath}.invalid-${Date.now()}`, data)
        shouldPersist = true
      }
    }
    const settings = mergeSettingsDefaults(deepClone(defaultSettings), parsedSettings)

    if (
      parsedSettings &&
      typeof parsedSettings === 'object' &&
      'pages' in parsedSettings &&
      Array.isArray(parsedSettings.pages) &&
      !('navigationVersion' in parsedSettings)
    ) {
      settings.pages = [
        ...new Set([...settings.pages, 'PolicyGroups', 'Connections', 'Logs', 'NodeGroups']),
      ]
    }
    await appStore.loadLocales(false, false)
    const loginLang = loginChoices.lang
    if (loginLang && appStore.locales.some((option) => option.value === loginLang))
      settings.lang = loginLang
    if (loginChoices.theme === Theme.Dark || loginChoices.theme === Theme.Light)
      settings.theme = loginChoices.theme

    settings.log = normalizeLogSettings(settings.log)
    settings.kernel = normalizeKernelSettings(settings.kernel)
    Object.assign(settings, normalizeAppearanceSettings(settings))

    const legacyDesktopSettings = [
      'windowStartState',
      'webviewGpuPolicy',
      'contentProtection',
      'width',
      'height',
      'exitOnClose',
      'startupDelay',
      'multipleInstance',
      'addPluginToMenu',
      'addGroupToMenu',
      'autoSetSystemProxy',
      'autoSetSystemDNS',
      'proxyBypassList',
      'systemProxyServices',
      'systemProxyDNS',
      'systemDefaultDNS',
      'darwinSystemProxyServices',
      'closeKernelOnExit',
      'rollingRelease',
      'debugBorder',
      'debugOutline',
      'debugNoAnimation',
      'debugNoRounded',
      'debugUsePointer',
    ]
    const settingsRecord = settings as unknown as Record<string, unknown>
    legacyDesktopSettings.forEach((key) => delete settingsRecord[key])

    const normalizedSettings = stringify(settings)
    shouldPersist ||= normalizedSettings !== originalSettings
    if (shouldPersist) {
      try {
        await WriteFile(UserFilePath, normalizedSettings, {
          ExpectedSHA256: data === undefined ? 'missing' : sha256(data).toString(),
        })
      } catch (error) {
        // Another page can finish the same first-run initialization while this one loads.
        if ((await ReadFile(UserFilePath).catch(() => undefined)) !== normalizedSettings)
          throw error
      }
    }
    latestUserSettings = normalizedSettings
    app.value = settings
    loginChoices = {}
    try {
      window.sessionStorage.removeItem(loginChoiceKey)
    } catch {
      // Storage may be unavailable.
    }
  }

  const applyAppSettings = {
    theme(theme: App.Theme) {
      const isAuto = theme === Theme.Auto
      if (isAuto) {
        themeMode.value = mediaQueryList?.matches ? Theme.Dark : Theme.Light
      } else {
        themeMode.value = theme
      }
    },
    lang(lang: string) {
      i18n.global.locale.value = lang
      if (!i18n.global.availableLocales.includes(lang)) {
        void Promise.resolve(loadLocale(lang)).catch((error) =>
          console.error('Failed to load locale:', error),
        )
      }
    },
    color(color: App.Color, primary: string, secondary: string) {
      if (color !== Color.Custom) {
        ;({ primary, secondary } = Colors[color] ?? { primary, secondary })
      }
      document.documentElement.style.setProperty('--primary-color', primary)
      document.documentElement.style.setProperty('--secondary-color', secondary)
    },
    fontFamily(fontFamily: string) {
      const resolved = fontFamily.trim() || DefaultFontFamily
      document.documentElement.style.setProperty('--app-font-family', resolved)
      document.body.style.fontFamily = resolved
    },
    fontSize(fontSize: number) {
      const size = normalizeFontSize(fontSize)
      document.documentElement.style.setProperty('--font-size-base', `${size}px`)
      document.documentElement.style.setProperty(
        '--font-scale',
        (size / DefaultFontSize).toFixed(4),
      )
    },
    customFontPresets(presets: App.CustomFontPreset[]) {
      syncCustomFontStylesheets(presets ?? [])
    },
    uiStyle(style: App.UiStyle) {
      document.body.setAttribute('ui-style', VALID_UI_STYLES.has(style) ? style : UiStyle.Modern)
    },
    uiDensity(density: App.UiDensity) {
      document.body.setAttribute(
        'ui-density',
        VALID_UI_DENSITIES.has(density) ? density : UiDensity.Comfortable,
      )
    },
  }

  /* Apply AppTheme */
  const mediaQueryList =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null
  const themeMode = ref<Extract<App.Theme, 'light' | 'dark'>>(
    app.value.theme === Theme.Auto
      ? mediaQueryList?.matches
        ? Theme.Dark
        : Theme.Light
      : app.value.theme,
  )
  mediaQueryList?.addEventListener?.('change', ({ matches }) => {
    if (app.value.theme === Theme.Auto) {
      themeMode.value = matches ? Theme.Dark : Theme.Light
    }
  })
  const setAppTheme = (theme: Extract<App.Theme, 'light' | 'dark'>) => {
    if (document.startViewTransition) {
      const transition = document.startViewTransition(() => {
        document.body.setAttribute('theme-mode', theme)
      })
      void transition.ready.catch((error) => {
        if (error?.name !== 'AbortError') console.error('Theme transition failed:', error)
      })
    } else {
      document.body.setAttribute('theme-mode', theme)
    }
  }
  document.body.setAttribute('theme-mode', themeMode.value)
  watch(themeMode, setAppTheme)

  const syncLoginPref = (key: string, value: string) => {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // ignore storage errors
    }
  }

  /* Targeted Appearance Watchers */
  watch(
    () => app.value.theme,
    (theme) => {
      applyAppSettings.theme(theme)
      if (latestUserSettings !== undefined) {
        if (theme === Theme.Light || theme === Theme.Dark) syncLoginPref('gfs.login.theme', theme)
        else {
          try {
            window.localStorage.removeItem('gfs.login.theme')
          } catch {
            // ignore
          }
        }
      }
    },
  )
  watch(
    () => [app.value.color, app.value.primaryColor, app.value.secondaryColor] as const,
    ([color, primary, secondary]) => applyAppSettings.color(color, primary, secondary),
  )
  watch(
    () => app.value.lang,
    (lang) => {
      applyAppSettings.lang(lang)
      if (latestUserSettings !== undefined) syncLoginPref('gfs.login.lang', lang)
    },
  )
  watch(
    () => app.value.fontFamily,
    (fontFamily) => applyAppSettings.fontFamily(fontFamily),
  )
  watch(
    () => app.value.fontSize,
    (fontSize) => applyAppSettings.fontSize(fontSize),
  )
  watch(
    () => app.value.customFontPresets,
    (presets) => applyAppSettings.customFontPresets(presets),
    { deep: true },
  )
  watch(
    () => app.value.uiStyle,
    (style) => applyAppSettings.uiStyle(style),
  )
  watch(
    () => app.value.uiDensity,
    (density) => applyAppSettings.uiDensity(density),
  )

  watch(
    app,
    () => {
      if (latestUserSettings !== undefined) {
        saveAppSettings().catch((error) => console.error('Failed to save user settings:', error))
      }
    },
    { deep: true },
  )

  applyAppSettings.color(app.value.color, app.value.primaryColor, app.value.secondaryColor)
  applyAppSettings.uiStyle(app.value.uiStyle)
  applyAppSettings.uiDensity(app.value.uiDensity)
  applyAppSettings.fontFamily(app.value.fontFamily)
  applyAppSettings.fontSize(app.value.fontSize)
  applyAppSettings.customFontPresets(app.value.customFontPresets)

  const previewLoginAppearance = (choice: LoginAppearance, remember = false) => {
    if (choice.lang) applyAppSettings.lang(choice.lang)
    if (choice.theme) applyAppSettings.theme(choice.theme)
    if (!remember) return
    Object.assign(loginChoices, choice)
    try {
      window.sessionStorage.setItem(loginChoiceKey, JSON.stringify(loginChoices))
    } catch {
      // The in-memory choices still apply to the next bootstrap.
    }
  }

  return { setupAppSettings, app, themeMode, previewLoginAppearance }
})
