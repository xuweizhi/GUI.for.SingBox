import type { Directive, DirectiveBinding } from 'vue'

import { useAppStore } from '@/stores'

const updateMenus = (el: any, binding: DirectiveBinding) => {
  const appStore = useAppStore()
  const items = Array.isArray(binding.value) ? binding.value : []

  if (!items.length) {
    el.oncontextmenu = null
    return
  }

  el.oncontextmenu = (e: MouseEvent) => {
    e.preventDefault()
    appStore.menuPosition = { x: e.clientX, y: e.clientY }
    appStore.menuList = items
    appStore.menuShow = true
  }
}

export default {
  mounted(el: any, binding: DirectiveBinding) {
    updateMenus(el, binding)
  },
  updated(el: any, binding: DirectiveBinding) {
    updateMenus(el, binding)
  },
  beforeUnmount(el: any) {
    el.oncontextmenu = null
  },
} as Directive
