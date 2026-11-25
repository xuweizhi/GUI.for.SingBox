import type { Directive, DirectiveBinding } from 'vue'

import { useAppStore } from '@/stores'

const updateMenus = (el: any, binding: DirectiveBinding) => {
  const appStore = useAppStore()

  el.oncontextmenu = (e: MouseEvent) => {
    e.preventDefault()
    if (binding.value.length) {
      appStore.menuPosition = { x: e.clientX, y: e.clientY }
      appStore.menuList = binding.value
      appStore.menuShow = true
    }
  }
}

export default {
  mounted(el: any, binding: DirectiveBinding) {
    updateMenus(el, binding)
  },
  updated(el: any, binding: DirectiveBinding) {
    updateMenus(el, binding)
  },
} as Directive
