<script setup lang="ts">
import { onMounted, onUnmounted, ref, unref } from 'vue'

import useI18n from '@/lang'

import { type Props as InputProps } from '@/components/Input/index.vue'

interface Props {
  title: string
  initialValue?: string | number
  props: Omit<InputProps, 'modelValue'>
}

const props = withDefaults(defineProps<Props>(), {
  initialValue: '',
})

const emits = defineEmits(['submit', 'cancel', 'finish'])

const type = typeof props.initialValue === 'string' ? 'text' : 'number'
const value = ref(props.initialValue)

const { t } = useI18n.global

const handleSubmit = (e?: Event) => {
  if (e?.type === 'keydown' && props.props.type === 'code') return
  emits('submit', unref(value))
  emits('finish')
}

const handleCancel = () => {
  emits('cancel')
  emits('finish')
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.stopPropagation()
    e.preventDefault()
    handleCancel()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div class="gui-overlay-mask fixed inset-0 flex items-center justify-center p-16 backdrop-blur-sm">
    <Transition name="dialog-pop" appear>
      <div
        role="dialog"
        aria-modal="true"
        :aria-label="t(title)"
        class="gui-prompt flex flex-col rounded-12"
      >
        <div class="gui-prompt__header font-bold text-16 break-all px-16 py-12">
          {{ t(title) }}
        </div>
        <div class="px-16 py-12">
          <Input
            v-model="value"
            v-bind="props.props"
            :type="props.props.type || type"
            autofocus
            clearable
            size="small"
            class="w-full"
            @keydown.enter="handleSubmit"
          />
        </div>
        <div class="gui-prompt__footer flex items-center justify-end gap-8 px-16 py-12">
          <Button size="small" @click="handleCancel">{{ t('common.cancel') }}</Button>
          <Button size="small" type="primary" @click="handleSubmit()">
            {{ t('common.confirm') }}
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

.gui-prompt {
  width: min(440px, 100%);
  background: var(--modal-bg);
  color: var(--color);
  border: 1px solid var(--border-color);
  box-shadow: 0 20px 48px rgba(15, 23, 42, 0.24);
  overflow: hidden;
}

.gui-prompt__header {
  border-bottom: 1px solid var(--border-color);
}

.gui-prompt__footer {
  border-top: 1px solid var(--border-color);
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
