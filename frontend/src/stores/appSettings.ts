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
  UserFilePath,
} from '@/constant/app'
import { DefaultConnections, DefaultCoreConfig } from '@/constant/kernel'
import {
  Theme,
  Lang,
  View,
  Color,
  ControllerCloseMode,
  Branch,
  RequestProxyMode,
} from '@/enums/app'
import i18n, { loadLocale } from '@/lang'
import { useAppStore } from '@/stores'
import { debounce, ignoredError, deepClone } from '@/utils'

export const normalizeLogSettings = (settings: App.AppSettings['log'] | undefined) => {
  const retentionDays = Number(settings?.retentionDays)
  return {
    retentionDays: Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 14,
  }
}

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
    color: Color.Default,
    primaryColor: '#000',
    secondaryColor: '#545454',
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
    pages: ['Overview', 'Profiles', 'Subscriptions', 'Plugins'],
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
      document.body.style.fontFamily = fontFamily
    },
  }

  /* Apply AppSettings */
  const onAppSettingsChange = (settings: App.AppSettings) => {
    applyAppSettings.theme(settings.theme)
    applyAppSettings.color(settings.color, settings.primaryColor, settings.secondaryColor)
    applyAppSettings.lang(settings.lang)
    applyAppSettings.fontFamily(settings.fontFamily)
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

  return { setupAppSettings, app, themeMode }
})
