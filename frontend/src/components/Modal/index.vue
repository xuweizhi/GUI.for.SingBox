<script lang="ts">
export const IS_IN_MODAL = 'IS_IN_MODAL'
</script>

<script setup lang="ts">
import { computed, markRaw, nextTick, onUnmounted, provide, ref, useTemplateRef, watch } from 'vue'

import { useBool } from '@/hooks'
import { useAppStore } from '@/stores'
import { sampleID } from '@/utils'

export interface Props {
  title?: string
  footer?: boolean
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
  title: '',
  footer: true,
  maxHeight: '90',
  maxWidth: '90',
  minWidth: '60',
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
  toolbar: () => ({
    maximize: true,
    minimize: true,
  }),
  onOk: undefined,
  onCancel: undefined,
  beforeClose: undefined,
  afterClose: undefined,
  afterDestroy: undefined,
})

const open = defineModel<boolean>('open', { default: false })

const hasOpened = ref(open.value)
const cancelLoading = ref(false)
const submitLoading = ref(false)
const dialogRef = useTemplateRef<HTMLElement>('dialogRef')
let previouslyFocused: HTMLElement | null = null

const modalZindex = ref()
const appStore = useAppStore()
const [isMaximize, toggleMaximize] = useBool(false)
const isMinimize = ref(false)

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
    const closeAccepted = actionAccepted && ((await props.beforeClose?.(options.isOk)) ?? true)
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
    waitForAnimation,
    destroy: forceDestroy || props.destroyOnClose,
    restoreOnFailure: !isMinimize.value,
  })

const onAfterLeave = () => {
  if (closeState.phase === 'leaving') closeState.resolveLeave?.()
}

const handleSubmit = () => handleAction(true, !isMinimize.value)
const handleCancel = () => handleAction(false, !isMinimize.value)
const handleDestroy = () => handleAction(false, !isMinimize.value, true)

const onMaskClick = () => (props.maskClosable ? handleCancel() : Promise.resolve())

const contentStyle = computed(() => ({
  maxHeight: isMaximize.value ? '100%' : props.maxHeight + '%',
  maxWidth: isMaximize.value ? '100%' : props.maxWidth + '%',
  minWidth: isMaximize.value ? '100%' : props.minWidth ? props.minWidth + '%' : '0',
  minHeight: isMaximize.value ? '100%' : props.minHeight ? props.minHeight + '%' : '0',
  width: isMaximize.value ? '100%' : props.width ? props.width + '%' : undefined,
  height: isMaximize.value ? '100%' : props.height ? props.height + '%' : undefined,
}))

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
  ).filter((el) => el.offsetParent !== null || el === document.activeElement)
}

const handleDialogKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Tab') return
  const focusable = getFocusableElements()
  if (!focusable.length) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  if (event.shiftKey) {
    if (document.activeElement === first || !dialogRef.value?.contains(document.activeElement)) {
      event.preventDefault()
      last.focus()
    }
  } else if (document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

const restoreFocus = () => {
  if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
    previouslyFocused.focus()
  }
  previouslyFocused = null
}

const minimizeModal = markRaw({
  id: sampleID(),
  title: () => props.title,
  openFn: () => {
    if (closeState.phase !== 'idle') return
    modalZindex.value = ++appStore.modalZIndexCounter
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

watch(open, (v) => {
  if (v) {
    if (closeState.phase === 'leaving') {
      open.value = false
      return
    }
    if (closeState.phase === 'running-hooks') return
    previouslyFocused = document.activeElement as HTMLElement | null
    hasOpened.value = true
    isMinimize.value = false
    modalZindex.value = ++appStore.modalZIndexCounter
    appStore.modalStack.push(closeFn)
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
    const idx = appStore.modalStack.findIndex((fn) => fn === closeFn)
    if (idx !== -1) {
      appStore.modalStack.splice(idx, 1)
    }
    restoreFocus()
  }
})

onUnmounted(() => {
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
          class="gui-modal-modal transition duration-200 flex flex-col rounded-8 shadow outline-none"
          @keydown="handleDialogKeydown"
        >
          <div
            v-if="title || slots.title || slots.toolbar"
            class="gui-modal-header flex items-center gap-8 px-16 py-12"
            @dblclick.self="toggleMaximize"
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
                v-if="toolbar.maximize"
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
              <Button
                v-if="cancel"
                :loading="cancelLoading"
                type="normal"
                @click="handleCancel"
              >
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
    background-color: var(--modal-bg);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    box-shadow: 0 20px 48px rgba(15, 23, 42, 0.24);
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
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

@media (max-width: 700px) {
  .gui-modal-mask .gui-modal-modal:not(.is-maximized) {
    max-width: calc(100% - 24px) !important;
    min-width: calc(100% - 24px) !important;
  }
}
</style>
