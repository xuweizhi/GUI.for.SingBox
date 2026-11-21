import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { parse, stringify } from 'yaml'

import { ReadFile, WriteFile } from '@/bridge'
import {
  Colors,
  DefaultCardColumns,
  DefaultConcurrencyLimit,
  DefaultControllerSensitivity,
  DefaultFontFamily,
  DefaultPluginHubSources,
  DefaultTestTimeout,
  DefaultTestURL,
  MaxConcurrencyLimit,
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
import { debounce, ignoredError, deepClone } from '@/utils'

const VALID_UI_STYLES = new Set<string>(Object.values(UiStyle))
const VALID_NAV_LAYOUTS = new Set<string>(Object.values(NavLayout))
const VALID_UI_DENSITIES = new Set<string>(Object.values(UiDensity))

export const normalizeAppearanceSettings = (
  settings: Partial<Pick<App.AppSettings, 'uiStyle' | 'navLayout' | 'uiDensity'>>,
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

  let latestUserSettings: string

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
    profilesView: View.Grid,
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
    pages: [
      'Overview',
      'NetCheck',
      'Profiles',
      'Subscriptions',
      'Rulesets',
      'Plugins',
      'ScheduledTasks',
    ],
  })

  const saveAppSettings = debounce(async (config: string) => WriteFile(UserFilePath, config), 500)

  const setupAppSettings = async () => {
    const data = await ignoredError(ReadFile, UserFilePath)
    let parsedSettings: unknown = {}
    let originalSettings = ''
    let shouldPersist = !data
    if (data) {
      try {
        parsedSettings = parse(data)
        originalSettings = stringify(parsedSettings)
      } catch (error) {
        console.error('Invalid user settings, restoring defaults:', error)
        await WriteFile(`${UserFilePath}.invalid-${Date.now()}`, data).catch(() => undefined)
        shouldPersist = true
      }
    }
    const settings = mergeSettingsDefaults(deepClone(app.value), parsedSettings)

    await appStore.loadLocales(false, false)

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
    app.value = settings
    latestUserSettings = normalizedSettings
    if (shouldPersist) {
      await WriteFile(UserFilePath, normalizedSettings)
    }
  }

  const applyAppSettings = {
    theme(theme: App.Theme) {
      const isAuto = theme === Theme.Auto
      if (isAuto) {
        themeMode.value = mediaQueryList.matches ? Theme.Dark : Theme.Light
      } else {
        themeMode.value = theme
      }
    },
    lang(lang: string) {
      i18n.global.locale.value = lang
      if (!i18n.global.availableLocales.includes(lang)) {
        loadLocale(lang)
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
      document.body.style.fontFamily = fontFamily.trim() || DefaultFontFamily
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

  /* Apply AppSettings */
  const onAppSettingsChange = (settings: App.AppSettings) => {
    applyAppSettings.theme(settings.theme)
    applyAppSettings.color(settings.color, settings.primaryColor, settings.secondaryColor)
    applyAppSettings.lang(settings.lang)
    applyAppSettings.fontFamily(settings.fontFamily)
    applyAppSettings.uiStyle(settings.uiStyle)
    applyAppSettings.uiDensity(settings.uiDensity)
    const lastModifiedSettings = stringify(settings)
    if (latestUserSettings !== lastModifiedSettings) {
      saveAppSettings(lastModifiedSettings)
        .then(() => {
          latestUserSettings = lastModifiedSettings
        })
        .catch((error) => console.error('Failed to save user settings:', error))
    } else {
      saveAppSettings.cancel()
    }
  }
  watch(app, onAppSettingsChange, { deep: true })

  /* Apply AppTheme */
  const themeMode = ref<Extract<App.Theme, 'light' | 'dark'>>(Theme.Light)
  const mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQueryList.addEventListener('change', ({ matches }) => {
    if (app.value.theme === Theme.Auto) {
      themeMode.value = matches ? Theme.Dark : Theme.Light
    }
  })
  const setAppTheme = (theme: Extract<App.Theme, 'light' | 'dark'>) => {
    if (document.startViewTransition) {
      document.startViewTransition(() => {
        document.body.setAttribute('theme-mode', theme)
      })
    } else {
      document.body.setAttribute('theme-mode', theme)
    }
  }
  watch(themeMode, setAppTheme, { immediate: true })
  applyAppSettings.uiStyle(app.value.uiStyle)
  applyAppSettings.uiDensity(app.value.uiDensity)

  return { setupAppSettings, app, themeMode }
})
