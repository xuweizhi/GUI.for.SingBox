<script lang="ts" setup>
import { ref, watch, nextTick, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

interface Props {
  position: { x: number; y: number }
  message?: string
}

const props = withDefaults(defineProps<Props>(), {
  message: '',
})

const model = defineModel<boolean>()

const domRef = useTemplateRef('domRef')
const fixedPosition = ref({ x: 0, y: 0 })

const { t } = useI18n()

const updatePosition = (x: number, y: number) => {
  nextTick(() => {
    const el = domRef.value
    if (!el) return
    const margin = 8
    const gap = 12
    const width = el.offsetWidth
    const height = el.offsetHeight
    const maxX = Math.max(margin, window.innerWidth - width - margin)
    const nextX = Math.min(maxX, Math.max(margin, x - width / 2))
    let nextY = y - height - gap
    if (nextY < margin) {
      nextY = Math.min(window.innerHeight - height - margin, y + gap + 8)
    }
    fixedPosition.value = { x: Math.round(nextX), y: Math.round(nextY) }
  })
}

watch(
  [() => props.position, () => model.value, () => props.message],
  ([pos, visible]) => {
    if (visible) {
      updatePosition(pos.x, pos.y)
    }
  },
  { deep: true },
)
</script>

<template>
  <Transition name="tips-fade">
    <div
      v-show="model"
      ref="domRef"
      role="tooltip"
      :style="{ left: fixedPosition.x + 'px', top: fixedPosition.y + 'px' }"
      class="gui-tips fixed z-9999 pointer-events-none whitespace-pre-wrap text-center text-12 px-8 py-6 rounded-8 min-w-64 backdrop-blur-sm"
    >
      {{ t(message) }}
    </div>
  </Transition>
</template>

<style lang="less" scoped>
.tips-fade-enter-active,
.tips-fade-leave-active {
  transition: opacity 0.14s ease;
}

.tips-fade-enter-from,
.tips-fade-leave-to {
  opacity: 0;
}

.gui-tips {
  max-width: min(320px, calc(100vw - 16px));
  background: var(--menu-bg);
  color: var(--color);
  border: 1px solid var(--border-color);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
}
</style>
