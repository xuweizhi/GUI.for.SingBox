<script lang="ts" setup>
import {
  ref,
  computed,
  onActivated,
  onDeactivated,
  onUnmounted,
  watch,
  onMounted,
  useTemplateRef,
} from 'vue'
import { useI18n } from 'vue-i18n'

import { deleteConnection } from '@/api/kernel'
import { DraggableOptions } from '@/constant/app'
import { DefaultConnections } from '@/constant/kernel'
import { useBool } from '@/hooks'
import { useAppSettingsStore, useAppStore, useKernelApiStore } from '@/stores'
import {
  addToRuleSet,
  confirm,
  formatBytes,
  formatRelativeTime,
  getDomainSuffixes,
  isValidIPv6,
  message,
  picker,
} from '@/utils'

import ResourceActions from '@/components/_common/ResourceActions.vue'

import type { PickerItem } from '@/components/Picker/index.vue'
import type { Column } from '@/components/Table/index.vue'
import type { CoreApiConnectionsData } from '@/types/kernel'

import {
  connectionFilterFields,
  connectionOptions,
  filterConnections,
  type ConnectionFilters,
} from '../connectionFilters'

type TrafficCacheType = { up: number; down: number }
const TrafficCache: Record<string, TrafficCacheType> = {}

const appSettingsStore = useAppSettingsStore()
const appStore = useAppStore()

const openDetails = (record: Record<string, any>) => {
  details.value = { ...record, metadata: { ...record.metadata } }
  toggleDetails()
}

const closeSingleConnection = (record: Record<string, any>) => {
  if (isActive.value) return closeConnections([record.id])
}

const addRecordToRuleset = async (
  ruleset: 'direct' | 'proxy' | 'reject',
  record: Record<string, any>,
) => {
  const options: PickerItem<Record<string, any>[]>[] = []
  if (record.metadata.host) {
    options.push({
      label: t('kernel.rules.type.domain'),
      value: { domain: record.metadata.host } as any,
      description: record.metadata.host,
    })
    getDomainSuffixes(record.metadata.host).forEach((suffix) => {
      options.push({
        label: t('kernel.rules.type.domain_suffix'),
        value: {
          domain_suffix: suffix,
        } as any,
        description: suffix,
      })
    })
  }
  if (record.metadata.destinationIP) {
    const prefix = isValidIPv6(record.metadata.destinationIP) ? 128 : 32
    options.push({
      label: t('kernel.rules.type.ip_cidr'),
      value: { ip_cidr: `${record.metadata.destinationIP}/${prefix}` } as any,
      description: record.metadata.destinationIP,
    })
  }
  if (record.metadata.processPath) {
    options.push({
      label: t('kernel.rules.type.process_path'),
      value: { process_path: record.metadata.processPath } as any,
      description: record.metadata.processPath,
    })
  }
  const payloads = await picker.multi('rulesets.selectRuleType', options).catch(() => [])
  if (!payloads.length) return
  try {
    await addToRuleSet(ruleset, payloads)
    message.success('common.success')
  } catch (error: any) {
    message.error(error)
    console.log(error)
  }
}

const columns = computed(() => [
  ...(
    [
      {
        title: 'home.connections.type',
        align: 'center',
        key: 'metadata.type',
        hidden: !appSettingsStore.app.connections.visibility['metadata.type'],
        sort: (a, b) => (a.metadata.type || '').localeCompare(b.metadata.type || ''),
        customRender: ({ value, record }) => {
          return value + '(' + record.metadata.network + ')'
        },
      },
      {
        title: 'home.connections.processPath',
        key: 'metadata.processPath',
        ellipsis: true,
        hidden: !appSettingsStore.app.connections.visibility['metadata.processPath'],
        sort: (a, b) => (a.metadata.processPath || '').localeCompare(b.metadata.processPath || ''),
      },
      {
        title: 'home.connections.host',
        key: 'metadata.host',
        ellipsis: true,
        hidden: !appSettingsStore.app.connections.visibility['metadata.host'],
        sort: (a, b) =>
          (a.metadata.host || a.metadata.destinationIP || '').localeCompare(
            b.metadata.host || b.metadata.destinationIP || '',
          ),
        customRender: ({ value, record }) => {
          return value || record.metadata.destinationIP
        },
      },
      {
        title: 'home.connections.sourceIP',
        align: 'center',
        key: 'metadata.sourceIP',
        hidden: !appSettingsStore.app.connections.visibility['metadata.sourceIP'],
        sort: (a, b) => (a.metadata.sourceIP || '').localeCompare(b.metadata.sourceIP || ''),
        customRender: ({ value, record }) => {
          return value + ':' + record.metadata.sourcePort
        },
      },
      {
        title: 'home.connections.destinationIP',
        align: 'center',
        key: 'metadata.destinationIP',
        hidden: !appSettingsStore.app.connections.visibility['metadata.destinationIP'],
        sort: (a, b) => (a.metadata.destinationIP || '').localeCompare(b.metadata.destinationIP || ''),
        customRender: ({ value, record }) => {
          return value + ':' + record.metadata.destinationPort
        },
      },
      {
        title: 'home.connections.rule',
        align: 'center',
        key: 'rule',
        ellipsis: true,
        hidden: !appSettingsStore.app.connections.visibility['rule'],
        sort: (a, b) => (a.rule || '').localeCompare(b.rule || ''),
        customRender: ({ value, record }) => {
          return value + (record.rulePayload ? '::' + record.rulePayload : '')
        },
      },
      {
        title: 'home.connections.chains',
        key: 'chains',
        ellipsis: true,
        hidden: !appSettingsStore.app.connections.visibility['chains'],
        sort: (a, b) => (a.chains.at(-1) || '').localeCompare(b.chains.at(-1) || ''),
        customRender: ({ value }) => value.slice().reverse().join(' :: '),
      },
      {
        title: 'home.connections.uploadSpeed',
        align: 'center',
        key: 'up',
        minWidth: '90px',
        hidden: !appSettingsStore.app.connections.visibility['up'],
        sort: (a, b) => Math.max(0, a.upload - a.up) - Math.max(0, b.upload - b.up),
        customRender: ({ value, record }) =>
          formatBytes(Math.max(0, (record.upload || 0) - (value ?? record.upload ?? 0))) + '/s',
      },
      {
        title: 'home.connections.downSpeed',
        align: 'center',
        key: 'down',
        minWidth: '90px',
        hidden: !appSettingsStore.app.connections.visibility['down'],
        sort: (a, b) => Math.max(0, a.download - a.down) - Math.max(0, b.download - b.down),
        customRender: ({ value, record }) =>
          formatBytes(Math.max(0, (record.download || 0) - (value ?? record.download ?? 0))) + '/s',
      },
      {
        title: 'home.connections.upload',
        align: 'center',
        key: 'upload',
        hidden: !appSettingsStore.app.connections.visibility['upload'],
        sort: (a, b) => a.upload - b.upload,
        customRender: ({ value }) => formatBytes(value),
      },
      {
        title: 'home.connections.download',
        align: 'center',
        key: 'download',
        hidden: !appSettingsStore.app.connections.visibility['download'],
        sort: (a, b) => a.download - b.download,
        customRender: ({ value }) => formatBytes(value),
      },
      {
        title: 'home.connections.time',
        align: 'center',
        key: 'start',
        hidden: !appSettingsStore.app.connections.visibility['start'],
        sort: (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
        customRender: ({ value }) => formatRelativeTime(value),
      },
    ] as Column[]
  ).sort(
    (a, b) =>
      appSettingsStore.app.connections.order.indexOf(a.key) -
      appSettingsStore.app.connections.order.indexOf(b.key),
  ),
  {
    title: 'common.more',
    align: 'center',
    key: '__actions',
    fixed: 'right',
    minWidth: '96px',
  } as Column,
])

const columnTitleMap = computed(() => {
  const map: Record<string, string | undefined> = {}
  appSettingsStore.app.connections.order.forEach(
    (field) => (map[field] = columns.value.find((column) => column.key === field)?.title),
  )
  return map
})

const menu = computed<App.Menu[]>(() => [
  {
    label: 'common.details',
    handler: openDetails,
  },
  ...(isActive.value ? [{ label: 'home.connections.close', handler: closeSingleConnection }] : []),
  ...(
    [
      ['home.connections.addToDirect', 'direct'],
      ['home.connections.addToProxy', 'proxy'],
      ['home.connections.addToReject', 'reject'],
    ] as const
  ).map(([label, ruleset]) => ({
    label,
    handler: (record: Record<string, any>) => addRecordToRuleset(ruleset, record),
  })),
])

const details = ref<Record<string, any>>({})
const isActive = ref(true)
const keywords = ref('')
type ClosedConnectionRecord = CoreApiConnectionsData['connections'][0] &
  TrafficCacheType & { closedAt?: number }
const dataSource = ref<(CoreApiConnectionsData['connections'][0] & TrafficCacheType)[]>([])
const disconnectedData = ref<ClosedConnectionRecord[]>([])
const [showDetails, toggleDetails] = useBool(false)
const [showSettings, toggleSettings] = useBool(false)
const [isPause, togglePause] = useBool(false)
const { t, te } = useI18n()
const kernelApiStore = useKernelApiStore()

const detailEntries = computed(() => {
  const entries: { key: string; label: string; value: string | number }[] = []
  const labelOf = (key: string) => {
    const path = 'home.connections.' + key
    return te(path) ? t(path) : key
  }
  const formatValue = (key: string, value: any) => {
    if (key === 'upload' || key === 'download') return formatBytes(Number(value) || 0)
    if (key === 'chains' && Array.isArray(value)) return value.slice().reverse().join(' → ')
    if (key === 'start') return formatRelativeTime(value)
    if (typeof value === 'object') return JSON.stringify(value)
    return value ?? '-'
  }
  for (const [key, value] of Object.entries(details.value)) {
    if (['metadata', 'up', 'down', 'closedAt'].includes(key)) continue
    entries.push({ key, label: labelOf(key), value: formatValue(key, value) })
  }
  for (const [key, value] of Object.entries(details.value.metadata ?? {})) {
    entries.push({
      key: 'metadata.' + key,
      label: labelOf(key),
      value: formatValue(key, value),
    })
  }
  const started = details.value.start ? new Date(details.value.start).getTime() : 0
  if (started) {
    const endTime = typeof details.value.closedAt === 'number' ? details.value.closedAt : Date.now()
    const seconds = Math.max(0, Math.floor((endTime - started) / 1000))
    entries.push({
      key: 'duration',
      label: t('home.connections.duration'),
      value: [
        Math.floor(seconds / 3600),
        Math.floor(seconds / 60) % 60,
        seconds % 60,
      ]
        .map((part) => String(part).padStart(2, '0'))
        .join(':'),
    })
  }
  return entries
})

const showFilters = ref(false)
const filters = ref<ConnectionFilters>({})
const selectedFilterCount = computed(
  () => Object.values(filters.value).filter((items) => items.length).length,
)
const currentConnections = computed(() =>
  isActive.value ? dataSource.value : disconnectedData.value,
)
const hovering = ref(false)
const snapshot = ref<CoreApiConnectionsData['connections']>([])
const frozen = computed(() => hovering.value || appStore.menuShow || isPause.value)
watch(
  [frozen, isActive],
  () => {
    snapshot.value = frozen.value ? currentConnections.value.slice() : []
  },
  { flush: 'sync' },
)
const visibleSource = computed(() => (frozen.value ? snapshot.value : currentConnections.value))
const newConnections = computed(() => {
  if (!frozen.value || !isActive.value) return 0
  const ids = new Set(snapshot.value.map((row) => row.id))
  return currentConnections.value.filter((row) => !ids.has(row.id)).length
})
const filterOptions = computed(() => connectionOptions(visibleSource.value, filters.value))
const filteredConnections = computed(() =>
  filterConnections(visibleSource.value, keywords.value, filters.value),
)
const compactConnections = computed(() =>
  filteredConnections.value
    .slice()
    .sort((a, b) => new Date(b.start || 0).getTime() - new Date(a.start || 0).getTime()),
)
const root = useTemplateRef<HTMLElement>('root')
const compact = ref(false)
let observer: ResizeObserver | undefined
let unregisterConnectionsHandler: (() => void) | undefined

const archiveClosed = (row: CoreApiConnectionsData['connections'][0] & Partial<TrafficCacheType>) => ({
  ...row,
  up: row.upload ?? 0,
  down: row.download ?? 0,
  closedAt: Date.now(),
})

const startStream = () => {
  if (unregisterConnectionsHandler) return
  unregisterConnectionsHandler = kernelApiStore.onConnections((data) => {
    const connections = data.connections || []
    const activeIds = new Set(connections.map((v) => v.id))

    dataSource.value.forEach((connection) => {
      const exist = activeIds.has(connection.id)
      if (!exist) {
        disconnectedData.value.push(archiveClosed(connection))
        delete TrafficCache[connection.id]
      }
    })
    trimDisconnected()

    dataSource.value = connections.map((connection) => {
      const result = { ...connection, up: 0, down: 0 }
      const cache = TrafficCache[connection.id]
      result.up = cache?.up ?? connection.upload
      result.down = cache?.down ?? connection.download
      TrafficCache[connection.id] = {
        down: connection.download,
        up: connection.upload,
      }
      return result
    })
  })
}

const stopStream = () => {
  unregisterConnectionsHandler?.()
  unregisterConnectionsHandler = undefined
}

onMounted(() => {
  startStream()
  if (root.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) {
        compact.value = entry.contentRect.width <= 640
      }
    })
    observer.observe(root.value)
  }
})
onActivated(() => {
  startStream()
})
onUnmounted(() => {
  stopStream()
  observer?.disconnect()
})
onDeactivated(() => {
  stopStream()
  hovering.value = false
})
const handleCloseAll = async () => {
  const selected = [...filteredConnections.value]
  if (!selected.length) return
  try {
    await confirm(
      'home.connections.closeVisible',
      t('common.confirmCloseConnections', [selected.length]),
      { type: 'text', okText: 'home.connections.close', danger: true },
    )
  } catch {
    return
  }

  await closeConnections(selected.map((row) => row.id))
}

const closeConnections = async (selected: string[]) => {
  const activeIds = new Set(dataSource.value.map((row) => row.id))
  const results = await Promise.allSettled(
    selected.map((id) => (activeIds.has(id) ? deleteConnection(id) : undefined)),
  )
  const stillActive = new Set(dataSource.value.map((row) => row.id))
  const closed = new Set<string>()
  let failure: PromiseRejectedResult | undefined
  selected.forEach((id, index) => {
    const result = results[index]!
    if (result.status === 'rejected' && stillActive.has(id)) failure ??= result
    else closed.add(id)
  })
  removeClosedConnections(closed)
  if (failure) message.error(failure.reason?.message || failure.reason)
}

const removeClosedConnections = (ids: Set<string>) => {
  const closedIds = new Set(disconnectedData.value.map((row) => row.id))
  for (const row of dataSource.value) {
    if (ids.has(row.id) && !closedIds.has(row.id)) disconnectedData.value.push(archiveClosed(row))
  }
  ids.forEach((id) => delete TrafficCache[id])
  dataSource.value = dataSource.value.filter((row) => !ids.has(row.id))
  if (isActive.value) snapshot.value = snapshot.value.filter((row) => !ids.has(row.id))
  trimDisconnected()
}

const handleClearClosedConns = () => {
  const ids = new Set(filteredConnections.value.map((connection) => connection.id))
  disconnectedData.value = disconnectedData.value.filter((connection) => !ids.has(connection.id))
  snapshot.value = snapshot.value.filter((connection) => !ids.has(connection.id))
}

const trimDisconnected = () => {
  if (disconnectedData.value.length > 1000)
    disconnectedData.value = disconnectedData.value.slice(-1000)
}

const handleResetConnections = () => {
  appSettingsStore.app.connections = DefaultConnections()
  message.success('common.success')
}

const rulesetActions = (record: Record<string, any>): App.Menu[] => [
  { label: 'home.connections.addToDirect', handler: () => addRecordToRuleset('direct', record) },
  { label: 'home.connections.addToProxy', handler: () => addRecordToRuleset('proxy', record) },
  { label: 'home.connections.addToReject', handler: () => addRecordToRuleset('reject', record) },
]

const onRowClick = (record: Record<string, any>) => {
  openDetails(record)
}
const clearFilters = () => {
  keywords.value = ''
  filters.value = {}
}
</script>

<template>
  <div ref="root" class="flex flex-col h-full">
    <div class="flex flex-wrap gap-6 items-center">
      <Radio
        v-model="isActive"
        :options="[
          { label: 'home.connections.active', value: true },
          { label: 'home.connections.closed', value: false },
        ]"
        size="small"
      />
      <Input
        v-model="keywords"
        clearable
        size="small"
        :placeholder="t('common.keywords')"
        class="flex-1 min-w-128"
      />
      <Button
        icon="filter"
        size="small"
        :type="selectedFilterCount ? 'primary' : 'text'"
        :aria-expanded="showFilters"
        @click="showFilters = !showFilters"
      >
        {{ t('home.connections.filters')
        }}{{ selectedFilterCount ? ' (' + selectedFilterCount + ')' : '' }}
      </Button>
      <Button
        v-tips="isPause ? 'common.resume' : 'common.pause'"
        :aria-pressed="isPause"
        :icon="isPause ? 'play' : 'pause'"
        size="small"
        :type="isPause ? 'primary' : 'text'"
        @click="togglePause"
        >{{ isPause ? t('common.resume') : t('workspace.freeze') }}</Button
      >
      <Button
        v-if="isActive"
        v-tips="'home.connections.closeVisible'"
        :aria-label="t('home.connections.closeVisible')"
        :disabled="!filteredConnections.length"
        icon="close"
        icon-color="var(--danger-color)"
        size="small"
        type="text"
        @click="handleCloseAll"
      />
      <Button
        v-else
        v-tips="'home.connections.clearVisible'"
        :aria-label="t('home.connections.clearVisible')"
        :disabled="!filteredConnections.length"
        icon="clear"
        size="small"
        type="text"
        @click="handleClearClosedConns"
      />
      <Button
        v-tips="'home.connections.sort'"
        :aria-label="t('home.connections.sort')"
        icon="settings"
        size="small"
        type="text"
        @click="toggleSettings"
      />
    </div>
    <div v-if="showFilters" class="connection-filters mt-8">
      <div
        v-for="(label, field) in connectionFilterFields"
        :key="field"
        role="group"
        :aria-label="t(label)"
        class="flex flex-col gap-2"
      >
        <span class="text-12 text-muted">{{ t(label) }}</span>
        <MultipleSelect
          :model-value="filters[field] || []"
          :options="filterOptions[field]"
          placeholder="home.connections.any"
          size="small"
          auto-size
          clearable
          @update:model-value="filters[field] = $event"
        />
      </div>
      <Button v-if="selectedFilterCount" type="text" size="small" @click="filters = {}">
        {{ t('common.reset') }}
      </Button>
    </div>
    <div class="flex flex-wrap items-center gap-6 mt-8">
      <span class="text-12 text-muted"
        >{{ filteredConnections.length }} / {{ visibleSource.length }}</span
      >
      <Tag v-if="frozen && isActive" size="small" color="orange">
        {{ t('common.pause') }}
      </Tag>
      <span v-if="newConnections" class="text-12 text-secondary">{{
        t('workspace.newConnections', [newConnections])
      }}</span>
      <Button
        v-if="keywords || selectedFilterCount"
        size="small"
        type="link"
        @click="clearFilters"
        >{{ t('workspace.clearFilters') }}</Button
      >
    </div>
    <div v-if="compact" class="flex-1 overflow-y-auto mt-8">
      <Empty v-if="!compactConnections.length" />
      <Card
        v-for="record in compactConnections"
        :key="record.id"
        :title="record.metadata.host || record.metadata.destinationIP"
        class="mb-6"
      >
        <div class="break-all text-12">
          {{ record.rule }}{{ record.rulePayload ? '::' + record.rulePayload : '' }} ·
          {{ record.chains.slice().reverse().join(' → ') }}
        </div>
        <div class="font-mono text-12 text-muted mt-2">
          ↑ {{ formatBytes(record.upload) }} · ↓ {{ formatBytes(record.download) }}
          <span v-if="record.start"> · {{ formatRelativeTime(record.start) }}</span>
        </div>
        <div class="flex gap-4 mt-6">
          <Button size="small" @click="openDetails(record)">{{ t('common.details') }}</Button>
          <ResourceActions
            :name="record.metadata.host || record.metadata.destinationIP"
            :items="
              menu
                .filter((m) => m.label !== 'common.details')
                .map((m) => ({ ...m, handler: () => m.handler?.(record) }))
            "
          />
        </div>
      </Card>
    </div>
    <Table
      v-else
      class="flex-1 mt-8"
      :columns="columns"
      :menu="menu"
      :data-source="filteredConnections"
      sort="start"
      @pointerover="
        $event.pointerType === 'mouse' &&
          (hovering = ($event.target as Element)?.closest('tbody tr') != null)
      "
      @pointerleave="hovering = false"
      @row-click="onRowClick"
    >
      <template #__actions="{ record }">
        <div class="inline-flex items-center gap-2">
          <Button
            v-tips="'common.details'"
            :aria-label="t('common.details')"
            icon="preview"
            :icon-size="14"
            size="small"
            type="text"
            @click.stop="openDetails(record)"
          />
          <Button
            v-if="isActive"
            v-tips="'home.connections.close'"
            :aria-label="t('home.connections.close')"
            icon="close"
            :icon-size="14"
            icon-color="var(--danger-color)"
            size="small"
            type="text"
            @click.stop="closeSingleConnection(record)"
          />
          <ResourceActions
            :name="record.metadata.host || record.metadata.destinationIP"
            :items="rulesetActions(record)"
          />
        </div>
      </template>
    </Table>
  </div>

  <Modal
    v-model:open="showDetails"
    :submit="false"
    cancel-text="common.close"
    size="drawer"
    title="home.connections.details"
    mask-closable
  >
    <dl class="connection-details">
      <template v-for="entry in detailEntries" :key="entry.key">
        <dt>{{ entry.label }}</dt>
        <dd>{{ entry.value }}</dd>
      </template>
    </dl>
  </Modal>

  <Modal
    v-model:open="showSettings"
    :submit="false"
    size="md"
    mask-closable
    max-height="80"
    cancel-text="common.close"
    title="home.connections.sort"
  >
    <template #action>
      <Button type="text" class="mr-auto" @click="handleResetConnections">
        {{ t('common.reset') }}
      </Button>
    </template>
    <div v-draggable="[appSettingsStore.app.connections.order, DraggableOptions]">
      <Card
        v-for="column in appSettingsStore.app.connections.order"
        :key="column"
        flush
        class="mb-6"
      >
        <div class="flex items-center justify-between py-6 gap-8">
          <div class="flex items-center gap-8">
            <Icon icon="drag" :size="15" color="var(--muted-color)" class="cursor-move" />
            <span class="font-bold">{{ t(columnTitleMap[column] || column) }}</span>
          </div>
          <Switch v-model="appSettingsStore.app.connections.visibility[column]" />
        </div>
      </Card>
    </div>
  </Modal>
</template>

<style scoped>
.connection-filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
  align-items: end;
  gap: 6px 10px;
}
</style>

<style scoped>
.connection-details {
  display: grid;
  grid-template-columns: minmax(90px, 1fr) minmax(0, 2fr);
  gap: 8px;
}
dt {
  color: var(--text-secondary);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
