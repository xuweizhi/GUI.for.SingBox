<script setup lang="ts">
import { h, onMounted, withDirectives } from 'vue'
import { useI18n } from 'vue-i18n'

import { ClipboardSetText } from '@/bridge'
import vTips from '@/directives/tips'
import { useKernelApiStore, useLogsStore } from '@/stores'
import { message } from '@/utils'

import Button from '@/components/Button/index.vue'

withDefaults(defineProps<{ inline?: boolean }>(), {
  inline: false,
})

const { t } = useI18n()
const logsStore = useLogsStore()
const kernelApiStore = useKernelApiStore()

const handleCopyLogs = async () => {
  if (logsStore.isEmpty) return
  await ClipboardSetText(logsStore.kernelLogs.join('\n'))
  message.success('common.copied')
}

const handleRefreshLogs = () => {
  void kernelApiStore.refreshKernelLogs()
}

const modalSlots = {
  toolbar: () =>
    withDirectives(
      h(Button, {
        type: 'text',
        size: 'small',
        icon: 'copy',
        onClick: handleCopyLogs,
      }),
      [[vTips, 'common.copy']],
    ),
}

defineExpose({ modalSlots })

onMounted(() => {
  if (logsStore.isEmpty) {
    void kernelApiStore.refreshKernelLogs()
  }
})
</script>

<template>
  <div class="h-full flex flex-col gap-8">
    <div v-if="inline" class="flex items-center justify-end gap-6 shrink-0">
      <Button type="text" size="small" icon="refresh" @click="handleRefreshLogs">
        {{ t('common.refresh') }}
      </Button>
      <Button
        type="normal"
        size="small"
        icon="copy"
        :disabled="logsStore.isEmpty"
        @click="handleCopyLogs"
      >
        {{ t('common.copy') }}
      </Button>
    </div>
    <div class="flex-1 min-h-0 overflow-y-auto">
      <Empty v-if="logsStore.isEmpty" description="home.overview.noLogs" />
      <div v-else class="flex flex-col gap-4">
        <div
          v-for="(log, i) in logsStore.kernelLogs"
          :key="i"
          class="kernel-log-line select-text font-mono text-12 py-6 px-8 rounded-6 break-all"
        >
          {{ log }}
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.kernel-log-line {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
}
</style>
