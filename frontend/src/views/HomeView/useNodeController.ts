import { computed, onScopeDispose, ref } from 'vue'

import { getProxyDelay } from '@/api/kernel'
import { DefaultConcurrencyLimit, DefaultTestTimeout, DefaultTestURL } from '@/constant/app'
import { useAppSettingsStore, useKernelApiStore, useProfilesStore } from '@/stores'
import { handleUseProxy } from '@/utils/helper'
import { createAsyncPool, normalizeErrorMessage } from '@/utils/others'
import {
  filterAndSortNodes,
  getVisibleGroups,
  resolvePrimaryNode,
} from '@/views/HomeView/nodeController'

import type { NodeMode } from '@/views/HomeView/nodeController'

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

  const selectedGroupName = ref('')
  const query = ref('')
  const sortByDelay = ref(false)
  const nodeErrors = ref(new Map<string, string>())
  const localDelays = ref(new Map<string, number>())
  const testingNodes = ref(new Set<string>())
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
  const selectedGroup = computed(
    () =>
      kernelApiStore.proxies[selectedGroupName.value] ||
      groups.value.find((group) => group.name === selectedGroupName.value),
  )
  const readonlyMode = computed(
    () => mode.value === 'direct' || selectedGroup.value?.type !== 'Selector',
  )
  const nodes = computed(() => {
    if (!selectedGroup.value) return []
    return filterAndSortNodes(
      selectedGroup.value,
      kernelApiStore.proxies,
      query.value,
      sortByDelay.value,
      nodeErrors.value,
      localDelays.value,
    )
  })

  let disposed = false
  let pollTimer: number | undefined
  let refreshPromise: Promise<void> | undefined
  let poolController: { cancel: () => void } | undefined

  const refresh = () => {
    if (!kernelApiStore.running) return Promise.resolve()
    if (!refreshPromise) {
      refreshPromise = kernelApiStore
        .refreshProviderProxies()
        .then(() => {
          if (disposed) return
          nodeErrors.value.forEach((_, name) => {
            const history = kernelApiStore.proxies[name]?.history || []
            const latestDelay = history.at(-1)?.delay || 0
            if (latestDelay > 0) {
              nodeErrors.value.delete(name)
              localDelays.value.delete(name)
            }
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
    selectedGroupName.value =
      primary.value.kind === 'group' ? primary.value.groupName : groups.value[0]?.name || ''
    if (refreshFailure) throw refreshFailure
  }

  const selectGroup = (name: string) => {
    if (!groups.value.some((group) => group.name === name)) return
    selectedGroupName.value = name
    query.value = ''
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

  const runNodeTest = async (name: string): Promise<NodeOperationResult> => {
    if (testingNodes.value.has(name)) {
      return { ok: false, error: 'home.nodes.alreadyTesting' }
    }

    const proxy = kernelApiStore.proxies[name]
    if (!proxy) {
      return { ok: false, error: 'home.nodes.nodeMissing' }
    }

    testingNodes.value.add(name)
    try {
      const { delay = 0 } = await getProxyDelay(
        encodeURIComponent(name),
        appSettingsStore.app.kernel.testUrl || DefaultTestURL,
        appSettingsStore.app.kernel.testTimeout || DefaultTestTimeout,
      )
      if (delay <= 0) throw new Error('home.nodes.unavailable')
      if (disposed) return { ok: false, error: 'common.canceled' }

      proxy.history ||= []
      proxy.history.push({ delay })
      localDelays.value.set(name, delay)
      nodeErrors.value.delete(name)
      return { ok: true }
    } catch (error) {
      const normalized = normalizeErrorMessage(error)
      if (!disposed) {
        proxy.history ||= []
        proxy.history.push({ delay: 0 })
        localDelays.value.delete(name)
        nodeErrors.value.set(name, normalized)
      }
      return { ok: false, error: normalized }
    } finally {
      if (!disposed) testingNodes.value.delete(name)
    }
  }

  const testNode = async (name: string): Promise<NodeOperationResult> => {
    const result = await runNodeTest(name)
    await refresh().catch(() => undefined)
    return result
  }

  const testGroup = async () => {
    if (batch.value.running || !selectedGroup.value) return

    const names = [...new Set(selectedGroup.value.all || [])]
    batch.value = {
      running: true,
      cancelled: false,
      total: names.length,
      completed: 0,
      success: 0,
      failure: 0,
    }

    const { run, controller } = createAsyncPool(
      appSettingsStore.app.kernel.concurrencyLimit || DefaultConcurrencyLimit,
      names,
      async (name) => {
        const result = await runNodeTest(name)
        if (!disposed) {
          batch.value.completed += 1
          result.ok ? (batch.value.success += 1) : (batch.value.failure += 1)
        }
        return result
      },
    )
    poolController = controller

    try {
      await run()
    } finally {
      poolController = undefined
      if (!disposed) {
        batch.value.running = false
        await refresh().catch(() => undefined)
      }
    }
  }

  const cancelGroupTest = () => {
    batch.value.cancelled = true
    poolController?.cancel()
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
    poolController?.cancel()
    stopPolling()
  })

  return {
    selectedGroupName,
    query,
    sortByDelay,
    nodeErrors,
    testingNodes,
    switchingNode,
    batch,
    stale,
    refreshError,
    groups,
    primary,
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
