<script setup lang="ts">
import { computed } from 'vue'

import i18n from '@/lang'

export type MessageIcon = 'info' | 'warn' | 'error' | 'success'

interface Props {
  icon?: MessageIcon
  content: string
}

const props = withDefaults(defineProps<Props>(), {
  icon: 'info',
})

defineEmits(['close'])

const { t } = i18n.global

const iconMap = {
  info: 'messageInfo',
  success: 'messageSuccess',
  error: 'messageError',
  warn: 'messageWarn',
}

const icon = computed(() => iconMap[props.icon] as any)
</script>

<template>
  <Transition name="slide-down" appear>
    <div
      role="status"
      aria-live="polite"
      class="gui-message flex items-center gap-8 py-8 pl-14 pr-8 rounded-8 my-4"
    >
      <Icon class="shrink-0" :icon="icon" />
      <div class="text-14 break-all">{{ t(content) }}</div>
      <Button
        icon="close"
        :icon-size="12"
        :aria-label="t('common.close')"
        type="text"
        size="small"
        class="close px-4 shrink-0"
        @click="$emit('close')"
      />
    </div>
  </Transition>
</template>

<style lang="less" scoped>
.gui-message {
  pointer-events: auto;
  max-width: min(560px, calc(100vw - 24px));
  background: var(--toast-bg);
  color: var(--color);
  border: 1px solid var(--border-color);
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.16);

  .close {
    opacity: 0.55;
    transition: opacity 0.16s ease;
  }

  &:hover .close {
    opacity: 1;
  }
}
</style>
