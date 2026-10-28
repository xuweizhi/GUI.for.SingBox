import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import {
  getProxies,
  getConfigs,
  setConfigs,
  onLogs,
  onMemory,
  onConnections,
  onTraffic,
  initWebsocket,
  destroyWebsocket,
  probeApiAvailability,
} from '@/api/kernel'
import {
  ProcessInfo,
  KillProcess,
  Exec,
  ExecBackground,
  AbsolutePath,
  FileExists,
  MoveFile,
  ReadFile,
  RemoveFile,
  WriteFile,
  FindListeningProcess,
} from '@/bridge'
import {
  CoreConfigFilePath,
  CoreConfigBackupFilePath,
  CoreConfigStagedFilePath,
  CorePidFilePath,
  CoreWorkingDirectory,
  getCoreLogFilePath,
} from '@/constant/kernel'
import { DefaultInboundMixed } from '@/constant/profile'
import { Branch } from '@/enums/app'
import { Inbound, RulesetType, TunStack } from '@/enums/kernel'
import {
  useAppSettingsStore,
  useProfilesStore,
  useLogsStore,
  usePluginsStore,
  useSubscribesStore,
  useRulesetsStore,
  useNodeGroupsStore,
} from '@/stores'
import {
  getProxyProfileOptionsFromRuntime,
  resolveRuntimeInboundState,
} from '@/stores/kernelApiRuntime'
import { resolveCoreStopPid } from '@/stores/kernelProcess'
import {
  generateConfigFile,
  getKernelFileName,
  restoreProfile,
  deepClone,
  getKernelRuntimeArgs,
  getKernelRuntimeEnv,
  eventBus,
  sleep,
  replaceFileWithRollback,
} from '@/utils'
import { explainCoreConfigCheckError } from '@/utils/coreConfigValidation'
import { profileUsesSubscription, getNodeGroupDependencies } from '@/utils/nodeGroup'

import type { CoreApiConfig, CoreApiProxy } from '@/types/kernel'

const CORE_START_TIMEOUT = 30_000

export type ProxyType = 'mixed' | 'http' | 'socks'
export type ProxyEndpoint = {
  schema: 'http' | 'socks5'
  host: string
  port: number
  username: string
  password: string
  proxyType: ProxyType
}

export const useKernelApiStore = defineStore('kernelApi', () => {
  const logsStore = useLogsStore()
  const pluginsStore = usePluginsStore()
  const profilesStore = useProfilesStore()
  const subscribesStore = useSubscribesStore()
  const rulesetsStore = useRulesetsStore()
  const nodeGroupsStore = useNodeGroupsStore()
  const appSettingsStore = useAppSettingsStore()

  /** RESTful API */
  const config = ref<CoreApiConfig>({
    port: 0,
    'mixed-port': 0,
    'socks-port': 0,
    'interface-name': '',
    'allow-lan': false,
    mode: '',
    tun: {
      enable: false,
      stack: '',
      device: '',
    },
  })

  let runtimeProfile: App.Profile | undefined

  const proxies = ref<Record<string, CoreApiProxy>>({})

  const refreshConfig = async () => {
    const _config = await getConfigs()

    config.value = {
      ..._config,
      tun: config.value.tun,
    }

    if (!runtimeProfile) {
      const txt = await ReadFile(CoreConfigFilePath)
      runtimeProfile = restoreProfile(JSON.parse(txt))
      const profile = profilesStore.currentProfile
      if (profile) {
        const _profile = deepClone(profile)
        _profile.inbounds.forEach((inbound) => {
          const runtimeInbound = runtimeProfile?.inbounds.find((v) => v.tag === inbound.tag)
          if (runtimeInbound) {
            runtimeInbound.id = inbound.id
          } else {
            inbound.enable = false
            runtimeProfile?.inbounds.push(inbound)
          }
        })
        runtimeProfile.id = _profile.id
        runtimeProfile.outbounds = _profile.outbounds
        runtimeProfile.native = _profile.native
        runtimeProfile.experimental = _profile.experimental
        runtimeProfile.dns = _profile.dns
        runtimeProfile.route = _profile.route
        runtimeProfile.mixin = _profile.mixin
        runtimeProfile.script = _profile.script
      }
    }

    const runtimeInboundState = resolveRuntimeInboundState(runtimeProfile.inbounds)
    config.value['mixed-port'] = runtimeInboundState.mixedPort
    config.value['port'] = runtimeInboundState.httpPort
    config.value['socks-port'] = runtimeInboundState.socksPort
    config.value['allow-lan'] = runtimeInboundState.allowLan

    config.value.tun.enable = runtimeInboundState.tunEnable
    config.value.tun.device = runtimeInboundState.tunDevice
    config.value.tun.stack = runtimeInboundState.tunStack
    config.value['interface-name'] = runtimeProfile.route.default_interface
  }

  const resetConfig = () => {
    config.value.port = 0
    config.value['socks-port'] = 0
    config.value['mixed-port'] = 0
    config.value['interface-name'] = ''
    config.value['allow-lan'] = false
    config.value.mode = ''
    config.value.tun.enable = false
    config.value.tun.stack = ''
    config.value.tun.device = ''
  }

  const updateConfig = async (field: string, value: any) => {
    if (field === 'mode') {
      await setConfigs({ mode: value })
      await refreshConfig()
      return
    }

    const patchInbound = () => {
      if (!runtimeProfile) return
      const inbound = runtimeProfile.inbounds.find(
        (v) =>
          (v.type === Inbound.Mixed && v.mixed?.listen.listen_port) ||
          (v.type === Inbound.Http && v.http?.listen.listen_port) ||
          (v.type === Inbound.Socks && v.socks?.listen.listen_port),
      )
      if (!inbound) {
        throw 'home.overview.needPort'
      }
      inbound.enable = true
    }

    const patchInboundPort = (type: 'mixed' | 'socks' | 'http', port: number) => {
      if (!runtimeProfile) return
      let inbound = runtimeProfile.inbounds.find((v) => v.type === type)
      if (inbound) {
        inbound[type]!.listen.listen_port = port
      } else {
        const _type = DefaultInboundMixed()!
        _type.listen.listen_port = port
        inbound = {
          id: type + '-in',
          tag: type + '-in',
          type: type,
          enable: true,
          [type]: _type,
        }
        runtimeProfile.inbounds.push(inbound)
      }
      inbound.enable = port !== 0
    }

    const patchInboundAddress = (allowLan: boolean) => {
      if (!runtimeProfile) return
      runtimeProfile.inbounds.forEach((inbound) => {
        if (inbound.type === Inbound.Tun) return
        inbound[inbound.type]!.listen.listen = allowLan ? '0.0.0.0' : '127.0.0.1'
      })
    }

    const patchInboundTun = (options: {
      enable: boolean
      stack: string
      device: string
      interface_name: string
    }) => {
      if (!runtimeProfile) return
      const inbound = runtimeProfile.inbounds.find((v) => v.type === Inbound.Tun)
      if (!inbound) throw 'home.overview.needTun'
      options = { ...config.value.tun, ...options }
      inbound.enable = options.enable
      inbound.tun!.stack = (options.stack || TunStack.Mixed) as App.TunStack
      inbound.tun!.interface_name = options.device || ''
      if (options.interface_name) {
        runtimeProfile.route.default_interface = options.interface_name
      }
      runtimeProfile.route.auto_detect_interface = !options.interface_name
    }

    const fieldHandlerMap: Recordable<() => void> = {
      inbound: () => patchInbound(),
      http: () => patchInboundPort(Inbound.Http, value),
      socks: () => patchInboundPort(Inbound.Socks, value),
      mixed: () => patchInboundPort(Inbound.Mixed, value),
      'allow-lan': () => patchInboundAddress(value),
      tun: () => patchInboundTun(value),
      'tun-stack': () => patchInboundTun(value),
      'tun-device': () => patchInboundTun(value),
      'interface-name': () => patchInboundTun(value),
    }

    fieldHandlerMap[field]?.()

    await restartCore(undefined, true)
  }

  const refreshProviderProxies = async () => {
    const { proxies: b } = await getProxies()
    proxies.value = b
  }

  /* Bridge API */
  const corePid = ref(-1)
  const running = ref(false)
  const starting = ref(false)
  const stopping = ref(false)
  const restarting = ref(false)
  const needRestart = ref(false)
  const coreStateLoading = ref(true)
  let isCoreStartedByThisInstance = false
  let processGeneration = 0
  type StartedCore = { pid: number; generation: number; exited: () => boolean }
  let stopTransition: { generation: number; promise: Promise<void> } | undefined
  let { promise: coreStoppedPromise, resolve: coreStoppedResolver } = Promise.withResolvers()

  onLogs((data) => logsStore.recordKernelApiLog(data))

  const refreshKernelLogs = async () => {
    const logs = await ReadFile(getCoreLogFilePath(), { Range: '-4096' }).catch(() => '')
    logsStore.hydrateKernelLogs(logs)
  }

  const getCoreControllerPort = () => {
    const controller =
      profilesStore.currentProfile?.experimental.clash_api.external_controller || '127.0.0.1:20123'

    if (controller.startsWith('[')) {
      const match = controller.match(/^\[[^\]]+\](?::(\d+))?$/)
      return Number(match?.[1] || 20123)
    }

    const separatorIndex = controller.lastIndexOf(':')
    if (separatorIndex === -1) {
      return 20123
    }

    return Number(controller.slice(separatorIndex + 1)) || 20123
  }

  const syncExistingCoreState = async () => {
    const apiOk = await probeApiAvailability().catch(() => false)
    if (!apiOk) {
      return false
    }

    await refreshKernelLogs()

    corePid.value = await FindListeningProcess(getCoreControllerPort()).catch(() => -1)
    if (corePid.value > 0) {
      await WriteFile(CorePidFilePath, String(corePid.value)).catch(() => 0)
    }

    running.value = true
    needRestart.value = false
    isCoreStartedByThisInstance = false

    initWebsocket()
    await Promise.all([refreshConfig(), refreshProviderProxies()])

    return true
  }

  const initCoreState = async () => {
    await refreshKernelLogs()

    corePid.value = Number(await ReadFile(CorePidFilePath).catch(() => -1))
    const processName = corePid.value === -1 ? '' : await ProcessInfo(corePid.value).catch(() => '')
    running.value = processName.startsWith('sing-box')

    coreStateLoading.value = false

    if (running.value) {
      initWebsocket()
      await Promise.all([refreshConfig(), refreshProviderProxies()])
    } else if (await syncExistingCoreState()) {
      return
    } else if (appSettingsStore.app.autoStartKernel) {
      await startCore()
    }
  }

  const runCoreProcess = async (isAlpha: boolean, onSpawn: (process: StartedCore) => void) => {
    let stopped = false
    const generation = ++processGeneration
    const pid = await ExecBackground(
      CoreWorkingDirectory + '/' + getKernelFileName(isAlpha),
      getKernelRuntimeArgs(isAlpha),
      undefined,
      async (end) => {
        stopped = true
        const logs = await ReadFile(getCoreLogFilePath(), { Range: '-4096' }).catch((err) =>
          String(err),
        )
        if (generation !== processGeneration) return
        logsStore.hydrateKernelLogs(logs)
        end && logsStore.recordKernelLog(end)
        await onCoreStopped(generation)
      },
      {
        PidFile: CorePidFilePath,
        LogFile: getCoreLogFilePath(),
        Env: getKernelRuntimeEnv(isAlpha),
      },
    )
    const process = { pid, generation, exited: () => stopped }
    onSpawn(process)
    const deadline = Date.now() + CORE_START_TIMEOUT
    while (true) {
      if (stopped) throw 'Startup failed. Check logs for details.'
      const ok = await probeApiAvailability().catch(() => false)
      if (stopped || generation !== processGeneration)
        throw 'Startup failed. Check logs for details.'
      if (ok) break
      if (Date.now() >= deadline) {
        throw 'Core startup timed out after 30 seconds. Check logs for details.'
      }
      await sleep(500)
    }
    return process
  }

  const onCoreStarted = async (process: StartedCore) => {
    const { pid, generation, exited } = process
    if (exited() || generation !== processGeneration)
      throw new Error('Core exited before startup completed')
    corePid.value = pid
    running.value = true
    needRestart.value = false
    isCoreStartedByThisInstance = true
    coreStoppedPromise = new Promise((r) => (coreStoppedResolver = r))

    initWebsocket()
    await Promise.all([refreshConfig(), refreshProviderProxies()])
    if (exited() || generation !== processGeneration)
      throw new Error('Core exited before startup completed')

    await pluginsStore.onCoreStartedTrigger()
    if (exited() || generation !== processGeneration)
      throw new Error('Core exited before startup completed')
  }

  const onCoreStopped = (generation = processGeneration): Promise<void> => {
    if (generation !== processGeneration) return Promise.resolve()
    if (stopTransition?.generation === generation) return stopTransition.promise
    const resolveStopped = coreStoppedResolver
    const promise = Promise.resolve().then(async () => {
      if (generation !== processGeneration) return
      if (!isCoreStartedByThisInstance) {
        await RemoveFile(CorePidFilePath).catch((error) => logsStore.recordKernelLog(String(error)))
      }
      if (generation !== processGeneration) return
      corePid.value = -1
      running.value = false
      needRestart.value = false
      destroyWebsocket()
      resetConfig()
      try {
        await pluginsStore.onCoreStoppedTrigger()
      } finally {
        resolveStopped(null)
      }
    })
    stopTransition = { generation, promise }
    return promise
  }

  const startCore = async (_profile?: App.Profile) => {
    if (running.value) throw 'The core is already running'
    if (starting.value) throw 'The core is already starting'
    starting.value = true
    ++processGeneration
    let startedProcess: StartedCore | undefined
    try {
      if (await syncExistingCoreState()) return

      logsStore.clearKernelLog()

      const { profile: profileID, branch } = appSettingsStore.app.kernel
      const profile = _profile || profilesStore.getProfileById(profileID)
      if (!profile) throw 'Choose a profile first'

      if (!_profile) {
        runtimeProfile = undefined
      }

      const isAlpha = branch === Branch.Alpha
      const coreFilePath = `${CoreWorkingDirectory}/${getKernelFileName(isAlpha)}`
      await RemoveFile(CoreConfigStagedFilePath).catch(() => undefined)
      let stagedConfig: unknown
      await generateConfigFile(
        profile,
        async (config) => {
          stagedConfig = await pluginsStore.onBeforeCoreStartTrigger(config, profile)
          return stagedConfig
        },
        CoreConfigStagedFilePath,
      )
      try {
        await Exec(
          coreFilePath,
          [
            'check',
            '--disable-color',
            '-c',
            await AbsolutePath(CoreConfigStagedFilePath),
            '-D',
            await AbsolutePath(CoreWorkingDirectory),
          ],
          {
            Env: getKernelRuntimeEnv(isAlpha),
            WorkingDirectory: CoreWorkingDirectory,
          },
        ).catch((error) => {
          throw explainCoreConfigCheckError(error, stagedConfig)
        })
        await replaceFileWithRollback(
          {
            activePath: CoreConfigFilePath,
            replacementPath: CoreConfigStagedFilePath,
            backupPath: CoreConfigBackupFilePath,
          },
          { exists: FileExists, move: MoveFile, remove: RemoveFile },
        )
      } catch (error) {
        await RemoveFile(CoreConfigStagedFilePath).catch(() => undefined)
        throw error
      }
      startedProcess = await runCoreProcess(isAlpha, (process) => {
        startedProcess = process
      })
      await onCoreStarted(startedProcess)
    } catch (error) {
      if (startedProcess && startedProcess.generation === processGeneration) {
        let cleanupError: unknown
        if (!startedProcess.exited()) {
          await KillProcess(startedProcess.pid, 3).catch((failure) => {
            cleanupError = failure
          })
        }
        await onCoreStopped(startedProcess.generation)
        if (cleanupError && !startedProcess.exited())
          throw new Error(
            `${String(error)}; failed to stop core after startup failure: ${String(cleanupError)}`,
            { cause: error },
          )
      }
      throw error
    } finally {
      starting.value = false
    }
  }

  const stopCore = async () => {
    if (!running.value) throw 'The core is not running'

    stopping.value = true
    try {
      await pluginsStore.onBeforeCoreStopTrigger()
      const pid = await resolveCoreStopPid(
        corePid.value,
        getCoreControllerPort(),
        FindListeningProcess,
        () => ReadFile(CorePidFilePath),
      )
      corePid.value = pid
      await KillProcess(pid)
      await (isCoreStartedByThisInstance ? coreStoppedPromise : onCoreStopped())
    } finally {
      stopping.value = false
    }
  }

  const restartCore = async (cleanupTask?: () => Promise<any>, keepRuntimeProfile = false) => {
    restarting.value = true
    try {
      await stopCore()
      await cleanupTask?.()
      await startCore(keepRuntimeProfile ? runtimeProfile : undefined)
    } finally {
      needRestart.value = false
      restarting.value = false
    }
  }

  const getProxyProfileOptions = (proxyType: ProxyType) => {
    return getProxyProfileOptionsFromRuntime(runtimeProfile?.inbounds || [], proxyType)
  }

  const getProxyEndpoint = (): ProxyEndpoint | undefined => {
    const { port, 'socks-port': socksPort, 'mixed-port': mixedPort } = config.value
    let targetPort = 0
    let proxyType: ProxyType | undefined

    if (mixedPort) {
      targetPort = mixedPort
      proxyType = 'mixed'
    } else if (port) {
      targetPort = port
      proxyType = 'http'
    } else if (socksPort) {
      targetPort = socksPort
      proxyType = 'socks'
    } else {
      return undefined
    }

    const { host, username, password } = getProxyProfileOptions(proxyType)
    const schema = proxyType === 'socks' ? 'socks5' : 'http'

    return {
      schema,
      host,
      port: targetPort,
      username,
      password,
      proxyType,
    }
  }

  eventBus.on('profileChange', ({ id }) => {
    if (running.value && id === appSettingsStore.app.kernel.profile) {
      needRestart.value = true
    }
  })

  eventBus.on('nodeGroupChange', ({ id }) => {
    const profile = profilesStore.currentProfile
    if (running.value && profile && getNodeGroupDependencies(id, [profile]).length)
      needRestart.value = true
  })

  eventBus.on('subscriptionChange', ({ id }) => {
    const profile = profilesStore.currentProfile
    if (
      running.value &&
      profile &&
      profileUsesSubscription(profile, id, nodeGroupsStore.nodeGroups)
    )
      needRestart.value = true
  })

  eventBus.on('subscriptionsChange', (change) => {
    const profile = profilesStore.currentProfile
    const ids = change?.ids || subscribesStore.subscribes.map((subscription) => subscription.id)
    if (
      running.value &&
      profile &&
      ids.some((id) => profileUsesSubscription(profile, id, nodeGroupsStore.nodeGroups))
    )
      needRestart.value = true
  })

  const collectRulesetIDs = () => {
    if (!profilesStore.currentProfile) return []
    const l1 = profilesStore.currentProfile.route.rule_set.flatMap((ruleset) =>
      ruleset.type === RulesetType.Local ? ruleset.path : [],
    )
    return l1
  }

  eventBus.on('rulesetChange', ({ id }) => {
    if (running.value && profilesStore.currentProfile) {
      const inUse = profilesStore.currentProfile.route.rule_set.some(
        (ruleset) => ruleset.type === RulesetType.Local && ruleset.path === id,
      )
      if (inUse) {
        needRestart.value = true
      }
    }
  })

  eventBus.on('rulesetsChange', () => {
    if (running.value && profilesStore.currentProfile) {
      const enabledRulesets = rulesetsStore.rulesets.flatMap((v) => (v.disabled ? [] : v.id))
      const inUse = collectRulesetIDs().some((v) => enabledRulesets.includes(v))
      if (inUse) {
        needRestart.value = true
      }
    }
  })

  watch(needRestart, (v) => {
    if (v && appSettingsStore.app.autoRestartKernel) {
      restartCore()
    }
  })

  return {
    startCore,
    stopCore,
    restartCore,
    initCoreState,
    pid: corePid,
    running,
    starting,
    stopping,
    restarting,
    needRestart,
    coreStateLoading,
    config,
    proxies,
    refreshConfig,
    updateConfig,
    refreshProviderProxies,
    refreshKernelLogs,
    getProxyEndpoint,

    onLogs,
    onMemory,
    onTraffic,
    onConnections,
  }
})
