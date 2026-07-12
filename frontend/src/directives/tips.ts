import { type Directive, type DirectiveBinding } from 'vue'

import { useAppStore } from '@/stores'
import { debounce } from '@/utils'

let activeTipsElement: HTMLElement | undefined

export default {
  mounted(el: HTMLElement, binding: DirectiveBinding) {
    const appStore = useAppStore()

    const delay = binding.modifiers.fast ? 200 : 500
    el.dataset.tipsMessage = binding.value || ''

    const show = debounce((x: number, y: number) => {
      const tipsMessage = el.dataset.tipsMessage
      if (activeTipsElement === el && el.dataset.showTips === 'true' && tipsMessage) {
        appStore.tipsPosition = { x, y }
        appStore.tipsMessage = tipsMessage
        appStore.tipsShow = true
      }
    }, delay)

    const activate = (x: number, y: number) => {
      if (!el.dataset.tipsMessage) return
      if (activeTipsElement && activeTipsElement !== el) {
        activeTipsElement.dataset.showTips = 'false'
      }
      activeTipsElement = el
      el.dataset.showTips = 'true'
      show(x, y)
    }

    el.onmouseenter = (e: MouseEvent) => {
      activate(e.clientX, e.clientY)
    }

    const hide = () => {
      el.dataset.showTips = 'false'
      if (activeTipsElement === el) {
        appStore.tipsShow = false
        activeTipsElement = undefined
      }
    }

    el.onmouseleave = hide
    el.onfocus = () => {
      if (el.dataset.tipsMessage) {
        const rect = el.getBoundingClientRect()
        activate(rect.left + rect.width / 2, rect.top + rect.height / 2)
      }
    }
    el.onblur = hide
  },
  updated(el: HTMLElement, binding: DirectiveBinding) {
    el.dataset.tipsMessage = binding.value || ''
    if (!binding.value) {
      el.dataset.showTips = 'false'
      if (activeTipsElement === el) {
        useAppStore().tipsShow = false
        activeTipsElement = undefined
      }
    }
  },
  beforeUnmount(el: HTMLElement) {
    el.dataset.showTips = 'false'
    if (activeTipsElement === el) {
      useAppStore().tipsShow = false
      activeTipsElement = undefined
    }
  },
} as Directive
