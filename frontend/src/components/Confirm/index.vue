<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'

import { useOverlayFocus } from '@/hooks/useOverlayFocus'
import useI18n from '@/lang'

import MarkdownViewer from '@/components/MarkdownViewer/index.vue'

export type ConfirmOptions = {
  type: 'text' | 'markdown'
  cancelText?: string
  okText?: string
  danger?: boolean
}

interface Props {
  title: string
  message: string | Record<string, any>
  options?: ConfirmOptions
  cancel?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  cancel: true,
  options: () => ({ type: 'text' }),
})

const emits = defineEmits(['confirm', 'cancel', 'finish'])

const { t } = useI18n.global

const content = computed(() => {
  if (typeof props.message !== 'string') {
    return JSON.stringify(props.message, null, 2)
  }
  if (props.options.type === 'text') {
    return t(props.message)
  }
  return props.message
})

const handleConfirm = () => {
  emits('confirm', true)
  emits('finish')
}

const handleCancel = () => {
  emits('cancel')
  emits('finish')
}

const dialog = useTemplateRef<HTMLElement>('dialog')
useOverlayFocus(dialog, () => props.cancel ? handleCancel() : handleConfirm())
</script>

<template>
  <div
    class="gui-overlay-mask fixed inset-0 flex items-center justify-center p-16 backdrop-blur-sm"
    @click.self="!cancel && handleConfirm()"
  >
    <Transition name="dialog-pop" appear>
      <div
        role="alertdialog"
        ref="dialog"
        tabindex="-1"
        aria-modal="true"
        :aria-label="t(title)"
        class="gui-confirm flex flex-col rounded-12"
      >
        <div class="gui-confirm__header font-bold text-16 break-all px-16 py-12">
          {{ t(title) }}
        </div>
        <div
          v-if="options.type === 'markdown'"
          class="gui-confirm__body flex-1 overflow-y-auto text-13 leading-relaxed px-16 py-12 break-all whitespace-pre-wrap select-text"
        >
          <MarkdownViewer :content="content" />
        </div>
        <div
          v-else
          class="gui-confirm__body flex-1 overflow-y-auto text-13 leading-relaxed px-16 py-12 break-all whitespace-pre-wrap select-text"
        >
          {{ content }}
        </div>
        <div class="gui-confirm__footer flex items-center justify-end gap-8 px-16 py-12">
          <Button v-if="cancel" size="small" @click="handleCancel">
            {{ t(options.cancelText || 'common.cancel') }}
          </Button>
          <Button
            size="small"
            :type="options.danger ? 'danger' : 'primary'"
            @click="handleConfirm"
          >
            {{ t(options.okText || 'common.confirm') }}
          </Button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style lang="less" scoped>
.gui-overlay-mask {
  z-index: 99999;
  background: var(--modal-mask-bg);
}

.gui-confirm {
  width: min(460px, 100%);
  max-height: min(76dvh, 640px);
  background: var(--modal-bg);
  color: var(--color);
  border: 1px solid var(--surface-border, var(--border-color));
  box-shadow: 0 20px 48px rgba(15, 23, 42, 0.24);
  overflow: hidden;
}

.gui-confirm__header {
  border-bottom: 1px solid var(--surface-border, var(--border-color));
}

.gui-confirm__body {
  min-height: 0;
}

.gui-confirm__footer {
  border-top: 1px solid var(--surface-border, var(--border-color));
}

.dialog-pop-enter-active,
.dialog-pop-leave-active {
  transition:
    transform 0.16s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.16s ease;
}

.dialog-pop-enter-from,
.dialog-pop-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}
</style>
