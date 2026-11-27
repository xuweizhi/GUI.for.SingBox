<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  useKernelApiStore,
  useNodeGroupsStore,
  useProfilesStore,
  useSubscribesStore,
} from '@/stores'
import {
  applyHomePreProxyNode,
  applyHomePreProxyNodeGroup,
  clearHomePreProxy,
  deepClone,
  findRestoredExitNodeTag,
  findRuntimeNodeTag,
  getPrimaryProxyOutbound,
  handleUseProxy,
  message,
  stripViaSuffix,
  type NodeGroupOutletBehavior,
} from '@/utils'
import { delayColor } from '@/views/HomeView/nodeController'

import type { NodeController } from '@/views/HomeView/useNodeController'

const props = defineProps<{ controller: NodeController }>()
const open = defineModel<boolean>('open', { default: false })

const { t, te } = useI18n()
const kernelApiStore = useKernelApiStore()
const profilesStore = useProfilesStore()
const subscribesStore = useSubscribesStore()
const nodeGroupsStore = useNodeGroupsStore()

const tab = ref<'nodes' | 'groups'>('nodes')
const search = ref('')
const subFilter = ref('__all')
const busy = ref(false)
const testingTag = ref('')
const showAllSubscriptionNodes = ref(false)

watch(open, (val) => {
  if (val) {
    search.value = ''
    showAllSubscriptionNodes.value = false
    void props.controller.refresh().catch(() => undefined)
  }
})

const preProxy = computed(() => props.controller.activePreProxy.value)
const primaryOutbound = computed(() => getPrimaryProxyOutbound(profilesStore.currentProfile))
const currentExitBase = computed(() => stripViaSuffix(props.controller.primary.value.leafName || ''))

const liveHotSwitchMode = computed(
  () => preProxy.value.canHotSwitch && !showAllSubscriptionNodes.value,
)

const liveNodes = computed(() => {
  const group = preProxy.value.group
  if (!group) return []
  const q = search.value.trim().toLowerCase()
  return (group.all || [])
    .filter((name) => name !== 'direct')
    .filter((name) => !q || name.toLowerCase().includes(q))
    .map((name) => {
      const runtime = kernelApiStore.proxies[name]
      const history = runtime?.history || []
      const latest = history.length ? history[history.length - 1]!.delay : 0
      return {
        name,
        type: runtime?.type || '',
        delay: latest > 0 ? latest : 0,
        selected: group.now === name,
        isCurrentExit: stripViaSuffix(name) === currentExitBase.value,
      }
    })
})

const enabledSubscriptions = computed(() =>
  subscribesStore.subscribes.filter((sub) => !sub.disabled),
)

const subscriptionFilterOptions = computed(() => [
  { label: t('home.nodes.preProxyAllSubscriptions'), value: '__all' },
  ...enabledSubscriptions.value.map((sub) => ({ label: sub.name, value: sub.id })),
])

const subscriptionNodes = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list: Array<{
    key: string
    tag: string
    type: string
    subId: string
    subName: string
    isCurrentExit: boolean
  }> = []
  for (const sub of enabledSubscriptions.value) {
    if (subFilter.value !== '__all' && sub.id !== subFilter.value) continue
    for (const proxy of sub.proxies || []) {
      if (
        q &&
        !proxy.tag.toLowerCase().includes(q) &&
        !proxy.type.toLowerCase().includes(q) &&
        !sub.name.toLowerCase().includes(q)
      ) {
        continue
      }
      list.push({
        key: `${sub.id}:${proxy.id || proxy.tag}`,
        tag: proxy.tag,
        type: proxy.type,
        subId: sub.id,
        subName: sub.name,
        isCurrentExit: proxy.tag === currentExitBase.value,
      })
    }
  }
  return list
})

const nodeGroupItems = computed(() => {
  const configured = preProxy.value.configuredOutboundId
    ? profilesStore.currentProfile?.outbounds.find(
        (item) => item.id === preProxy.value.configuredOutboundId,
      )
    : undefined
  return nodeGroupsStore.nodeGroups
    .filter((group) => group.id !== primaryOutbound.value?.source_node_group)
    .map((group) => {
      const matched = configured?.source_node_group === group.id
      const activeBehavior: NodeGroupOutletBehavior | '' = matched
        ? configured?.type === 'urltest'
          ? 'auto'
          : 'manual'
        : ''
      return { group, activeBehavior }
    })
})

const reportError = (error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error || 'Unknown error')
  message.error(te(msg) ? t(msg) : msg)
}

const getCurrentPrimarySelection = () => {
  const primary = primaryOutbound.value
  if (!primary) return ''
  return kernelApiStore.proxies[primary.tag]?.now || ''
}

const restoreExitSelection = async (previousExitTag: string, newPreProxyTag: string) => {
  const primary = primaryOutbound.value
  if (!primary || !previousExitTag) return
  const runtimePrimary = kernelApiStore.proxies[primary.tag]
  if (!runtimePrimary || runtimePrimary.type !== 'Selector') return
  const restored = findRestoredExitNodeTag(runtimePrimary.all, previousExitTag, newPreProxyTag)
  if (restored && restored !== runtimePrimary.now) {
    await handleUseProxy(runtimePrimary, { name: restored }, { refresh: false }).catch(
      () => undefined,
    )
  }
}

const handleHotSwitch = async (targetName: string) => {
  const group = preProxy.value.group
  if (!group || busy.value || group.now === targetName) return
  busy.value = true
  try {
    await handleUseProxy(group, { name: targetName })
    await props.controller.refresh().catch(() => undefined)
    message.success(
      targetName === 'direct' ? 'home.nodes.preProxyCleared' : 'home.nodes.preProxyApplied',
    )
  } catch (error) {
    reportError(error)
  } finally {
    busy.value = false
  }
}

const handleRemoveConfig = async () => {
  const current = profilesStore.currentProfile
  if (!current || busy.value) return
  busy.value = true
  const prevExit = getCurrentPrimarySelection()
  try {
    const cloned = deepClone(current)
    clearHomePreProxy(cloned)
    await profilesStore.editProfile(cloned.id, cloned)
    await kernelApiStore.restartCore()
    await kernelApiStore.refreshProviderProxies()
    await restoreExitSelection(prevExit, '')
    await props.controller.refresh().catch(() => undefined)
    showAllSubscriptionNodes.value = false
    message.success('home.nodes.preProxyCleared')
  } catch (error) {
    reportError(error)
  } finally {
    busy.value = false
  }
}

const handleSelectDirect = async () => {
  if (busy.value) return
  if (preProxy.value.status === 'none' || preProxy.value.status === 'direct') return
  if (preProxy.value.canHotSwitch && preProxy.value.hasDirectOption) {
    await handleHotSwitch('direct')
    return
  }
  await handleRemoveConfig()
}

const handlePickSubscriptionNode = async (node: {
  tag: string
  subId: string
  subName: string
}) => {
  if (busy.value) return
  if (preProxy.value.canHotSwitch && preProxy.value.isManagedHomePreProxy) {
    const runtimeTag = findRuntimeNodeTag(preProxy.value.group?.all, node.tag, node.subName)
    if (runtimeTag) {
      await handleHotSwitch(runtimeTag)
      return
    }
  }
  const current = profilesStore.currentProfile
  if (!current) return
  busy.value = true
  const prevExit = getCurrentPrimarySelection()
  try {
    const cloned = deepClone(current)
    const { preProxyTag } = applyHomePreProxyNode(cloned, {
      subscriptions: subscribesStore.subscribes,
      preProxyLabel: t('home.nodes.preProxyGroupName'),
      targetSubscriptionId: node.subId,
      nodeGroups: nodeGroupsStore.nodeGroups,
    })
    await profilesStore.editProfile(cloned.id, cloned)
    await kernelApiStore.restartCore()
    await kernelApiStore.refreshProviderProxies()
    const preGroup = kernelApiStore.proxies[preProxyTag]
    const runtimeTag = findRuntimeNodeTag(preGroup?.all, node.tag, node.subName)
    if (preGroup && runtimeTag && preGroup.now !== runtimeTag) {
      await handleUseProxy(preGroup, { name: runtimeTag }, { refresh: false })
    }
    await restoreExitSelection(prevExit, preProxyTag)
    await props.controller.refresh().catch(() => undefined)
    showAllSubscriptionNodes.value = false
    message.success('home.nodes.preProxyApplied')
  } catch (error) {
    reportError(error)
  } finally {
    busy.value = false
  }
}

const handlePickNodeGroup = async (group: App.NodeGroup, behavior: NodeGroupOutletBehavior) => {
  const current = profilesStore.currentProfile
  if (!current || busy.value) return
  busy.value = true
  const prevExit = getCurrentPrimarySelection()
  try {
    const cloned = deepClone(current)
    const { preProxyTag } = applyHomePreProxyNodeGroup(
      cloned,
      group,
      behavior,
      t(behavior === 'auto' ? 'nodeGroups.outletAuto' : 'nodeGroups.outletManual'),
      nodeGroupsStore.nodeGroups,
    )
    await profilesStore.editProfile(cloned.id, cloned)
    await kernelApiStore.restartCore()
    await kernelApiStore.refreshProviderProxies()
    await restoreExitSelection(prevExit, preProxyTag)
    await props.controller.refresh().catch(() => undefined)
    showAllSubscriptionNodes.value = false
    message.success('home.nodes.preProxyApplied')
  } catch (error) {
    reportError(error)
  } finally {
    busy.value = false
  }
}

const handleTestNode = async (name: string) => {
  if (testingTag.value) return
  testingTag.value = name
  try {
    const res = await props.controller.testNode(name)
    if (!res.ok) message.error(res.error)
  } finally {
    if (testingTag.value === name) testingTag.value = ''
  }
}
</script>

<template>
  <Modal
    v-model:open="open"
    title="home.nodes.preProxyTitle"
    :submit="false"
    cancel-text="common.close"
    size="drawer"
    mask-closable
  >
    <div class="preproxy-status rounded-8 p-10 mb-10 flex flex-col gap-8">
      <div class="flex flex-wrap items-center gap-8">
        <span class="text-12 text-muted">{{ t('home.nodes.preProxyTitle') }}:</span>
        <Tag v-if="preProxy.status === 'active'" size="small" color="purple">
          {{ preProxy.nodeName }}
        </Tag>
        <Tag v-else size="small" color="default">
          {{ t('home.nodes.preProxyDirect') }}
        </Tag>
        <Tag v-if="preProxy.canHotSwitch" size="small" color="green">
          {{ t('home.nodes.preProxyHotSwitchBadge') }}
        </Tag>
        <div class="ml-auto flex items-center gap-6">
          <Button
            data-action="preproxy-direct"
            :type="preProxy.status !== 'active' ? 'primary' : 'normal'"
            :disabled="busy || preProxy.status !== 'active'"
            size="small"
            @click="handleSelectDirect"
          >
            {{ t('home.nodes.preProxyDirect') }}
          </Button>
          <Button
            v-if="preProxy.configuredOnPrimary"
            data-action="preproxy-remove"
            :disabled="busy"
            type="text"
            size="small"
            @click="handleRemoveConfig"
          >
            {{ t('home.nodes.preProxyRemoveConfig') }}
          </Button>
        </div>
      </div>
      <div v-if="!preProxy.canHotSwitch" class="text-12 text-muted">
        {{ t('home.nodes.preProxyReloadHint') }}
      </div>
    </div>

    <div v-if="nodeGroupItems.length" class="mb-10">
      <Radio
        v-model="tab"
        size="small"
        :options="[
          { label: 'home.nodes.preProxyTabNodes', value: 'nodes' },
          { label: 'home.nodes.preProxyTabGroups', value: 'groups' },
        ]"
      />
    </div>

    <template v-if="tab === 'nodes'">
      <div class="flex flex-wrap items-center gap-8 mb-10">
        <Input
          v-model="search"
          clearable
          size="small"
          :placeholder="t('common.keywords')"
          class="flex-1 min-w-128"
        />
        <Select
          v-if="!liveHotSwitchMode && subscriptionFilterOptions.length > 2"
          v-model="subFilter"
          :options="subscriptionFilterOptions"
          size="small"
        />
        <Button
          v-if="preProxy.canHotSwitch && !preProxy.isManagedHomePreProxy"
          size="small"
          type="link"
          @click="showAllSubscriptionNodes = !showAllSubscriptionNodes"
        >
          {{
            showAllSubscriptionNodes
              ? preProxy.groupName
              : t('home.nodes.preProxyUseAllNodes')
          }}
        </Button>
      </div>

      <template v-if="liveHotSwitchMode">
        <Empty v-if="liveNodes.length === 0" :description="t('home.nodes.noFilterMatches')" />
        <div v-else class="preproxy-grid grid gap-8 pb-8">
          <div
            v-for="node in liveNodes"
            :key="node.name"
            :data-preproxy-node="node.name"
            class="preproxy-card surface-card rounded-8 p-10 cursor-pointer flex flex-col gap-4"
            :class="{ 'is-selected': node.selected, 'is-disabled': busy }"
            @click="!busy && handleHotSwitch(node.name)"
          >
            <div class="flex items-center gap-6 min-w-0">
              <span class="font-bold text-13 line-clamp-1 flex-1" :title="node.name">
                {{ node.name }}
              </span>
              <Tag v-if="node.isCurrentExit" size="small" color="orange">
                {{ t('home.nodes.preProxyCurrentExit') }}
              </Tag>
            </div>
            <div class="flex items-center gap-6 text-12 text-muted">
              <span class="line-clamp-1">{{ node.type || t('home.nodes.unknownType') }}</span>
              <Button
                type="text"
                size="small"
                class="ml-auto"
                :loading="testingTag === node.name"
                @click.stop="handleTestNode(node.name)"
              >
                <span
                  v-if="node.delay"
                  class="font-bold"
                  :style="{ color: delayColor(node.delay) }"
                >
                  {{ node.delay }} ms
                </span>
                <span v-else class="text-muted">{{ t('home.nodes.untested') }}</span>
              </Button>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <Empty v-if="subscriptionNodes.length === 0" :description="t('home.nodes.preProxyNoNodes')" />
        <div v-else class="preproxy-grid grid gap-8 pb-8">
          <div
            v-for="node in subscriptionNodes"
            :key="node.key"
            :data-preproxy-sub-node="node.tag"
            class="preproxy-card surface-card rounded-8 p-10 cursor-pointer flex flex-col gap-4"
            :class="{ 'is-disabled': busy }"
            @click="!busy && handlePickSubscriptionNode(node)"
          >
            <div class="flex items-center gap-6 min-w-0">
              <span class="font-bold text-13 line-clamp-1 flex-1" :title="node.tag">
                {{ node.tag }}
              </span>
              <Tag v-if="node.isCurrentExit" size="small" color="orange">
                {{ t('home.nodes.preProxyCurrentExit') }}
              </Tag>
            </div>
            <div class="flex items-center gap-6 text-12 text-muted">
              <span class="line-clamp-1">{{ node.type }}</span>
              <span class="ml-auto line-clamp-1">{{ node.subName }}</span>
            </div>
          </div>
        </div>
      </template>
    </template>

    <template v-else>
      <div class="preproxy-grid grid gap-8 pb-8">
        <div
          v-for="item in nodeGroupItems"
          :key="item.group.id"
          class="preproxy-card surface-card rounded-8 p-10 flex flex-col gap-8"
          :class="{ 'is-selected': Boolean(item.activeBehavior) }"
        >
          <div class="font-bold text-13 line-clamp-1">{{ item.group.name }}</div>
          <div class="flex items-center gap-6">
            <Button
              :data-preproxy-group="`${item.group.id}:manual`"
              :type="item.activeBehavior === 'manual' ? 'primary' : 'normal'"
              :disabled="busy"
              size="small"
              class="flex-1"
              @click="handlePickNodeGroup(item.group, 'manual')"
            >
              {{ t('nodeGroups.outletManual') }}
            </Button>
            <Button
              :data-preproxy-group="`${item.group.id}:auto`"
              :type="item.activeBehavior === 'auto' ? 'primary' : 'normal'"
              :disabled="busy"
              size="small"
              class="flex-1"
              @click="handlePickNodeGroup(item.group, 'auto')"
            >
              {{ t('nodeGroups.outletAuto') }}
            </Button>
          </div>
        </div>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.preproxy-status {
  background: var(--surface-bg);
  border: 1px solid var(--surface-border, var(--border-color));
}
.preproxy-grid {
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}
.preproxy-card {
  border: 1px solid var(--surface-border, var(--border-color));
  transition:
    border-color 0.16s ease,
    background-color 0.16s ease;
}
.preproxy-card:not(.is-disabled):hover {
  border-color: color-mix(in srgb, var(--accent-text) 48%, var(--surface-border));
}
.preproxy-card.is-selected {
  border-color: var(--accent-text);
  box-shadow: inset 3px 0 var(--accent-text);
}
.preproxy-card.is-disabled {
  opacity: 0.6;
  cursor: wait;
}
</style>
