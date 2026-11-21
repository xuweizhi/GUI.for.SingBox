<script setup lang="ts">
import { ref, computed, onActivated, onScopeDispose } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  ControllerCloseModeOptions,
  DefaultCardColumns,
  DefaultConcurrencyLimit,
  DefaultControllerSensitivity,
  DefaultTestTimeout,
  DefaultTestURL,
  MaxConcurrencyLimit,
} from '@/constant/app'
import { ControllerCloseMode } from '@/enums/app'
import { useBool } from '@/hooks'
import { useAppSettingsStore, useKernelApiStore, useProfilesStore } from '@/stores'
import { ignoredError, sleep, handleUseProxy, message, buildSmartRegExp } from '@/utils'
import { getDelayTestableNodeNames, isDelayTestableNode } from '@/views/HomeView/nodeController'
import { nodeLatencyScheduler } from '@/views/HomeView/nodeLatencyScheduler'

import type {
  LatencyResult,
  LatencyTaskHandle,
  LatencyTaskSummary,
} from '@/views/HomeView/nodeLatencyScheduler'

const expandedSet = ref<Set<string>>(new Set())
const loadingSet = ref<Set<string>>(new Set())
const resultCache = new Map<string, { result?: LatencyResult; owners: Set<symbol> }>()
const handles = new Set<LatencyTaskHandle>()
const destroyTimers = new Set<ReturnType<typeof setTimeout>>()
let refreshQueue = Promise.resolve()
let pendingRefreshes = 0
let disposed = false
const filterKeywordsMap = ref<Record<string, string>>({})

const loading = ref(false)

const { t } = useI18n()
const [showMoreSettings, toggleMoreSettings] = useBool(false)
const appSettings = useAppSettingsStore()
const kernelApiStore = useKernelApiStore()
const profilesStore = useProfilesStore()

const groups = computed(() => {
  const { proxies } = kernelApiStore
  const iconMapping = (profilesStore.currentProfile?.outbounds || []).reduce((p, c) => {
    p[c.tag] = c.icon
    return p
  }, {} as Recordable<string>)
  const hiddenList = (profilesStore.currentProfile?.outbounds || []).flatMap((v) =>
    v.hidden ? v.tag : [],
  )
  return Object.values(proxies)
    .filter(
      (v) =>
        ['Selector', 'URLTest'].includes(v.type) &&
        v.name !== 'GLOBAL' &&
        !hiddenList.includes(v.name),
    )
    .concat(proxies.GLOBAL || [])
    .map((group) => {
      const all = (group.all || [])
        .filter((proxy) => {
          const history = proxies[proxy]?.history || []
          const alive = (history[history.length - 1]?.delay ?? 0) > 0
          const condition1 =
            appSettings.app.kernel.unAvailable ||
            ['direct', 'block'].includes(proxy) ||
            proxies[proxy]?.all ||
            alive
          const keywords = filterKeywordsMap.value[group.name]
          const condition2 = keywords ? buildSmartRegExp(keywords, 'i').test(proxy) : true
          return condition1 && condition2
        })
        .map((proxy) => {
          const history = proxies[proxy]?.history || []
          const delay = history[history.length - 1]?.delay || 0
          return { ...proxies[proxy]!, delay }
        })
        .sort((a, b) => {
          if (!appSettings.app.kernel.sortByDelay || a.delay === b.delay) return 0
          if (!a.delay) return 1
          if (!b.delay) return -1
          return a.delay - b.delay
        })

      const chains = [group.now]
      let tmp = proxies[group.now]
      while (tmp) {
        tmp.now && chains.push(tmp.now)
        tmp = proxies[tmp.now]
      }
      return { ...group, all, chains, icon: iconMapping[group.name] }
    })
})

const useProxyWithCatchError = (group: any, proxy: any) => {
  handleUseProxy(group, proxy).catch((err: any) => message.error(err.message || err))
}

const toggleExpanded = (group: string) => {
  if (expandedSet.value.has(group)) {
    expandedSet.value.delete(group)
  } else {
    expandedSet.value.add(group)
  }
}

const expandAll = () => groups.value.forEach(({ name }) => expandedSet.value.add(name))

const collapseAll = () => expandedSet.value.clear()

const isExpanded = (group: string) => expandedSet.value.has(group)

const isLoading = (group: string) => loadingSet.value.has(group)

const retainLoading = (names: string[], owner: symbol) =>
  names.forEach((name) => {
    const cached = resultCache.get(name) || { owners: new Set<symbol>() }
    cached.owners.add(owner)
    resultCache.set(name, cached)
    loadingSet.value.add(name)
  })

const releaseLoading = (names: string[], owner: symbol) =>
  names.forEach((name) => {
    const cached = resultCache.get(name)
    cached?.owners.delete(owner)
    if (!cached?.owners.size && !pendingRefreshes) {
      resultCache.delete(name)
      loadingSet.value.delete(name)
    } else if (!cached?.owners.size) {
      loadingSet.value.delete(name)
    }
  })

const applyResult = (result: LatencyResult, owner?: symbol) => {
  if (disposed) return
  const cached = resultCache.get(result.name)
  if (owner && cached?.owners.has(owner)) cached.result = result
  const proxy = kernelApiStore.proxies[result.name]
  if (!proxy) return
  proxy.history ||= []
  const delay = result.ok ? result.delay : 0
  if (proxy.history[proxy.history.length - 1]?.delay !== delay) proxy.history.push({ delay })
}

const taskOptions = (nodes: string[]) => ({
  nodes,
  url: appSettings.app.kernel.testUrl || DefaultTestURL,
  timeout: appSettings.app.kernel.testTimeout || DefaultTestTimeout,
  concurrency: appSettings.app.kernel.concurrencyLimit || DefaultConcurrencyLimit,
})

const enqueueRefresh = () => {
  pendingRefreshes++
  refreshQueue = refreshQueue.then(async () => {
    try {
      if (disposed) return
      await ignoredError(kernelApiStore.refreshProviderProxies)
      if (disposed) return
      resultCache.forEach(({ result }) => result && applyResult(result))
    } finally {
      pendingRefreshes--
    }
  })
  return refreshQueue
}

const finishTask = async (handle: LatencyTaskHandle, owned: string[], owner: symbol) => {
  try {
    const summary = await handle.done
    await enqueueRefresh()
    return summary
  } finally {
    handles.delete(handle)
    if (!disposed) {
      releaseLoading(owned, owner)
      if (!pendingRefreshes) {
        resultCache.forEach(({ owners }, name) => !owners.size && resultCache.delete(name))
      }
    }
  }
}

const isFiltered = (group: string) => filterKeywordsMap.value[group]

const handleGroupDelay = (group: string) => {
  const _group = kernelApiStore.proxies[group]
  if (_group) {
    if (isLoading(group)) return
    const names = getDelayTestableNodeNames(_group, kernelApiStore.proxies).filter(
      (name) => !isLoading(name),
    )
    if (!names.length) return
    const owned = [group, ...names]
    const owner = Symbol(group)
    retainLoading(owned, owner)
    let completed = 0
    let success = 0
    let failure = 0
    const {
      update,
      destroy,
      success: msgSuccess,
    } = message.info(
      t('home.nodes.testingProgress', [0, names.length, 0, 0]),
      99999,
      () => {
        handle.cancel()
        message.warn('common.canceled')
      },
    )
    const handle = nodeLatencyScheduler.submit({
      ...taskOptions(names),
      onState: (_name, phase) => {
        if (disposed || !['queued', 'testing', 'retry-queued'].includes(phase)) return
        update(t('home.nodes.testingProgress', [completed, names.length, success, failure]))
      },
      onResult: (result) => {
        if (disposed) return
        applyResult(result, owner)
        completed++
        if (result.ok) success++
        else failure++
        update(t('home.nodes.testingProgress', [completed, names.length, success, failure]))
      },
    })
    handles.add(handle)
    void finishTask(handle, owned, owner).then((summary: LatencyTaskSummary) => {
      if (disposed) return
      if (summary.cancelled) {
        destroy()
        return
      }
      msgSuccess(
        t('home.nodes.testingCompleted', [
          summary.completed,
          summary.total,
          summary.success,
          summary.failure,
        ]),
      )
      const timer = setTimeout(() => {
        destroyTimers.delete(timer)
        destroy()
      }, 3000)
      destroyTimers.add(timer)
    })
  }
}

const handleProxyDelay = (proxy: string) => {
  const target = kernelApiStore.proxies[proxy]
  if (!isDelayTestableNode(proxy, target)) {
    message.warn('home.nodes.notDelayTestable')
    return
  }
  if (isLoading(proxy)) return
  const owner = Symbol(proxy)
  retainLoading([proxy], owner)
  const handle = nodeLatencyScheduler.submit({
    ...taskOptions([proxy]),
    onResult: (result) => {
      if (disposed) return
      applyResult(result, owner)
      if (!result.ok) message.error(`${result.message}: ${result.name}`)
    },
  })
  handles.add(handle)
  void finishTask(handle, [proxy], owner)
}

const handleRefresh = async () => {
  loading.value = true
  await ignoredError(kernelApiStore.refreshConfig)
  await enqueueRefresh()
  await sleep(100)
  loading.value = false
}

const locateGroup = (group: any, chain: string) => {
  collapseAll()
  if (kernelApiStore.proxies[chain]?.all) {
    toggleExpanded(kernelApiStore.proxies[chain].name)
  } else {
    toggleExpanded(group.name)
  }
}

const delayColor = (delay = 0) => {
  if (delay === 0) return 'var(--level-0-color)'
  if (delay < 500) return 'var(--level-1-color)'
  if (delay < 1000) return 'var(--level-2-color)'
  if (delay < 1500) return 'var(--level-3-color)'
  return 'var(--level-4-color)'
}

const handleResetMoreSettings = () => {
  appSettings.app.kernel.testUrl = DefaultTestURL
  appSettings.app.kernel.testTimeout = DefaultTestTimeout
  appSettings.app.kernel.concurrencyLimit = DefaultConcurrencyLimit
  appSettings.app.kernel.controllerCloseMode = ControllerCloseMode.All
  appSettings.app.kernel.controllerSensitivity = DefaultControllerSensitivity
  appSettings.app.kernel.cardColumns = DefaultCardColumns
  message.success('common.success')
}

onActivated(() => {
  void enqueueRefresh()
})

onScopeDispose(() => {
  disposed = true
  handles.forEach((handle) => handle.cancel())
  handles.clear()
  destroyTimers.forEach((timer) => clearTimeout(timer))
  destroyTimers.clear()
})
</script>

<template>
  <div class="m-8 mt-0 sticky top-0 z-3">
    <div class="groups-toolbar flex flex-wrap gap-8 items-center p-10 rounded-12 backdrop-blur-sm">
      <Switch v-model="appSettings.app.kernel.autoClose" label="home.controller.autoClose" />
      <Switch v-model="appSettings.app.kernel.unAvailable" label="home.controller.unAvailable" />
      <Switch v-model="appSettings.app.kernel.cardMode" label="home.controller.cardMode" />
      <Switch v-model="appSettings.app.kernel.sortByDelay" label="home.controller.sortBy" />
      <div class="ml-auto flex items-center gap-4">
        <Button
          v-tips="'common.more'"
          :aria-label="t('common.more')"
          type="text"
          size="small"
          icon="settings3"
          @click="toggleMoreSettings"
        />
        <Button
          v-tips="'home.overview.expandAll'"
          :aria-label="t('home.overview.expandAll')"
          type="text"
          size="small"
          icon="expand"
          @click="expandAll"
        />
        <Button
          v-tips="'home.overview.collapseAll'"
          :aria-label="t('home.overview.collapseAll')"
          type="text"
          size="small"
          icon="collapse"
          @click="collapseAll"
        />
        <Button
          v-tips="'home.overview.refresh'"
          :aria-label="t('home.overview.refresh')"
          :loading="loading"
          icon="refresh"
          type="text"
          size="small"
          @click="handleRefresh"
        />
      </div>
    </div>
  </div>

  <div v-for="group in groups" :key="group.name" class="m-8">
    <div
      class="group-header sticky z-2 flex flex-wrap gap-8 items-center p-10 rounded-12 cursor-pointer backdrop-blur-sm"
      @click="toggleExpanded(group.name)"
    >
      <div class="text-14 flex items-center gap-6 flex-wrap min-w-0">
        <img v-if="group.icon" :src="group.icon" class="w-24 h-24 shrink-0" draggable="false" />
        <span class="font-bold text-16">{{ group.name }}</span>
        <Tag size="small" color="blue">{{ group.type }}</Tag>
        <Tag size="small" color="default">{{ group.all.length }}</Tag>
        <span class="text-muted">·</span>
        <template v-for="(chain, index) in group.chains" :key="chain">
          <span v-if="index !== 0" class="text-muted">→</span>
          <Button type="text" size="small" @click.stop="locateGroup(group, chain)">
            {{ chain }}
          </Button>
        </template>
      </div>
      <div class="ml-auto flex items-center gap-4" @click.stop>
        <Input
          v-model="filterKeywordsMap[group.name]"
          :placeholder="t('common.keywords')"
          editable
          clearable
          size="small"
        >
          <template #editable>
            <Button
              type="text"
              size="small"
              icon="filter"
              :aria-label="t('common.keywords')"
              :icon-color="isFiltered(group.name) ? 'var(--accent-text)' : ''"
            />
          </template>
        </Input>
        <Button
          v-tips="'home.overview.delayTest'"
          :aria-label="t('home.overview.delayTest')"
          :data-test="`group-delay-${group.name}`"
          :loading="isLoading(group.name)"
          icon="speedTest"
          type="text"
          size="small"
          @click="handleGroupDelay(group.name)"
        />
        <Button
          type="text"
          size="small"
          :aria-expanded="isExpanded(group.name)"
          @click="toggleExpanded(group.name)"
        >
          <Icon
            :class="{ 'action-expand-expanded': isExpanded(group.name) }"
            class="action-expand origin-center duration-200"
            icon="arrowDown"
          />
        </Button>
      </div>
    </div>
    <Transition name="expand">
      <div v-if="isExpanded(group.name)" class="py-8 px-4">
        <Empty v-if="group.all.length === 0" />
        <div
          v-else-if="appSettings.app.kernel.cardMode"
          :class="`grid-cols-${appSettings.app.kernel.cardColumns}`"
          class="groups-card-grid grid gap-8"
        >
          <Card
            v-for="proxy in group.all"
            :key="proxy.name"
            :title="proxy.name"
            :selected="proxy.name === group.now"
            interactive
            @click="useProxyWithCatchError(group, proxy)"
          >
            <div class="flex items-center justify-between gap-4">
              <div class="text-12 text-muted">
                {{ proxy.type }}{{ proxy.udp ? ' · UDP' : '' }}
              </div>
              <Button
                :data-test="`proxy-delay-${proxy.name}`"
                :style="{ color: delayColor(proxy.delay) }"
                :loading="isLoading(proxy.name)"
                type="text"
                size="small"
                @click.stop="handleProxyDelay(proxy.name)"
              >
                <span class="text-12 font-bold">
                  {{ proxy.delay ? proxy.delay + ' ms' : t('home.nodes.untested') }}
                </span>
              </Button>
            </div>
          </Card>
        </div>
        <div v-else class="flex flex-wrap gap-6 p-4">
          <div
            v-for="proxy in group.all"
            :key="proxy.name"
            v-tips.fast="proxy.name"
            :style="{ background: delayColor(proxy.delay) }"
            :class="proxy.name === group.now ? 'rounded-full shadow ring-active' : ''"
            class="w-16 h-16 rounded-4 flex items-center justify-center cursor-pointer"
            @click="useProxyWithCatchError(group, proxy)"
          >
            <Icon v-if="isLoading(proxy.name)" icon="loading" :size="12" class="rotation" />
          </div>
        </div>
      </div>
    </Transition>
  </div>

  <Modal
    v-model:open="showMoreSettings"
    :submit="false"
    mask-closable
    cancel-text="common.close"
    title="common.more"
  >
    <template #action>
      <Button type="text" class="mr-auto" @click="handleResetMoreSettings">
        {{ t('common.reset') }}
      </Button>
    </template>

    <div class="form-item">
      {{ t('home.controller.delay') }}
      <Input
        v-model="appSettings.app.kernel.testUrl"
        :placeholder="DefaultTestURL"
        editable
        clearable
      />
    </div>

    <div class="form-item">
      {{ t('home.controller.timeout') }}
      <Input
        v-model="appSettings.app.kernel.testTimeout"
        :placeholder="String(DefaultTestTimeout)"
        :min="1000"
        :max="60000"
        type="number"
        editable
        clearable
      />
    </div>

    <div class="form-item">
      {{ t('home.controller.concurrencyLimit') }}
      <Input
        v-model="appSettings.app.kernel.concurrencyLimit"
        :min="1"
        :max="MaxConcurrencyLimit"
        type="number"
        editable
        clearable
      />
    </div>

    <div class="form-item">
      {{ t('home.controller.closeMode.name') }}
      <Radio
        v-model="appSettings.app.kernel.controllerCloseMode"
        :options="ControllerCloseModeOptions"
      />
    </div>

    <div
      v-if="appSettings.app.kernel.controllerCloseMode === ControllerCloseMode.All"
      class="form-item"
    >
      {{ t('home.controller.sensitivity') }}
      <Input
        v-model="appSettings.app.kernel.controllerSensitivity"
        type="number"
        :min="1"
        :max="6"
        placeholder="1-6"
        editable
      />
    </div>

    <div class="form-item">
      {{ t('home.controller.cardColumns') }}
      <Radio
        v-model="appSettings.app.kernel.cardColumns"
        :options="Array.from({ length: 5 }, (_, i) => ({ label: String(i + 1), value: i + 1 }))"
      />
    </div>
  </Modal>
</template>

<style lang="less" scoped>
.groups-toolbar,
.group-header {
  background-color: var(--card-bg);
  border: 1px solid var(--border-color);
}

.group-header {
  top: 56px;
  transition: border-color 0.16s ease;
  &:hover {
    border-color: color-mix(in srgb, var(--accent-text) 45%, var(--border-color));
  }
}

.ring-active {
  outline: 2px solid var(--accent-text);
  outline-offset: 2px;
}

.expand-enter-active,
.expand-leave-active {
  transform-origin: top;
  transition:
    transform 0.18s ease-in-out,
    opacity 0.18s ease-in-out;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  transform: scaleY(0.95);
}

.action-expand {
  transform: rotate(-90deg);
  &-expanded {
    transform: rotate(0deg);
  }
}

@media (max-width: 900px) {
  .groups-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }
}

@media (max-width: 560px) {
  .groups-card-grid {
    grid-template-columns: minmax(0, 1fr) !important;
  }
}
</style>
