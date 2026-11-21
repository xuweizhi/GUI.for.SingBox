<script setup lang="ts">
import { h, onMounted, withDirectives } from 'vue'

import { ClipboardSetText } from '@/bridge'
import vTips from '@/directives/tips'
import { useKernelApiStore, useLogsStore } from '@/stores'
import { message } from '@/utils'

import Button from '@/components/Button/index.vue'

const logsStore = useLogsStore()
const kernelApiStore = useKernelApiStore()

const modalSlots = {
  toolbar: () =>
    withDirectives(
      h(Button, {
        type: 'text',
        size: 'small',
        icon: 'copy',
        onClick: async () => {
          if (logsStore.isEmpty) return
          await ClipboardSetText(logsStore.kernelLogs.join('\n'))
          message.success('common.copied')
        },
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
  <div class="h-full overflow-y-auto">
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
</template>

<style lang="less" scoped>
.kernel-log-line {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
}
</style>
