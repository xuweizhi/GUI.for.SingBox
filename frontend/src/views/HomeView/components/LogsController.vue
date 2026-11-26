<script lang="ts" setup>
import { ref, computed, nextTick, onActivated, watch, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { ClipboardSetText } from '@/bridge'
import { LogLevelOptions } from '@/constant/kernel'
import { useBool } from '@/hooks'
import { useKernelApiStore, useLogsStore } from '@/stores'
import {
  addToRuleSet,
  buildSmartRegExp,
  getDomainSuffixes,
  isValidIPv4,
  isValidIPv6,
  message,
  picker,
} from '@/utils'

import type { PickerItem } from '@/components/Picker/index.vue'
import type { CoreApiLogsData } from '@/types/kernel'

const logType = ref<'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'panic'>('info')
const keywords = ref('')
const pausedLogs = ref<CoreApiLogsData[]>([])

const LogLevelMap = {
  trace: ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'panic'],
  debug: ['debug', 'info', 'warn', 'error', 'fatal', 'panic'],
  info: ['info', 'warn', 'error', 'fatal', 'panic'],
  warn: ['warn', 'error', 'fatal', 'panic'],
  error: ['error', 'fatal', 'panic'],
  fatal: ['fatal', 'panic'],
  panic: ['panic'],
}

const props = defineProps<{ initialSource?: 'api' | 'core' }>()
const source = ref<'api' | 'core'>(props.initialSource || 'api')
const follow = ref(true)
const viewport = useTemplateRef<HTMLElement>('viewport')
const sourceLogs = computed(() =>
  source.value === 'api' ? logsStore.apiEntries : logsStore.processEntries,
)
const filteredLogs = computed(() => {
  const logs = pause.value ? pausedLogs.value : sourceLogs.value

  const pattern = buildSmartRegExp(keywords.value, 'i')
  return logs
    .filter((v) => {
      const hitType = LogLevelMap[logType.value].includes(v.type)
      const hitName = pattern.test(v.payload)
      return hitName && hitType
    })
    .reverse()
})

const addLogToRuleset = async (
  ruleset: 'direct' | 'proxy' | 'reject',
  { type, payload }: CoreApiLogsData,
) => {
  if (type !== 'info') {
    message.error(t('common.notSupported'))
    return
  }
  const regex =
    /\[([a-fA-F\d:.%]+)\](?::\d+)?|((?:[a-zA-Z\d-]+\.)+[a-zA-Z]{2,}|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?|((?:[a-fA-F\d]{1,4}:){2,}[a-fA-F\d:]*)/g
  const addresses = [
    ...new Set(
      Array.from(
        String(payload).matchAll(regex),
        (match) => match[1] || match[2] || match[3],
      ).filter(
        (address): address is string =>
          Boolean(address) &&
          (isValidIPv4(address!) ||
            isValidIPv6(address!) ||
            /^(?:[a-zA-Z\d-]+\.)+[a-zA-Z]{2,}$/.test(address!)),
      ),
    ),
  ]
  if (!addresses.length) {
    message.error(t('common.notMatched'))
    return
  }

  const options: PickerItem<Record<string, any>[]>[] = []

  addresses.forEach((address) => {
    if (isValidIPv4(address) || isValidIPv6(address)) {
      options.push({
        label: t('kernel.rules.type.ip_cidr'),
        value: { ip_cidr: `${address}/${isValidIPv6(address) ? 128 : 32}` } as any,
        description: address,
      })
    } else {
      options.push({
        label: t('kernel.rules.type.domain'),
        value: { domain: address } as any,
        description: address,
      })
      getDomainSuffixes(address).forEach((suffix) => {
        options.push({
          label: t('kernel.rules.type.domain_suffix'),
          value: { domain_suffix: suffix } as any,
          description: suffix,
        })
      })
    }
  })

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

const menus: App.Menu[] = (
  [
    ['home.connections.addToDirect', 'direct'],
    ['home.connections.addToProxy', 'proxy'],
    ['home.connections.addToReject', 'reject'],
  ] as const
).map(([label, ruleset]) => ({
  label,
  handler: (log: CoreApiLogsData) => addLogToRuleset(ruleset, log),
}))

const rowKeys = new WeakMap<CoreApiLogsData, number>()
let nextKey = 0
const logKey = (log: CoreApiLogsData) => {
  let key = rowKeys.get(log)
  if (key === undefined) {
    key = ++nextKey
    rowKeys.set(log, key)
  }
  return key
}

const logTagColor = (level: string) => {
  if (level === 'error' || level === 'fatal' || level === 'panic') return 'red'
  if (level === 'warn') return 'orange'
  if (level === 'info') return 'blue'
  return 'default'
}

const { t } = useI18n()
const [pause, togglePause] = useBool(false)
const kernelApiStore = useKernelApiStore()
const logsStore = useLogsStore()

const handleClear = () => {
  pausedLogs.value.splice(0)
  logsStore.clearSource(source.value)
}

watch([pause, source], () => {
  if (pause.value) pausedLogs.value = sourceLogs.value.slice()
})
const scrollToBottom = () => {
  if (!follow.value) return
  nextTick(() => {
    if (follow.value && viewport.value) viewport.value.scrollTop = viewport.value.scrollHeight
  })
}
watch([filteredLogs, follow], scrollToBottom, { flush: 'post', immediate: true })
watch(
  source,
  (value) => {
    if (value === 'core' && !logsStore.processEntries.length)
      void kernelApiStore.refreshKernelLogs()
  },
  { immediate: true },
)
const onScroll = () => {
  const el = viewport.value
  if (!el || !follow.value) return
  if (el.scrollHeight - el.scrollTop - el.clientHeight > 24) follow.value = false
}
onActivated(scrollToBottom)
const copyLogs = async () => {
  const content = filteredLogs.value
    .map((log) => (source.value === 'api' ? `[${log.type}] ${log.payload}` : log.payload))
    .join('\n')
  try {
    if (await ClipboardSetText(content)) message.success('common.copied')
    else message.error('ClipboardSetText Error')
  } catch (error) {
    message.error(error)
  }
}

</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex flex-wrap items-center gap-8">
      <Radio
        v-model="source"
        size="small"
        :options="[
          { label: 'common.apiLogs', value: 'api' },
          { label: 'common.coreLogs', value: 'core' },
        ]"
      />
      <Select v-model="logType" :options="LogLevelOptions" size="small" />
      <Input
        v-model="keywords"
        clearable
        size="small"
        :placeholder="t('common.keywords')"
        class="flex-1 min-w-128"
      />
      <Switch v-model="follow" size="small" label="workspace.follow" />
      <Button
        size="small"
        type="text"
        icon="copy"
        :aria-label="t('common.copy')"
        :disabled="!filteredLogs.length"
        @click="copyLogs"
      />
      <Button
        v-if="source === 'core'"
        size="small"
        icon="refresh"
        :aria-label="t('common.refresh')"
        @click="kernelApiStore.refreshKernelLogs(true)"
      />
      <Button
        v-tips="pause ? 'common.resume' : 'common.pause'"
        :aria-label="t(pause ? 'common.resume' : 'common.pause')"
        :icon="pause ? 'play' : 'pause'"
        type="text"
        size="small"
        @click="togglePause"
      />
      <Button
        v-tips="'common.clear'"
        :aria-label="t('common.clear')"
        icon="clear"
        size="small"
        type="text"
        @click="handleClear"
      />
    </div>

    <Empty v-if="filteredLogs.length === 0" />

    <div v-else ref="viewport" class="mt-8 overflow-y-auto flex-1" @scroll.passive="onScroll">
      <div
        v-for="log in filteredLogs"
        :key="logKey(log)"
        v-menu="
          log.type === 'info' ? menus.map((v) => ({ ...v, handler: () => v.handler?.(log) })) : []
        "
        class="log select-text font-mono text-12 py-2 px-8 flex items-start gap-8"
      >
        <time
          v-if="log.time"
          class="text-muted shrink-0 whitespace-nowrap"
          :datetime="log.time"
          >{{ new Date(log.time).toLocaleTimeString() }}</time
        >
        <Tag :color="logTagColor(log.type)" size="small" class="log-badge shrink-0">
          {{ log.type }}
        </Tag>
        <span class="flex-1 min-w-0 break-all leading-relaxed">{{ log.payload }}</span>
        <Dropdown v-if="log.type === 'info'" align="end" class="log-actions shrink-0">
          <Button
            :aria-label="t('common.more')"
            icon="more"
            :icon-size="14"
            size="small"
            type="text"
          />
          <template #overlay="{ close }">
            <div class="flex flex-col gap-2 min-w-128 p-6">
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    addLogToRuleset('direct', log)
                    close()
                  }
                "
              >
                {{ t('home.connections.addToDirect') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    addLogToRuleset('proxy', log)
                    close()
                  }
                "
              >
                {{ t('home.connections.addToProxy') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    addLogToRuleset('reject', log)
                    close()
                  }
                "
              >
                {{ t('home.connections.addToReject') }}
              </Button>
            </div>
          </template>
        </Dropdown>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.log {
  min-height: 24px;
  border-bottom: 1px solid var(--surface-border);
}
.log:nth-child(odd) {
  background: var(--surface-bg);
}
.log-badge {
  min-width: 48px;
  justify-content: center;
  margin: 0;
  text-transform: uppercase;
}
</style>
