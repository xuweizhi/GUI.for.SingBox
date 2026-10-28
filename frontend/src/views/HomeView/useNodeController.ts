import { computed, onScopeDispose, ref } from 'vue'

import { DefaultConcurrencyLimit, DefaultTestTimeout, DefaultTestURL } from '@/constant/app'
import {
  useAppSettingsStore,
  useKernelApiStore,
  useNodeGroupsStore,
  useProfilesStore,
  useSubscribesStore,
} from '@/stores'
import { handleUseProxy } from '@/utils/helper'
import { normalizeErrorMessage } from '@/utils/others'
import { getOutboundRole } from '@/utils/outboundPolicy'
import { getNodeGroupRuntimeNames } from '@/utils/nodeGroup'
import {
  filterAndSortNodes,
  getDelayTestableNodeNames,
  isDelayTestableNode,
  getVisibleGroups,
  resolvePrimaryProxyGroup,
  resolvePrimaryNode,
} from '@/views/HomeView/nodeController'
import { nodeLatencyScheduler } from '@/views/HomeView/nodeLatencyScheduler'

import type { NodeDelayError, NodeMode } from '@/views/HomeView/nodeController'
import type {
  LatencyNodePhase,
  LatencyResult,
  LatencyTaskHandle,
} from '@/views/HomeView/nodeLatencyScheduler'

export type NodeOperationResult = { ok: true } | { ok: false; error: string }

export interface BatchTestState {
  running: boolean
  cancelled: boolean
  total: number
  completed: number
  success: number
  failure: number
}

const POLL_INTERVAL = 5_000
const emptyBatch = (): BatchTestState => ({
  running: false,
  cancelled: false,
  total: 0,
  completed: 0,
  success: 0,
  failure: 0,
})

export const useNodeController = () => {
  const appSettingsStore = useAppSettingsStore()
  const kernelApiStore = useKernelApiStore()
  const profilesStore = useProfilesStore()
  const nodeGroupsStore = useNodeGroupsStore()
  const subscribesStore = useSubscribesStore()

  const selectedGroupName = ref('')
  const query = ref('')
  const sortByDelay = ref(false)
  const nodeGroupFilter = ref('__all')
  const nodeErrors = ref(new Map<string, NodeDelayError>())
  const localDelays = ref(new Map<string, number>())
  const nodeAttempts = ref(new Map<string, number>())
  const testingNodes = ref(new Set<string>())
  const nodePhases = ref(new Map<string, LatencyNodePhase>())
  const switchingNode = ref('')
  const batch = ref<BatchTestState>(emptyBatch())
  const stale = ref(false)
  const refreshError = ref('')

  const mode = computed(() => kernelApiStore.config.mode as NodeMode)
  const groups = computed(() =>
    getVisibleGroups(mode.value, profilesStore.currentProfile, kernelApiStore.proxies),
  )
  const primary = computed(() =>
    resolvePrimaryNode(mode.value, profilesStore.currentProfile, kernelApiStore.proxies),
  )
  const proxyGroup = computed(() =>
    resolvePrimaryProxyGroup(profilesStore.currentProfile, kernelApiStore.proxies),
  )
  const proxyActive = computed(() => {
    if (mode.value === 'rule') return true
    if (mode.value === 'direct') return false
    return !!primary.value.leaf && !['Direct', 'Reject'].includes(primary.value.leaf.type)
  })
  const selectedGroup = computed(
    () =>
      kernelApiStore.proxies[selectedGroupName.value] ||
      groups.value.find((group) => group.name === selectedGroupName.value),
  )
  const readonlyMode = computed(
    () => mode.value === 'direct' || selectedGroup.value?.type !== 'Selector',
  )
  const nodeGroupRuntimeMap = computed(() => {
    const runtimeNames = selectedGroup.value?.all || []
    return new Map(
      nodeGroupsStore.nodeGroups.flatMap((group) => {
        const names = getNodeGroupRuntimeNames(
          nodeGroupsStore.resolveGroup(group), runtimeNames, subscribesStore.subscribes,
        )
        return names.size ? [[group.id, names] as const] : []
      }),
    )
  })
  const groupedRuntimeNames = computed(
    () => new Set([...nodeGroupRuntimeMap.value.values()].flatMap((names) => [...names])),
  )
  const nodeGroupFilterOptions = computed(() => [
    { label: 'nodeGroups.all', value: '__all' },
    ...nodeGroupsStore.nodeGroups.flatMap((group) =>
      nodeGroupRuntimeMap.value.has(group.id) ? [{ label: group.name, value: group.id }] : [],
    ),
    { label: 'nodeGroups.ungrouped', value: '__ungrouped' },
  ])
  const nodes = computed(() => {
    if (!selectedGroup.value) return []
    const profileOutbounds = profilesStore.currentProfile?.outbounds || []
    const outboundByTag = new Map(profileOutbounds.map((outbound) => [outbound.tag, outbound]))
    return filterAndSortNodes(
      selectedGroup.value,
      kernelApiStore.proxies,
      query.value,
      sortByDelay.value,
      nodeErrors.value,
      localDelays.value,
      nodeAttempts.value,
    )
      .map((node) => {
        const configured = outboundByTag.get(node.name)
        const role = configured ? getOutboundRole(configured) : undefined
        return {
          ...node,
          role,
          displayName:
            role === 'auto'
              ? 'home.nodes.automaticOption'
              : role === 'proxy'
                ? 'home.nodes.proxyOption'
                : undefined,
        }
      })
      .filter(
        (node) => !node.role || !['direct', 'block', 'fallback', 'global'].includes(node.role),
      )
      .filter((node) => !['Direct', 'Reject'].includes(node.proxy?.type || ''))
      .filter((node) => {
        if (nodeGroupFilter.value === '__all') return true
        if (nodeGroupFilter.value === '__ungrouped') {
          return !groupedRuntimeNames.value.has(node.name)
        }
        return nodeGroupRuntimeMap.value.get(nodeGroupFilter.value)?.has(node.name) || false
      })
  })

  let disposed = false
  let pollTimer: number | undefined
  let refreshPromise: Promise<void> | undefined
  let groupHandle: LatencyTaskHandle | undefined
  const activeHandles = new Set<LatencyTaskHandle>()
  const protectedLocalResults = new Set<string>()
  const nodeOwners = new Map<string, Set<symbol>>()

  const acquireNodes = (names: string[]) => {
    const token = Symbol('latency-task')
    names.forEach((name) => {
      const owners = nodeOwners.get(name) || new Set<symbol>()
      owners.add(token)
      nodeOwners.set(name, owners)
      testingNodes.value.add(name)
      protectedLocalResults.add(name)
    })
    return () => {
      names.forEach((name) => {
        const owners = nodeOwners.get(name)
        owners?.delete(token)
        if (owners?.size) return
        nodeOwners.delete(name)
        testingNodes.value.delete(name)
        protectedLocalResults.delete(name)
        if (nodePhases.value.get(name) === 'cancelled') nodePhases.value.delete(name)
      })
    }
  }

  const refresh = () => {
    if (!kernelApiStore.running) return Promise.resolve()
    if (!refreshPromise) {
      refreshPromise = kernelApiStore
        .refreshProviderProxies()
        .then(() => {
          if (disposed) return
          const localResultNames = new Set([
            ...nodeErrors.value.keys(),
            ...localDelays.value.keys(),
            ...nodeAttempts.value.keys(),
          ])
          localResultNames.forEach((name) => {
            if (protectedLocalResults.has(name)) return
            const history = kernelApiStore.proxies[name]?.history || []
            const latestDelay = history.at(-1)?.delay || 0
            if (latestDelay > 0) {
              nodeErrors.value.delete(name)
              localDelays.value.delete(name)
              nodeAttempts.value.delete(name)
            }
          })
          nodePhases.value.forEach((_phase, name) => {
            if (!kernelApiStore.proxies[name] && !nodeOwners.has(name))
              nodePhases.value.delete(name)
          })
          stale.value = false
          refreshError.value = ''
        })
        .catch((error) => {
          if (!disposed) {
            stale.value = true
            refreshError.value = normalizeErrorMessage(error)
          }
          throw error
        })
        .finally(() => {
          refreshPromise = undefined
        })
    }
    return refreshPromise
  }

  const refreshAfterMutation = async () => {
    const pendingRefresh = refreshPromise
    if (pendingRefresh) {
      await pendingRefresh.catch(() => undefined)
    }
    return refresh()
  }

  const prepareModal = async () => {
    let refreshFailure: unknown
    try {
      await refresh()
    } catch (error) {
      refreshFailure = error
    }
    selectedGroupName.value = proxyGroup.value?.name || groups.value[0]?.name || ''
    nodeGroupFilter.value = '__all'
    if (refreshFailure) throw refreshFailure
  }

  const selectGroup = (name: string) => {
    if (!groups.value.some((group) => group.name === name)) return
    selectedGroupName.value = name
    query.value = ''
    nodeGroupFilter.value = '__all'
  }

  const switchNode = async (name: string): Promise<NodeOperationResult> => {
    if (switchingNode.value) {
      return { ok: false, error: 'home.nodes.switching' }
    }

    if (selectedGroup.value?.now === name) {
      return { ok: true }
    }

    if (readonlyMode.value || selectedGroup.value?.type !== 'Selector') {
      return { ok: false, error: 'home.nodes.readonly' }
    }

    const proxy = kernelApiStore.proxies[name]
    if (!proxy) {
      return { ok: false, error: 'home.nodes.nodeMissing' }
    }

    const group = selectedGroup.value
    switchingNode.value = name
    try {
      await handleUseProxy(group, proxy, { refresh: false })
      await refreshAfterMutation()
      return { ok: true }
    } catch (error) {
      return { ok: false, error: normalizeErrorMessage(error) }
    } finally {
      if (!disposed) switchingNode.value = ''
    }
  }

  const applyState = (name: string, phase: LatencyNodePhase) => {
    if (disposed) return
    nodePhases.value.set(name, phase)
  }

  const applyResult = (result: LatencyResult) => {
    if (disposed) return
    const proxy = kernelApiStore.proxies[result.name]
    if (!proxy) return
    proxy.history ||= []
    proxy.history.push({ delay: result.ok ? result.delay : 0 })
    localDelays.value.set(result.name, result.ok ? result.delay : 0)
    if (result.ok) {
      nodeAttempts.value.set(result.name, result.attempts)
      nodeErrors.value.delete(result.name)
    } else {
      nodeAttempts.value.delete(result.name)
      nodeErrors.value.set(result.name, {
        category: result.category,
        message: result.message,
        attempts: result.attempts,
        maxAttempts: result.maxAttempts,
      })
    }
  }

  const submit = (names: string[], onResult: (result: LatencyResult) => void = applyResult) => {
    const release = acquireNodes(names)
    const handle = nodeLatencyScheduler.submit({
      nodes: names,
      url: appSettingsStore.app.kernel.testUrl || DefaultTestURL,
      timeout: appSettingsStore.app.kernel.testTimeout || DefaultTestTimeout,
      concurrency: appSettingsStore.app.kernel.concurrencyLimit || DefaultConcurrencyLimit,
      onState: applyState,
      onResult,
    })
    activeHandles.add(handle)
    void handle.done.finally(() => activeHandles.delete(handle))
    return { handle, release }
  }

  const testNode = async (name: string): Promise<NodeOperationResult> => {
    if (testingNodes.value.has(name)) {
      return { ok: false, error: 'home.nodes.alreadyTesting' }
    }
    const proxy = kernelApiStore.proxies[name]
    if (!proxy) return { ok: false, error: 'home.nodes.nodeMissing' }
    if (!isDelayTestableNode(name, proxy))
      return { ok: false, error: 'home.nodes.notDelayTestable' }
    let result: LatencyResult | undefined
    const { handle, release } = submit([name], (value) => {
      result = value
      applyResult(value)
    })
    try {
      const summary = await handle.done
      if (!disposed) await refresh().catch(() => undefined)
      if (disposed || summary.cancelled) return { ok: false, error: 'common.canceled' }
      return result?.ok
        ? { ok: true }
        : { ok: false, error: result?.message || 'home.nodes.unavailable' }
    } finally {
      activeHandles.delete(handle)
      release()
    }
  }

  const testGroup = async () => {
    if (batch.value.running || !selectedGroup.value) return

    const names = [
      ...new Set(getDelayTestableNodeNames(selectedGroup.value, kernelApiStore.proxies)),
    ].filter((name) => !testingNodes.value.has(name))
    batch.value = {
      running: true,
      cancelled: false,
      total: names.length,
      completed: 0,
      success: 0,
      failure: 0,
    }
    if (!names.length) {
      batch.value.running = false
      return
    }

    const { handle, release } = submit(names)
    groupHandle = handle

    try {
      const summary = await handle.done
      if (!disposed)
        batch.value = {
          running: false,
          cancelled: summary.cancelled,
          total: summary.total,
          completed: summary.completed,
          success: summary.success,
          failure: summary.failure,
        }
    } finally {
      groupHandle = undefined
      if (!disposed) {
        batch.value.running = false
        await refresh().catch(() => undefined)
      }
      release()
    }
  }

  const cancelGroupTest = () => {
    batch.value.cancelled = true
    groupHandle?.cancel()
  }

  const stopPolling = () => {
    if (pollTimer !== undefined) {
      window.clearInterval(pollTimer)
      pollTimer = undefined
    }
  }

  const startPolling = () => {
    stopPolling()
    if (!kernelApiStore.running) return
    void refresh().catch(() => undefined)
    pollTimer = window.setInterval(() => {
      if (!kernelApiStore.running) {
        stopPolling()
        return
      }
      void refresh().catch(() => undefined)
    }, POLL_INTERVAL)
  }

  onScopeDispose(() => {
    disposed = true
    activeHandles.forEach((handle) => handle.cancel())
    stopPolling()
  })

  return {
    selectedGroupName,
    query,
    sortByDelay,
    nodeGroupFilter,
    nodeGroupFilterOptions,
    nodeErrors,
    nodeAttempts,
    nodePhases,
    testingNodes,
    switchingNode,
    batch,
    stale,
    refreshError,
    groups,
    mode,
    primary,
    proxyGroup,
    proxyActive,
    selectedGroup,
    nodes,
    readonlyMode,
    refresh,
    prepareModal,
    selectGroup,
    switchNode,
    testNode,
    testGroup,
    cancelGroupTest,
    startPolling,
    stopPolling,
  }
}

export type NodeController = ReturnType<typeof useNodeController>
