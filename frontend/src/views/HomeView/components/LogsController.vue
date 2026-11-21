<script lang="ts" setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'

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

const filteredLogs = computed(() => {
  const logs = pause.value ? pausedLogs.value : logsStore.kernelApiLogs

  return logs.filter((v) => {
    const hitType = LogLevelMap[logType.value].includes(v.type)
    const hitName = buildSmartRegExp(keywords.value, 'i').test(v.payload)
    return hitName && hitType
  })
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
      Array.from(String(payload).matchAll(regex), (match) => match[1] || match[2] || match[3]).filter(
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

  const payloads = await picker.multi('rulesets.selectRuleType', options)

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
  logsStore.clearKernelLog()
}

watch(pause, (value) => {
  if (value) {
    pausedLogs.value = logsStore.kernelApiLogs.slice()
  }
})

onMounted(() => {
  if (logsStore.isEmpty) {
    void kernelApiStore.refreshKernelLogs()
  }
})
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex flex-wrap items-center gap-8">
      <span class="text-12 text-muted">
        {{ t('kernel.log.level') }}
      </span>
      <Select v-model="logType" :options="LogLevelOptions" size="small" />
      <Input
        v-model="keywords"
        clearable
        size="small"
        :placeholder="t('common.keywords')"
        class="flex-1 min-w-128"
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

    <div v-else class="mt-8 overflow-y-auto flex-1 flex flex-col gap-4">
      <div
        v-for="(log, i) in filteredLogs"
        :key="`${i}-${log.type}-${log.payload}`"
        v-menu="menus.map((v) => ({ ...v, handler: () => v.handler?.(log) }))"
        class="log select-text font-mono text-12 py-6 px-8 rounded-6 flex items-start gap-8"
      >
        <Tag :color="logTagColor(log.type)" size="small" class="log-badge shrink-0">
          {{ log.type }}
        </Tag>
        <span class="flex-1 min-w-0 break-all leading-relaxed">{{ log.payload }}</span>
        <Dropdown v-if="log.type === 'info'" class="log-actions shrink-0">
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
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  transition:
    background-color 0.14s ease,
    border-color 0.14s ease;

  &:hover {
    background: var(--card-hover-bg);
    border-color: color-mix(in srgb, var(--accent-text) 35%, var(--border-color));
  }
}

.log-badge {
  min-width: 48px;
  justify-content: center;
  margin: 0;
  text-transform: uppercase;
}
</style>
