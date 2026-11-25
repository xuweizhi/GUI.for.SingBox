import { deleteConnection, getConnections, useProxy } from '@/api/kernel'
import { RestartApp, WindowReloadApp } from '@/bridge'
import { CoreWorkingDirectory } from '@/constant/kernel'
import { RequestProxyMode } from '@/enums/app'
import i18n from '@/lang'
import {
  useAppSettingsStore,
  useAppStore,
  useEnvStore,
  useKernelApiStore,
  usePluginsStore,
  useRulesetsStore,
} from '@/stores'
import { formatProxyHost, normalizeRequestProxy, message, confirm } from '@/utils'
import { rememberNode } from '@/utils/nodePreferences'

export const GetRequestProxy = async (mode?: App.RequestProxyMode, customProxy?: string) => {
  const appSettings = useAppSettingsStore()
  const requestProxyMode =
    !mode || mode === RequestProxyMode.Global ? appSettings.app.requestProxyMode : mode

  if (requestProxyMode === RequestProxyMode.None) {
    return 'direct'
  }

  if (requestProxyMode === RequestProxyMode.Kernel) {
    const kernelProxy = useKernelApiStore().getProxyEndpoint()
    if (!kernelProxy) return ''

    const { schema, host, port, username, password } = kernelProxy
    const formattedHost = formatProxyHost(host)
    const encodedUsername = encodeURIComponent(username)
    const encodedPassword = password ? `:${encodeURIComponent(password)}` : ''
    const auth = username || password ? `${encodedUsername}${encodedPassword}@` : ''

    return `${schema}://${auth}${formattedHost}:${port}`
  }

  if (requestProxyMode === RequestProxyMode.Custom) {
    return normalizeRequestProxy(customProxy?.trim() || appSettings.app.customProxy)
  }

  // Let the backend resolve the environment for each destination, including
  // HTTP_PROXY/HTTPS_PROXY and NO_PROXY. An explicit URL would bypass NO_PROXY.
  return ''
}

export const restartApp = async () => {
  await RestartApp()
  await new Promise((resolve) => setTimeout(resolve, 1500))
  WindowReloadApp()
}

// Others
export const handleUseProxy = async (
  group: any,
  proxy: any,
  options: { refresh?: boolean } = {},
) => {
  if (group.type !== 'Selector' || group.now === proxy.name) return
  const appSettings = useAppSettingsStore()
  const kernelApiStore = useKernelApiStore()
  const connections = appSettings.app.kernel.autoClose ? (await getConnections()).connections : []
  const key = kernelApiStore.getNodePreferenceKey(proxy.name)
  await useProxy(encodeURIComponent(group.name), proxy.name)
  appSettings.app.nodePreferences.recent = rememberNode(appSettings.app.nodePreferences.recent, key)
  await Promise.all(
    (connections || [])
      .filter((connection) => connection.chains.includes(group.name))
      .map((connection) => deleteConnection(connection.id)),
  )
  if (options.refresh !== false) {
    await kernelApiStore.refreshProviderProxies()
  }
}

export const handleChangeMode = async (mode: 'direct' | 'global' | 'rule') => {
  const kernelApiStore = useKernelApiStore()

  if (mode === kernelApiStore.config.mode) return

  await kernelApiStore.updateConfig('mode', mode)
  if (!useAppSettingsStore().app.kernel.autoClose) return

  const { connections } = await getConnections()
  const promises = (connections || []).map((v) => deleteConnection(v.id))
  await Promise.all(promises)
}

export const addToRuleSet = async (
  id: 'direct' | 'reject' | 'proxy',
  payloads: Record<string, any>[],
) => useRulesetsStore().appendRules(id, payloads)

export const reloadApp = async () => {
  const { t } = i18n.global
  const appStore = useAppStore()
  const pluginsStore = usePluginsStore()

  appStore.isAppReloading = true

  let timedout = false
  const { destroy } = message.info('titlebar.reloadPending', 10 * 60 * 1000)

  const timeoutId = setTimeout(async () => {
    timedout = true
    appStore.isAppReloading = false
    destroy()
    confirm('Warning', t('titlebar.reloadTimeout')).then(WindowReloadApp, () => {})
  }, 10_000)

  try {
    await pluginsStore.onReloadTrigger()
    if (!timedout) {
      clearTimeout(timeoutId)
      WindowReloadApp()
    }
  } catch (err: any) {
    clearTimeout(timeoutId)
    confirm('Error', t('titlebar.reloadError', { reason: err })).then(WindowReloadApp, () => {})
  }

  appStore.isAppReloading = false
  destroy()
}

export const getKernelFileName = (isAlpha = false) => {
  const envStore = useEnvStore()
  const { os } = envStore.env
  const fileSuffix = { windows: '.exe', linux: '', darwin: '' }[os]
  const latest = isAlpha ? '-latest' : ''
  return `sing-box${latest}${fileSuffix}`
}

export const getKernelAssetFileName = (version: string) => {
  const envStore = useEnvStore()
  const { os, arch } = envStore.env
  const suffix = { windows: '.zip', linux: '.tar.gz', darwin: '.tar.gz' }[os]
  return `sing-box-${version}-${os}-${arch}${suffix}`
}

export const processMagicVariables = (str: string) => {
  const { env } = useEnvStore()
  let result = str
  Object.entries({
    $APP_BASE_PATH: env.basePath,
    $CORE_BASE_PATH: CoreWorkingDirectory,
  }).forEach(([source, target]) => {
    result = result.replaceAll(source, target)
  })
  return result
}

export const getKernelRuntimeEnv = (isAlpha = false) => {
  const appSettings = useAppSettingsStore()
  const { env } = isAlpha ? appSettings.app.kernel.alpha : appSettings.app.kernel.main
  return Object.entries(env).reduce((p, [key, value]) => {
    p[key] = processMagicVariables(value)
    return p
  }, {} as Recordable)
}

export const getKernelRuntimeArgs = (isAlpha = false) => {
  const appSettings = useAppSettingsStore()
  const { args } = isAlpha ? appSettings.app.kernel.alpha : appSettings.app.kernel.main
  return args.map((arg) => processMagicVariables(arg))
}
