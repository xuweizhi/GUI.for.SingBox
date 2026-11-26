<script setup lang="ts">
import { onUnmounted, ref, watch, nextTick, useTemplateRef } from 'vue'

import { debounce } from '@/utils'

type TriggerType = 'click' | 'hover'

interface Props {
  trigger?: TriggerType[]
  placement?: 'bottom' | 'top'
  align?: 'start' | 'center' | 'end'
  delay?: number
}

const props = withDefaults(defineProps<Props>(), {
  align: 'center',
  trigger: () => ['click'],
  placement: 'bottom',
  delay: 0,
})

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const domRef = useTemplateRef('domRef')
const overlayRef = useTemplateRef('overlayRef')
const overlayStyle = ref({ top: 'auto', left: '0px', bottom: 'auto', maxHeight: 'none' })
const show = ref(false)
const transformOrigin = ref(props.placement === 'top' ? 'bottom' : 'top')
let hoverLeaveTimer: ReturnType<typeof setTimeout> | undefined

const updatePosition = () => {
  if (!domRef.value || !overlayRef.value || !show.value) return

  const triggerRect = domRef.value.getBoundingClientRect()
  const overlayEl = overlayRef.value

  overlayEl.style.minWidth = `${triggerRect.width}px`
  overlayEl.style.maxHeight = 'none'

  const overlayHeight = overlayEl.offsetHeight
  const overlayWidth = overlayEl.offsetWidth

  const screenEdgeMargin = 8
  const gap = 4

  const totalSpaceBelow = window.innerHeight - triggerRect.bottom - gap
  const totalSpaceAbove = triggerRect.top - gap

  let finalPlacement: 'top' | 'bottom'

  const canPlaceBottom = totalSpaceBelow >= overlayHeight
  const canPlaceTop = totalSpaceAbove >= overlayHeight

  if (props.placement === 'bottom') {
    if (canPlaceBottom) {
      finalPlacement = 'bottom'
    } else if (canPlaceTop) {
      finalPlacement = 'top'
    } else {
      finalPlacement = totalSpaceBelow > totalSpaceAbove ? 'bottom' : 'top'
    }
  } else {
    if (canPlaceTop) {
      finalPlacement = 'top'
    } else if (canPlaceBottom) {
      finalPlacement = 'bottom'
    } else {
      finalPlacement = totalSpaceAbove > totalSpaceBelow ? 'top' : 'bottom'
    }
  }

  transformOrigin.value = finalPlacement === 'top' ? 'bottom' : 'top'

  if (finalPlacement === 'bottom') {
    overlayStyle.value.top = `${triggerRect.bottom + gap}px`
    overlayStyle.value.bottom = 'auto'
    const availableHeight = totalSpaceBelow - screenEdgeMargin
    overlayStyle.value.maxHeight = `${Math.max(0, availableHeight)}px`
  } else {
    overlayStyle.value.bottom = `${window.innerHeight - triggerRect.top + gap}px`
    overlayStyle.value.top = 'auto'
    const availableHeight = totalSpaceAbove - screenEdgeMargin
    overlayStyle.value.maxHeight = `${Math.max(0, availableHeight)}px`
  }

  let left = triggerRect.left
  if (props.align === 'end') left = triggerRect.right - overlayWidth
  else if (props.align !== 'start') left += (triggerRect.width - overlayWidth) / 2

  if (left + overlayWidth > window.innerWidth - screenEdgeMargin) {
    left = window.innerWidth - overlayWidth - screenEdgeMargin
  }
  if (left < screenEdgeMargin) {
    left = screenEdgeMargin
  }
  overlayStyle.value.left = `${left}px`
}

defineExpose({ updatePosition })

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && show.value) {
    e.preventDefault()
    e.stopImmediatePropagation()
    close()
    const focusTarget = domRef.value?.querySelector<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href], input:not([disabled])',
    )
    focusTarget?.focus()
  }
}

const onDomClick = (e: MouseEvent) => {
  if (!domRef.value?.contains(e.target as Node) && !overlayRef.value?.contains(e.target as Node)) {
    close()
  }
}

watch(show, async (isVisible) => {
  emit('update:show', isVisible)
  if (isVisible) {
    await nextTick()
    if (!show.value) return
    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('keydown', onKeydown, true)
    if (hasTrigger('click')) {
      document.addEventListener('click', onDomClick)
    }
  } else {
    window.removeEventListener('scroll', updatePosition, true)
    window.removeEventListener('resize', updatePosition)
    window.removeEventListener('keydown', onKeydown, true)
    document.removeEventListener('click', onDomClick)
  }
})

const open = () => (show.value = true)
const close = () => (show.value = false)
const toggle = () => (show.value = !show.value)
const hasTrigger = (t: TriggerType) => props.trigger.includes(t)

const debounceOpen = debounce(open, props.delay)

const onMouseEnter = () => {
  if (hasTrigger('hover')) {
    clearTimeout(hoverLeaveTimer)
    debounceOpen()
  }
}

const onMouseLeave = () => {
  if (hasTrigger('hover')) {
    debounceOpen.cancel()
    hoverLeaveTimer = setTimeout(close, 120)
  }
}

const onClick = () => {
  if (hasTrigger('click')) {
    show.value = !show.value
  }
}

onUnmounted(() => {
  clearTimeout(hoverLeaveTimer)
  debounceOpen.cancel()
  document.removeEventListener('click', onDomClick)
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <div
    ref="domRef"
    class="gui-dropdown relative inline-flex flex-col items-center"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @click="onClick"
  >
    <slot v-bind="{ open, close, toggle, show }"></slot>
    <Teleport to="body">
      <Transition name="overlay">
        <div
          v-if="show"
          ref="overlayRef"
          :style="overlayStyle"
          class="gui-dropdown-overlay fixed rounded-8 overflow-y-auto"
          @mouseenter="onMouseEnter"
          @mouseleave="onMouseLeave"
          @click.stop
        >
          <slot name="overlay" v-bind="{ open, close, toggle, show }"></slot>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style lang="less" scoped>
.overlay-enter-active,
.overlay-leave-active {
  transition:
    transform 0.16s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.16s ease;
  transform-origin: v-bind(transformOrigin);
}

.overlay-enter-from,
.overlay-leave-to {
  opacity: 0;
  transform: scaleY(0.92);
}

.gui-dropdown-overlay {
  z-index: var(--z-popover, 10000);
  max-width: calc(100vw - 16px);
  background: var(--dropdown-bg);
  border: 1px solid var(--surface-border, var(--border-color));
  border-radius: calc(var(--control-radius, 8px) + 3px);
  box-shadow: var(--dropdown-shadow);
  backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
  -webkit-backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
}
</style>
