import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'

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
  FindOwnedCore,
  StopOwnedCore,
  ReadCoreLog,
  Exec,
  ExecBackground,
  AbsolutePath,
  FileExists,
  MoveFile,
  ReadFile,
  RemoveFile,
  WriteFile,
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
import {
  legacyNodeKeys,
  profileNodeKey,
  readNodeCatalog,
  type NodeCatalog,
} from '@/utils/nodePreferences'

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

  const catalogPath = CoreWorkingDirectory + '/node-identities.json'
  const nodeCatalog = shallowRef<NodeCatalog>()
  const nodeKeys = computed(() =>
    nodeCatalog.value
      ? new Map(nodeCatalog.value.nodes)
      : legacyNodeKeys(profilesStore.currentProfile, subscribesStore.subscribes),
  )
  const getNodePreferenceKey = (tag: string) =>
    nodeKeys.value.get(tag) ||
    profileNodeKey(
      nodeCatalog.value?.profileId ?? profilesStore.currentProfile?.id ?? '',
      'tag',
      tag,
    )

  const refreshConfig = async () => {
    const revision = refreshRevision
    const _config = await getConfigs()
    if (revision !== refreshRevision) return

    if (!runtimeProfile) {
      const txt = await ReadFile(CoreConfigFilePath)
      const catalogText = await ReadFile(catalogPath).catch(() => '')
      if (revision !== refreshRevision) return
      nodeCatalog.value = readNodeCatalog(txt, catalogText)
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

    if (revision !== refreshRevision) return
    config.value = { ..._config, tun: config.value.tun }
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

    const patchInboundTun = (options: { enable: boolean; stack: string; device: string }) => {
      if (!runtimeProfile) return
      const inbound = runtimeProfile.inbounds.find((v) => v.type === Inbound.Tun)
      if (!inbound) throw 'home.overview.needTun'
      options = { ...config.value.tun, ...options }
      inbound.enable = options.enable
      inbound.tun!.stack = (options.stack || TunStack.Mixed) as App.TunStack
      inbound.tun!.interface_name = options.device || ''
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
      'interface-name': () => {
        if (!runtimeProfile) return
        runtimeProfile.route.default_interface = value.interface_name || ''
        runtimeProfile.route.auto_detect_interface = !value.interface_name
      },
    }

    assertCoreIdle()
    const previous = runtimeProfile
    if (runtimeProfile) runtimeProfile = deepClone(runtimeProfile)
    try {
      fieldHandlerMap[field]?.()
      await restartCore(undefined, true)
    } catch (error) {
      runtimeProfile = previous
      throw error
    }
  }

  const refreshProviderProxies = async () => {
    const revision = refreshRevision
    const { proxies: b } = await getProxies()
    if (revision === refreshRevision) proxies.value = b
  }

  /* Bridge API */
  const corePid = ref(-1)
  const running = ref(false)
  const starting = ref(false)
  const stopping = ref(false)
  const restarting = ref(false)
  const needRestart = ref(false)
  const coreStateLoading = ref(true)
  let processGeneration = 0
  let sessionRevision = 0
  let refreshRevision = 0
  type StartedCore = { pid: number; generation: number; exited: () => boolean }
  let stopTransition: { generation: number; promise: Promise<void> } | undefined

  onLogs((data) => logsStore.recordKernelApiLog(data))

  const refreshKernelLogs = async (reload = false) => {
    const revision = sessionRevision
    const logs = await ReadCoreLog().catch(() => '')
    if (revision === sessionRevision) logsStore.hydrateKernelLogs(logs, reload)
  }

  const findOwnedCore = () => {
    const branch = appSettingsStore.app.kernel.branch
    return FindOwnedCore(branch, getKernelRuntimeArgs(branch === Branch.Alpha))
  }

  const detachCore = () => {
    ++processGeneration
    ++sessionRevision
    ++refreshRevision
    needRestart.value = false
    destroyWebsocket()
    running.value = false
    corePid.value = -1
    coreStateLoading.value = false
    runtimeProfile = undefined
    nodeCatalog.value = undefined
    proxies.value = {}
    resetConfig()
  }
  const attachCore = async (pid: number) => {
    const generation = processGeneration
    try {
      await Promise.all([refreshConfig(), refreshProviderProxies()])
      if (generation !== processGeneration) return
      initWebsocket()
      corePid.value = pid
      running.value = true
      needRestart.value = false
    } catch (error) {
      if (generation === processGeneration) detachCore()
      throw error
    }
  }

  const initCoreState = async () => {
    const generation = processGeneration
    const session = sessionRevision
    coreStateLoading.value = true
    try {
      await refreshKernelLogs()
      if (generation !== processGeneration) return
      const pid = await findOwnedCore()
      if (generation !== processGeneration) return
      if (pid > 0) await attachCore(pid)
      else if (appSettingsStore.app.autoStartKernel) await startCore()
    } finally {
      if (session === sessionRevision) coreStateLoading.value = false
    }
  }

  const runCoreProcess = async (
    isAlpha: boolean,
    generation: number,
    onSpawn: (process: StartedCore) => void,
  ) => {
    let stopped = false
    if (generation !== processGeneration) throw new Error('Core startup cancelled')
    const pid = await ExecBackground(
      CoreWorkingDirectory + '/' + getKernelFileName(isAlpha),
      getKernelRuntimeArgs(isAlpha),
      undefined,
      async (end) => {
        stopped = true
        if (generation !== processGeneration) return
        const logs = await ReadCoreLog().catch((err) => String(err))
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
    const promise = Promise.resolve().then(async () => {
      if (generation !== processGeneration) return
      ++refreshRevision
      proxies.value = {}
      corePid.value = -1
      running.value = false
      needRestart.value = false
      destroyWebsocket()
      resetConfig()
      await pluginsStore.onCoreStoppedTrigger()
    })
    stopTransition = { generation, promise }
    return promise
  }

  const doStartCore = async (_profile?: App.Profile) => {
    if (running.value) throw 'The core is already running'
    if (starting.value) throw 'The core is already starting'
    starting.value = true
    const generation = ++processGeneration
    ++refreshRevision
    let startedProcess: StartedCore | undefined
    try {
      if (await probeApiAvailability().catch(() => false)) {
        const pid = await findOwnedCore()
        if (generation !== processGeneration) throw new Error('Core startup cancelled')
        if (pid <= 0) throw new Error('The controller belongs to another process')
        await attachCore(pid)
        return
      }

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
      const catalog = await generateConfigFile(
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
        if (generation !== processGeneration) throw new Error('Core startup cancelled')
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
      if (generation !== processGeneration) throw new Error('Core startup cancelled')
      nodeCatalog.value = catalog
      if (catalog) {
        await WriteFile(catalogPath, JSON.stringify(catalog)).catch((error) =>
          logsStore.recordKernelLog(String(error)),
        )
      }
      startedProcess = await runCoreProcess(isAlpha, generation, (process) => {
        startedProcess = process
      })
      await onCoreStarted(startedProcess)
    } catch (error) {
      if (startedProcess && startedProcess.generation === processGeneration) {
        let cleanupError: unknown
        if (!startedProcess.exited()) {
          await StopOwnedCore(startedProcess.pid, 3).catch((failure) => {
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

  const doStopCore = async () => {
    if (!running.value) throw 'The core is not running'

    stopping.value = true
    try {
      await pluginsStore.onBeforeCoreStopTrigger()
      const generation = processGeneration
      const pid = corePid.value > 0 ? corePid.value : await findOwnedCore()
      await StopOwnedCore(pid)
      await onCoreStopped(generation)
    } finally {
      stopping.value = false
    }
  }

  const assertCoreIdle = () => {
    if (starting.value || stopping.value || restarting.value)
      throw new Error('A core operation is already in progress')
  }
  const startCore = async (profile?: App.Profile) => {
    assertCoreIdle()
    await doStartCore(profile)
  }
  const stopCore = async () => {
    assertCoreIdle()
    await doStopCore()
  }
  const restartCore = async (cleanupTask?: () => Promise<any>, keepRuntimeProfile = false) => {
    assertCoreIdle()
    restarting.value = true
    const session = sessionRevision
    try {
      await doStopCore()
      if (session !== sessionRevision) return
      await cleanupTask?.()
      if (session !== sessionRevision) return
      await doStartCore(keepRuntimeProfile ? runtimeProfile : undefined)
    } finally {
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
      void restartCore().catch((error) => logsStore.recordKernelLog(String(error)))
    }
  })

  return {
    startCore,
    stopCore,
    restartCore,
    initCoreState,
    detachCore,
    pid: corePid,
    running,
    starting,
    stopping,
    restarting,
    needRestart,
    coreStateLoading,
    config,
    proxies,
    getNodePreferenceKey,
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
