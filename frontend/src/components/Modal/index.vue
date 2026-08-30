<script lang="ts">
export const IS_IN_MODAL = 'IS_IN_MODAL'
</script>

<script setup lang="ts">
import { computed, markRaw, nextTick, provide, ref, watch } from 'vue'

import { useBool } from '@/hooks'
import { useAppStore } from '@/stores'
import { message, sampleID } from '@/utils'

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
  maxHeight: props.maxHeight + '%',
  maxWidth: props.maxWidth + '%',
  minWidth: isMaximize.value ? '100%' : props.minWidth ? props.minWidth + '%' : '0',
  minHeight: isMaximize.value ? '100%' : props.minHeight ? props.minHeight + '%' : '0',
  width: props.width + '%',
  height: props.height + '%',
}))

const shouldRender = computed(
  () => open.value || isMinimize.value || (!props.destroyOnClose && hasOpened.value),
)

let lastEscTime = 0
let closeMessage: () => void

const closeFn = () => {
  if (isMinimize.value) {
    return
  }
  if (isMaximize.value) {
    toggleMaximize()
    return
  }
  if (props.maskClosable) {
    return handleCancel()
  }
  const now = performance.now()
  if (now - lastEscTime < 1000) {
    lastEscTime = 0
    closeMessage?.()
    return handleCancel()
  } else {
    const { destroy } = message.info('common.pressAgainToClose', 1_000)
    closeMessage = destroy
    lastEscTime = now
  }
  return Promise.resolve()
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
    hasOpened.value = true
    isMinimize.value = false
    modalZindex.value = ++appStore.modalZIndexCounter
    appStore.modalStack.push(closeFn)
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
    closeMessage?.()
    const idx = appStore.modalStack.findIndex((fn) => fn === closeFn)
    if (idx !== -1) {
      appStore.modalStack.splice(idx, 1)
    }
  }
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
          :style="contentStyle"
          :class="props.class"
          class="gui-modal-modal transition duration-200 flex flex-col rounded-8 shadow"
        >
          <div
            v-if="title || slots.title || slots.toolbar"
            class="flex items-center p-16"
            @dblclick.self="toggleMaximize"
          >
            <slot name="title">
              <div v-if="title" class="font-bold">{{ $t(title) }}</div>
            </slot>
            <div class="ml-auto">
              <slot name="toolbar"></slot>
              <Button
                v-if="toolbar.minimize"
                icon="minimize2"
                type="text"
                @click="handleMinimize"
              />
              <Button v-if="toolbar.maximize" type="text" @click="toggleMaximize">
                <Icon
                  :class="{ maximize: isMaximize }"
                  icon="arrowDown"
                  class="maximize-normal origin-center duration-200"
                />
              </Button>
            </div>
          </div>
          <div class="flex-1 overflow-auto mx-16">
            <slot></slot>
          </div>
          <div v-if="footer" class="flex items-center justify-end py-8 px-16 gap-8">
            <slot name="action"></slot>
            <slot name="cancel">
              <Button
                v-if="cancel"
                :loading="cancelLoading"
                :type="maskClosable ? 'text' : 'normal'"
                @click="handleCancel"
              >
                {{ $t(cancelText) }}
              </Button>
            </slot>
            <slot name="submit">
              <Button v-if="submit" :loading="submitLoading" type="primary" @click="handleSubmit">
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
.modal-enter-active .gui-modal-modal,
.modal-leave-active .gui-modal-modal {
  transition:
    transform 0.2s ease-in-out,
    opacity 0.2s ease-in-out;
}

.modal-enter-from .gui-modal-modal,
.modal-leave-to .gui-modal-modal {
  opacity: 0;
  transform: scale(0);
}

.gui-modal-mask {
  background-color: var(--modal-mask-bg);

  .gui-modal-modal {
    background-color: var(--modal-bg);
  }
}
.maximize-normal {
  transform: rotate(-180deg);
}
.maximize {
  transform: rotate(0deg);
}
</style>
