<script setup lang="ts">
import { ref, computed, nextTick, watch, onActivated, onScopeDispose } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  DefaultCardColumns,
  DefaultConcurrencyLimit,
  DefaultTestTimeout,
  DefaultTestURL,
  MaxConcurrencyLimit,
} from '@/constant/app'
import { useBool } from '@/hooks'
import { useAppSettingsStore, useKernelApiStore, useProfilesStore } from '@/stores'
import { ignoredError, sleep, handleUseProxy, message, buildSmartRegExp } from '@/utils'
import {
  getDelayTestableNodeNames,
  isDelayTestableNode,
  resolveProxyChain,
} from '@/views/HomeView/nodeController'
import { nodeLatencyScheduler } from '@/views/HomeView/nodeLatencyScheduler'

import NodeCard from '@/components/_common/NodeCard.vue'

import type {
  LatencyResult,
  LatencyTaskHandle,
  LatencyNodePhase,
  LatencyFailureResult,
} from '@/views/HomeView/nodeLatencyScheduler'

import { useNodeFavorites } from '../useNodeFavorites'

const search = ref('')
const groupTasks = ref<Record<string, { completed: number; total: number; cancel: () => void }>>({})
const expandedSet = ref<Set<string>>(new Set())
const loadingSet = ref<Set<string>>(new Set())
const resultCache = new Map<string, { result?: LatencyResult; owners: Set<symbol> }>()
const handles = new Set<LatencyTaskHandle>()
const phases = ref(new Map<string, LatencyNodePhase>())
const errors = ref(new Map<string, LatencyFailureResult>())
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

const { isFavorite, toggleFavorite } = useNodeFavorites()
const extractViaFromRuntimeName = (
  name: string | undefined,
  proxies: Record<string, any>,
): string | undefined => {
  if (!name) return undefined
  const match = name.match(/ \[via ([^\]]+)\](?: [1-9]\d*)?$/)
  const candidate = match?.[1]
  return candidate && proxies[candidate] ? candidate : undefined
}

const groups = computed(() => {
  const { proxies } = kernelApiStore
  const profileOutbounds = profilesStore.currentProfile?.outbounds || []
  const outboundByTag = new Map(profileOutbounds.map((item) => [item.tag, item]))
  const outboundById = new Map(profileOutbounds.map((item) => [item.id, item]))
  const iconMapping = profileOutbounds.reduce((p, c) => {
    p[c.tag] = c.icon
    return p
  }, {} as Recordable<string>)
  const hiddenList = profileOutbounds.flatMap((v) => (v.hidden ? v.tag : []))
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
            ['Direct', 'Reject', 'Selector', 'URLTest'].includes(proxies[proxy]?.type || '') ||
            alive
          const keywords = filterKeywordsMap.value[group.name]
          const condition2 = keywords ? buildSmartRegExp(keywords, 'i').test(proxy) : true
          return (
            proxies[proxy] &&
            condition1 &&
            condition2 &&
            proxy.toLowerCase().includes(search.value.trim().toLowerCase())
          )
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

      const chains = resolveProxyChain(group.now, proxies).chain.filter((name) => proxies[name])
      const configured = outboundByTag.get(group.name)
      const configuredPreTag = configured?.pre_proxy
        ? outboundById.get(configured.pre_proxy)?.tag
        : undefined
      const preProxyTag =
        (configuredPreTag && proxies[configuredPreTag] ? configuredPreTag : undefined) ||
        extractViaFromRuntimeName(group.now, proxies) ||
        (group.all || [])
          .map((item) => extractViaFromRuntimeName(item, proxies))
          .find((item) => Boolean(item))
      const isPreProxyGroup =
        configured?.source_node_group_role === 'pre_proxy' ||
        / · (?:Auto )?Pre-proxy(?: \d+)?$/.test(group.name)
      return {
        ...group,
        all,
        chains,
        icon: iconMapping[group.name],
        preProxyTag,
        isPreProxyGroup,
      }
    })
})

let openedInitial = false
watch(
  groups,
  (list) => {
    if (openedInitial || !list.length) return
    const primary = profilesStore.currentProfile?.outbounds.find(
      (o) => o.id === profilesStore.currentProfile?.primary_proxy_outbound,
    )
    expandedSet.value.add(list.find((g) => g.name === primary?.tag)?.name ?? list[0]!.name)
    openedInitial = true
  },
  { immediate: true },
)
const switchingGroup = ref('')
const useProxyWithCatchError = async (group: any, proxy: any) => {
  if (switchingGroup.value === group.name) return
  switchingGroup.value = group.name
  try {
    await handleUseProxy(group, proxy)
  } catch (err: any) {
    message.error(err.message || err)
  } finally {
    if (switchingGroup.value === group.name) switchingGroup.value = ''
  }
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

const isExpanded = (group: string) => Boolean(search.value.trim()) || expandedSet.value.has(group)

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
    phases.value.delete(name)
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
  if (owner && cached?.owners.has(owner)) {
    cached.result = result
    if (result.ok) errors.value.delete(result.name)
    else errors.value.set(result.name, result)
  }
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
      if (!pendingRefreshes) {
        resultCache.forEach(({ owners }, name) => !owners.size && resultCache.delete(name))
      }
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
    groupTasks.value[group] = { completed: 0, total: names.length, cancel: () => handle.cancel() }
    const handle = nodeLatencyScheduler.submit({
      ...taskOptions(names),
      onState: (name, phase) => {
        if (!disposed) phases.value.set(name, phase)
      },
      onResult: (result) => {
        if (disposed) return
        applyResult(result, owner)
        const task = groupTasks.value[group]
        if (task) task.completed++
      },
    })
    handles.add(handle)
    void finishTask(handle, owned, owner)
      .then((summary) => {
        if (disposed || summary.cancelled) return
        message.success(
          t('home.nodes.testingCompleted', [
            summary.completed,
            summary.total,
            summary.success,
            summary.failure,
          ]),
        )
      })
      .catch((error) => {
        if (!disposed) console.error(error)
      })
      .finally(() => {
        delete groupTasks.value[group]
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
    onState: (name, phase) => {
      if (!disposed) phases.value.set(name, phase)
    },
    onResult: (result) => {
      if (disposed) return
      applyResult(result, owner)
      if (!result.ok) {
        const reason =
          result.message === 'home.nodes.unavailable' ? t(result.message) : result.message
        message.error(`${reason}: ${result.name}`)
      }
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
  const target = kernelApiStore.proxies[chain]?.all?.length ? chain : group.name
  expandedSet.value.add(target)
  nextTick(() => {
    const element = document.getElementById('policy-' + target)
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    element?.animate?.(
      [{ outline: '2px solid var(--accent-text)' }, { outline: '2px solid transparent' }],
      1000,
    )
  })
}

const clearFilters = () => {
  search.value = ''
  filterKeywordsMap.value = {}
}

const handleResetMoreSettings = () => {
  appSettings.app.kernel.testUrl = DefaultTestURL
  appSettings.app.kernel.testTimeout = DefaultTestTimeout
  appSettings.app.kernel.concurrencyLimit = DefaultConcurrencyLimit
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
})
</script>

<template>
  <div class="mb-10">
    <div class="groups-toolbar flex flex-wrap gap-8 items-center p-10 rounded-12">
      <Input
        v-model="search"
        clearable
        size="small"
        :placeholder="t('home.nodes.title') + ' · ' + t('common.search')"
      />
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

  <div
    v-for="group in groups"
    v-show="!search.trim() || group.all.length"
    :id="'policy-' + group.name"
    :key="group.name"
    class="mb-10"
  >
    <div
      class="group-header sticky top-0 z-2 flex flex-wrap gap-8 items-center p-10 rounded-12 cursor-pointer backdrop-blur-sm"
      @click="toggleExpanded(group.name)"
    >
      <div class="text-14 flex items-center gap-6 flex-wrap min-w-0">
        <img v-if="group.icon" :src="group.icon" class="w-24 h-24 shrink-0" draggable="false" />
        <span class="font-bold text-16">{{ group.name }}</span>
        <Tag size="small" color="blue">{{ group.type }}</Tag>
        <Tag size="small" color="default">{{ group.all.length }}</Tag>
        <Tag v-if="group.isPreProxyGroup" size="small" color="cyan">
          {{ t('profileSimple.preProxyGroupTag') }}
        </Tag>
        <Button
          v-if="group.preProxyTag"
          type="text"
          size="small"
          @click.stop="locateGroup(group, group.preProxyTag)"
        >
          <Tag size="small" color="purple">
            {{ t('profileSimple.preProxyVia', [group.preProxyTag]) }}
          </Tag>
        </Button>
        <span v-if="group.chains.length" class="text-muted">·</span>
        <template v-for="(chain, index) in group.chains" :key="chain">
          <span v-if="index !== 0" class="text-muted">→</span>
          <Button type="text" size="small" @click.stop="locateGroup(group, chain)">
            {{ chain }}
          </Button>
        </template>
      </div>
      <div class="ml-auto flex items-center gap-4" @click.stop>
        <Button
          v-if="groupTasks[group.name]"
          :data-test="'cancel-' + group.name"
          size="small"
          @click="groupTasks[group.name]!.cancel()"
        >
          {{ groupTasks[group.name]!.completed }}/{{ groupTasks[group.name]!.total }} ·
          {{ t('common.cancel') }}
        </Button>
        <Input
          v-model="filterKeywordsMap[group.name]"
          :placeholder="t('common.keywords')"
          editable
          clearable
          size="small"
        >
          <template #editable>
            <span class="inline-flex items-center gap-4 px-4 py-2 text-12">
              <Icon
                icon="filter"
                :size="14"
                :color="isFiltered(group.name) ? 'var(--accent-text)' : 'var(--muted-color)'"
              />
              <span v-if="isFiltered(group.name)" class="text-12">{{
                filterKeywordsMap[group.name]
              }}</span>
            </span>
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
          :aria-label="t(isExpanded(group.name) ? 'home.overview.collapseAll' : 'home.overview.expandAll')"
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
        <Empty v-if="group.all.length === 0">
          <template v-if="isFiltered(group.name) || search.trim()" #description>
            <div class="text-12 text-muted">
              {{ t('workspace.noMatches', [filterKeywordsMap[group.name] || search.trim()]) }}
            </div>
            <Button
              type="link"
              size="small"
              @click="
                () => {
                  filterKeywordsMap[group.name] = ''
                  search = ''
                }
              "
            >
              {{ t('workspace.clearFilters') }}
            </Button>
          </template>
        </Empty>
        <div
          v-else
          class="groups-card-grid grid gap-8"
          :style="{
            '--columns': appSettings.app.kernel.cardMode ? appSettings.app.kernel.cardColumns : 1,
          }"
        >
          <NodeCard
            v-for="proxy in group.all"
            :key="proxy.name"
            :phase="phases.get(proxy.name)"
            :query="search"
            :node="{
              name: proxy.name,
              proxy,
              error: proxy.delay ? undefined : errors.get(proxy.name),
              delay: proxy.delay,
              delayStatus: proxy.delay
                ? 'success'
                : errors.has(proxy.name) || proxy.history?.length
                  ? 'failed'
                  : 'untested',
            }"
            :compact="!appSettings.app.kernel.cardMode"
            :selected="proxy.name === group.now"
            :disabled="group.type !== 'Selector' || switchingGroup === group.name"
            :favorite="isFavorite(proxy.name)"
            :testing="isLoading(proxy.name)"
            :can-inspect="
              ['Selector', 'URLTest'].includes(proxy.type || '') &&
              groups.some((g) => g.name === proxy.name)
            "
            @favorite="toggleFavorite(proxy.name)"
            @select="useProxyWithCatchError(group, proxy)"
            @test="handleProxyDelay(proxy.name)"
            @inspect="locateGroup(group, proxy.name)"
          />
        </div>
      </div>
    </Transition>
  </div>

  <Empty v-if="search.trim() && !groups.some((group) => group.all.length)">
    <template #description>
      <div class="text-12 text-muted">{{ t('workspace.noMatches', [search.trim()]) }}</div>
      <Button type="link" @click="clearFilters">{{ t('workspace.clearFilters') }}</Button>
    </template>
  </Empty>

  <Modal
    v-model:open="showMoreSettings"
    :submit="false"
    size="md"
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
  background-color: var(--surface-bg);
  border: 1px solid var(--surface-border);
  backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
  -webkit-backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
}

.group-header {
  transition: border-color 0.16s ease;
  &:hover {
    border-color: color-mix(in srgb, var(--accent-text) 45%, var(--surface-border));
  }
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

.groups-card-grid {
  grid-template-columns: repeat(
    auto-fit,
    minmax(min(100%, max(175px, calc(100% / var(--columns) - 8px))), 1fr)
  );
}
</style>
