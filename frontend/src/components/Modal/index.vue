<script lang="ts">
export const IS_IN_MODAL = 'IS_IN_MODAL'
</script>

<script setup lang="ts">
import { computed, markRaw, nextTick, onUnmounted, provide, ref, useTemplateRef, watch } from 'vue'

import { useBool } from '@/hooks'
import { draftGuardKey } from '@/hooks/useFormDraft'
import { useAppStore } from '@/stores'
import { sampleID } from '@/utils'

export interface Props {
  title?: string
  footer?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'drawer'
  maxHeight?: string
  maxWidth?: string
  minWidth?: string
  minHeight?: string
  width?: string
  height?: string
  cancel?: boolean
  submit?: boolean
  cancelText?: string
  submitText?: string
  submitType?: 'primary' | 'danger'
  maskClosable?: boolean
  class?: string
  container?: string
  destroyOnClose?: boolean
  toolbar?: {
    maximize?: boolean
    minimize?: boolean
    close?: boolean
  }
  onOk?: () => MaybePromise<boolean | void>
  onCancel?: () => MaybePromise<boolean | void>
  beforeClose?: (isOk: boolean) => MaybePromise<boolean | void>
  afterClose?: (isOk: boolean) => void
  afterDestroy?: () => void
}

export interface Slots {
  default?: () => any
  title?: () => any
  toolbar?: () => any
  action?: () => any
  cancel?: () => any
  submit?: () => any
}

const slots = defineSlots<Slots>()

const props = withDefaults(defineProps<Props>(), {
  size: undefined,
  title: '',
  footer: true,
  maxHeight: '90',
  maxWidth: '94',
  minWidth: '',
  minHeight: '',
  width: '',
  height: '',
  cancel: true,
  submit: true,
  cancelText: 'common.cancel',
  submitText: 'common.save',
  submitType: 'primary',
  maskClosable: false,
  class: undefined,
  container: 'body',
  destroyOnClose: true,
  toolbar: () => ({}),
  onOk: undefined,
  onCancel: undefined,
  beforeClose: undefined,
  afterClose: undefined,
  afterDestroy: undefined,
})

const draftGuards = new Set<() => Promise<boolean>>()
provide(draftGuardKey, (guard) => {
  draftGuards.add(guard)
  return () => {
    draftGuards.delete(guard)
  }
})
const canDiscard = async () => {
  for (const guard of draftGuards) if (!(await guard())) return false
  return true
}

const open = defineModel<boolean>('open', { default: false })

const hasOpened = ref(open.value)
const cancelLoading = ref(false)
const submitLoading = ref(false)
const dialogRef = useTemplateRef<HTMLElement>('dialogRef')
let previouslyFocused: HTMLElement | null = null

const modalZindex = ref()
const modalInstanceId = sampleID()
const appStore = useAppStore()
const [isMaximize, toggleMaximize] = useBool(false)
const isMinimize = ref(false)

watch(
  [open, isMaximize, isMinimize],
  ([isOpen, maximized, minimized]) => {
    const set = appStore.modalMaximized
    if (!set) return
    if (isOpen && maximized && !minimized) set.add(modalInstanceId)
    else set.delete(modalInstanceId)
  },
  { immediate: true },
)

interface CloseOptions {
  isOk: boolean
  runAction: boolean
  waitForAnimation: boolean
  destroy: boolean
  restoreOnFailure: boolean
}

interface CloseContext {
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
  options: CloseOptions
  minimizeRequested: boolean
}

type CloseState =
  | { phase: 'idle' }
  | { phase: 'running-hooks'; context: CloseContext }
  | { phase: 'leaving'; context: CloseContext; resolveLeave?: () => void }

let closeState: CloseState = { phase: 'idle' }

const restoreOpen = () => {
  if (!open.value) open.value = true
}

const finishLifecycle = (context: CloseContext) => {
  closeState = { phase: 'idle' }
  context.resolve()
}

const failLifecycle = (context: CloseContext, error: unknown) => {
  closeState = { phase: 'idle' }
  context.reject(error)
}

const minimizeNow = () => {
  if (!appStore.modalMinimized.includes(minimizeModal)) {
    appStore.modalMinimized.push(minimizeModal)
  }
  isMinimize.value = true
  open.value = false
}

const runCloseLifecycle = async (context: CloseContext) => {
  const { options } = context
  const loading = options.isOk ? submitLoading : cancelLoading
  const action = options.isOk ? props.onOk : props.onCancel

  loading.value = true
  try {
    const actionAccepted = !options.runAction || ((await action?.()) ?? true)
    const closeAccepted =
      actionAccepted &&
      (options.isOk || !draftGuards.size || (await canDiscard())) &&
      ((await props.beforeClose?.(options.isOk)) ?? true)
    if (!closeAccepted) {
      if (options.restoreOnFailure) restoreOpen()
      finishLifecycle(context)
      return
    }
  } catch (error) {
    if (options.restoreOnFailure) restoreOpen()
    failLifecycle(context, error)
    return
  } finally {
    loading.value = false
  }

  closeState = { phase: 'leaving', context }

  if (context.minimizeRequested) {
    minimizeNow()
  } else if (options.waitForAnimation) {
    const leave = new Promise<void>((resolve) => {
      if (closeState.phase === 'leaving') closeState.resolveLeave = resolve
    })
    open.value = false
    await leave
  } else {
    open.value = false
    await nextTick()
  }

  let hasFinalizationError = false
  let finalizationError: unknown
  const recordFinalizationError = (error: unknown) => {
    if (hasFinalizationError) return
    hasFinalizationError = true
    finalizationError = error
  }
  try {
    props.afterClose?.(options.isOk)
  } catch (error) {
    recordFinalizationError(error)
  }

  if (options.destroy) {
    isMinimize.value = false
    try {
      props.afterDestroy?.()
    } catch (error) {
      recordFinalizationError(error)
    } finally {
      removeMinimizedModal()
    }
  }

  if (hasFinalizationError) {
    failLifecycle(context, finalizationError)
  } else {
    finishLifecycle(context)
  }
}

const requestClose = (options: CloseOptions): Promise<void> => {
  if (closeState.phase !== 'idle') return closeState.context.promise

  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  const context: CloseContext = {
    promise,
    resolve,
    reject,
    options,
    minimizeRequested: false,
  }
  closeState = { phase: 'running-hooks', context }
  void runCloseLifecycle(context)
  return promise
}

const handleAction = (isOk: boolean, waitForAnimation = true, forceDestroy = false) =>
  requestClose({
    isOk,
    runAction: true,
    waitForAnimation: waitForAnimation && open.value && !isMinimize.value,
    destroy: forceDestroy || props.destroyOnClose,
    restoreOnFailure: open.value && !isMinimize.value,
  })

const onAfterLeave = () => {
  if (closeState.phase === 'leaving') closeState.resolveLeave?.()
}

const handleSubmit = () => handleAction(true, !isMinimize.value)
const handleCancel = () => handleAction(false, !isMinimize.value)
const handleDestroy = () => handleAction(false, !isMinimize.value, true)

const onMaskClick = () => (props.maskClosable ? handleCancel() : Promise.resolve())

const widths = { sm: 460, md: 680, lg: 920, xl: 1120, drawer: 560 }
const toLength = (value: string | number | undefined, unit: string) => {
  if (value === undefined || value === '') return ''
  const text = String(value).trim()
  return /^-?\d+(\.\d+)?$/.test(text) ? text + unit : text
}
// Modals without an explicit size still need a real width, because container queries
// (`container-type: inline-size`) zero out `max-content` intrinsic sizing.
const effectiveSize = computed(() => props.size ?? (props.width ? undefined : 'md'))
const toolbar = computed(() => ({
  minimize: false,
  maximize: true,
  close: true,
  ...props.toolbar,
}))
const contentStyle = computed(() => {
  if (isMaximize.value)
    return { width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%' }
  const drawer = effectiveSize.value === 'drawer'
  const limit = widths[effectiveSize.value ?? 'xl'] + 'px'
  const maxWidth = toLength(props.maxWidth, 'vw') || '94vw'
  const cap = `min(94vw, ${maxWidth}, ${limit})`
  return {
    maxWidth: drawer ? 'min(92vw, 560px)' : cap,
    width: drawer
      ? '92vw'
      : props.width
        ? toLength(props.width, '%')
        : effectiveSize.value
          ? limit
          : 'max-content',
    minWidth: drawer
      ? undefined
      : props.minWidth
        ? `min(${toLength(props.minWidth, 'vw')}, ${cap})`
        : effectiveSize.value
          ? undefined
          : `min(60vw, ${cap})`,
    height: drawer ? '100%' : props.height ? toLength(props.height, '%') : undefined,
    minHeight: props.minHeight ? toLength(props.minHeight, '%') : undefined,
    maxHeight: drawer ? '100%' : toLength(props.maxHeight, '%'),
  }
})

const shouldRender = computed(
  () => open.value || isMinimize.value || (!props.destroyOnClose && hasOpened.value),
)

const closeFn = () => {
  if (isMinimize.value) {
    return
  }
  if (isMaximize.value) {
    toggleMaximize()
    return
  }
  return handleCancel()
}

const getFocusableElements = () => {
  if (!dialogRef.value) return []
  return Array.from(
    dialogRef.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (el) =>
      !el.closest('[hidden], [aria-disabled="true"], [inert]') &&
      (el.offsetParent !== null ||
        getComputedStyle(el).position === 'fixed' ||
        el === document.activeElement),
  )
}

const handleDialogKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Tab') return
  const focusable = getFocusableElements()
  if (!focusable.length) {
    event.preventDefault()
    dialogRef.value?.focus()
    return
  }
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  const active = document.activeElement
  const outside = !active || !dialogRef.value?.contains(active)
  if (event.shiftKey) {
    if (active === dialogRef.value || active === first || outside) {
      event.preventDefault()
      last.focus()
    }
  } else if (active === last || outside) {
    event.preventDefault()
    first.focus()
  }
}

const restoreFocus = () => {
  if (
    previouslyFocused &&
    previouslyFocused.isConnected &&
    typeof previouslyFocused.focus === 'function'
  ) {
    previouslyFocused.focus()
  }
  previouslyFocused = null
}

const minimizeModal = markRaw({
  id: sampleID(),
  title: () => props.title,
  openFn: () => {
    if (closeState.phase !== 'idle') return
    open.value = true
    removeMinimizedModal()
  },
  minimizeFn: () => {
    handleMinimize()
  },
  closeFn: () => {
    return handleDestroy()
  },
})

const removeMinimizedModal = () => {
  const idx = appStore.modalMinimized.findIndex((m) => m === minimizeModal)
  if (idx !== -1) {
    appStore.modalMinimized.splice(idx, 1)
  }
}

const handleMinimize = () => {
  if (closeState.phase === 'running-hooks') {
    closeState.context.minimizeRequested = true
    return
  }
  if (closeState.phase === 'leaving') return
  minimizeNow()
}

watch(
  open,
  (v) => {
    if (v) {
      if (closeState.phase === 'leaving') {
        open.value = false
        return
      }
      if (closeState.phase === 'running-hooks') return
      removeMinimizedModal()
      if (props.toolbar.minimize) appStore.modalMinimizers.add(handleMinimize)
      previouslyFocused = document.activeElement as HTMLElement | null
      hasOpened.value = true
      isMinimize.value = false
      modalZindex.value = ++appStore.modalZIndexCounter
      if (!appStore.modalStack.includes(closeFn)) appStore.modalStack.push(closeFn)
      nextTick(() => {
        if (dialogRef.value && !dialogRef.value.contains(document.activeElement)) {
          dialogRef.value.focus()
        }
      })
    } else {
      if (closeState.phase === 'running-hooks') {
        restoreOpen()
        return
      }
      if (closeState.phase === 'idle' && isMinimize.value) {
        // Standalone minimize is not an action-close lifecycle.
      } else if (closeState.phase === 'idle' && !props.destroyOnClose) {
        handleMinimize()
      } else if (closeState.phase === 'idle') {
        restoreOpen()
        void requestClose({
          isOk: false,
          runAction: false,
          waitForAnimation: false,
          destroy: props.destroyOnClose,
          restoreOnFailure: true,
        }).catch((error) => console.error(error))
        return
      }
      appStore.modalMinimizers.delete(handleMinimize)
      const idx = appStore.modalStack.findIndex((fn) => fn === closeFn)
      if (idx !== -1) {
        appStore.modalStack.splice(idx, 1)
      }
      restoreFocus()
    }
  },
  { immediate: open.value },
)

onUnmounted(() => {
  appStore.modalMaximized?.delete(modalInstanceId)
  appStore.modalMinimizers.delete(handleMinimize)
  const idx = appStore.modalStack.findIndex((fn) => fn === closeFn)
  if (idx !== -1) {
    appStore.modalStack.splice(idx, 1)
  }
  removeMinimizedModal()
})

provide('cancel', handleCancel)
provide('submit', handleSubmit)
provide(IS_IN_MODAL, true)

defineExpose({ handleCancel, handleDestroy })
</script>

<template>
  <Teleport :to="container">
    <Transition name="modal" :duration="200" @after-leave="onAfterLeave">
      <div
        v-if="shouldRender"
        v-show="open && !isMinimize"
        :style="{ zIndex: modalZindex }"
        :class="{ 'is-drawer': effectiveSize === 'drawer' }"
        class="gui-modal-mask fixed inset-0 flex items-center justify-center backdrop-blur-sm"
        @click.self="onMaskClick"
      >
        <div
          ref="dialogRef"
          :style="contentStyle"
          :class="[props.class, { 'is-maximized': isMaximize }]"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          :aria-label="title ? $t(title) : undefined"
          class="gui-modal-modal transition-all duration-200 flex flex-col rounded-8 shadow outline-none"
          @keydown="handleDialogKeydown"
        >
          <div
            v-if="title || slots.title || slots.toolbar"
            class="gui-modal-header flex items-center gap-8 px-16 py-12"
            @dblclick.self="effectiveSize !== 'drawer' && toggleMaximize()"
          >
            <div class="min-w-0 flex-1">
              <slot name="title">
                <div v-if="title" class="font-bold text-16 line-clamp-1">{{ $t(title) }}</div>
              </slot>
            </div>
            <div class="ml-auto flex items-center gap-4 shrink-0">
              <slot name="toolbar"></slot>
              <Button
                v-if="toolbar.minimize"
                :aria-label="$t('common.minimize')"
                icon="minimize2"
                type="text"
                size="small"
                @click="handleMinimize"
              />
              <Button
                v-if="toolbar.maximize && effectiveSize !== 'drawer'"
                :aria-label="$t('common.resize')"
                :icon="isMaximize ? 'maximize2' : 'maximize'"
                type="text"
                size="small"
                @click="toggleMaximize"
              />
              <Button
                v-if="toolbar.close !== false"
                icon="close"
                type="text"
                size="small"
                :aria-label="$t('common.close')"
                :loading="cancelLoading"
                @click="handleCancel"
              />
            </div>
          </div>
          <div class="gui-modal-content flex-1 overflow-auto px-16 py-12">
            <slot></slot>
          </div>
          <div
            v-if="footer"
            class="gui-modal-footer flex items-center justify-end py-12 px-16 gap-8"
          >
            <slot name="action"></slot>
            <slot name="cancel">
              <Button v-if="cancel" :loading="cancelLoading" type="normal" @click="handleCancel">
                {{ $t(cancelText) }}
              </Button>
            </slot>
            <slot name="submit">
              <Button
                v-if="submit"
                :loading="submitLoading"
                :type="submitType"
                @click="handleSubmit"
              >
                {{ $t(submitText) }}
              </Button>
            </slot>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="less" scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.18s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-active .gui-modal-modal,
.modal-leave-active .gui-modal-modal {
  transition:
    transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.18s ease;
}

.modal-enter-from .gui-modal-modal,
.modal-leave-to .gui-modal-modal {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}

.gui-modal-mask {
  background-color: var(--modal-mask-bg);

  .gui-modal-modal {
    background-color: var(--surface-elevated-bg, var(--modal-bg));
    border: 1px solid var(--surface-border, var(--border-color));
    border-radius: var(--modal-radius, 14px);
    box-shadow: var(--modal-shadow);
    backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
    -webkit-backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
    overflow: hidden;

    &.is-maximized {
      border-radius: 0;
      border: 0;
    }
  }
}

.gui-modal-header {
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.gui-modal-content {
  min-height: 0;
}

.gui-modal-footer {
  flex-wrap: wrap;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

.gui-modal-mask.is-drawer {
  justify-content: flex-end;
}
.is-drawer .gui-modal-modal {
  border-radius: 0;
}
.modal-enter-from.is-drawer .gui-modal-modal,
.modal-leave-to.is-drawer .gui-modal-modal {
  transform: translateX(100%);
}
@media (max-width: 640px) {
  .gui-modal-mask:not(.is-drawer) .gui-modal-modal:not(.is-maximized) {
    width: 94vw !important;
  }
  .gui-modal-footer > :deep(.gui-button) {
    flex: 1 0 40%;
  }
}
</style>
