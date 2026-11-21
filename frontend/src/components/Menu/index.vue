<script lang="ts" setup>
import { onMounted, onUnmounted, ref, watch, nextTick, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

interface Props {
  position: { x: number; y: number }
  menuList: App.Menu[]
}

const model = defineModel<boolean>({ default: false })
const props = defineProps<Props>()

const secondaryMenu = ref<App.Menu[] | undefined>()
const secondaryAnchorTop = ref(0)

const menuRef = useTemplateRef('menuRef')
const secondaryMenuRef = useTemplateRef('secondaryMenuRef')

const menuPosition = ref({ left: '', top: '' })
const secondaryMenuPosition = ref({ left: '', top: '' })

const { t } = useI18n()

const closeMenu = () => {
  model.value = false
  secondaryMenu.value = undefined
}

const handleClick = (fn: App.Menu) => {
  fn.handler?.()
  closeMenu()
}

const handleItemHover = (menu: App.Menu, event: MouseEvent) => {
  secondaryMenu.value = menu.children
  if (menu.children && event.currentTarget instanceof HTMLElement) {
    secondaryAnchorTop.value = event.currentTarget.getBoundingClientRect().top
  }
}

const fixMenuPos = (x: number, y: number) => {
  let left = x
  let top = y

  const clientWidth = window.innerWidth
  const clientHeight = window.innerHeight
  const menuWidth = menuRef.value?.offsetWidth || 0
  const menuHeight = menuRef.value?.offsetHeight || 0

  if (x + menuWidth > clientWidth - 8) left = Math.max(8, clientWidth - menuWidth - 8)
  if (y + menuHeight > clientHeight - 8) top = Math.max(8, clientHeight - menuHeight - 8)

  menuPosition.value = { left: left + 'px', top: top + 'px' }
}

const fixSecondaryMenuPos = () => {
  if (!secondaryMenu.value || !menuRef.value || !secondaryMenuRef.value) return
  const menuRect = menuRef.value.getBoundingClientRect()
  const sMenuWidth = secondaryMenuRef.value.offsetWidth
  const sMenuHeight = secondaryMenuRef.value.offsetHeight
  const clientWidth = window.innerWidth
  const clientHeight = window.innerHeight

  let left = menuRect.right + 4
  if (left + sMenuWidth > clientWidth - 8) {
    left = Math.max(8, menuRect.left - sMenuWidth - 4)
  }

  let top = secondaryAnchorTop.value || menuRect.top
  if (top + sMenuHeight > clientHeight - 8) {
    top = Math.max(8, clientHeight - sMenuHeight - 8)
  }

  secondaryMenuPosition.value = { left: left + 'px', top: top + 'px' }
}

watch(
  () => props.position,
  ({ x, y }) => {
    nextTick(() => fixMenuPos(x, y))
    secondaryMenu.value = undefined
  },
)

watch([() => secondaryMenu.value, () => props.position], () => {
  nextTick(fixSecondaryMenuPos)
})

const onClick = () => {
  closeMenu()
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && model.value) {
    e.stopPropagation()
    closeMenu()
  }
}

onMounted(() => {
  document.addEventListener('click', onClick)
  document.addEventListener('keydown', onKeydown, true)
})
onUnmounted(() => {
  document.removeEventListener('click', onClick)
  document.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <Transition name="menu">
    <div
      v-show="model"
      ref="menuRef"
      role="menu"
      :style="menuPosition"
      class="gui-menu fixed z-9999 p-6 rounded-8 flex flex-col gap-2 backdrop-blur-sm"
    >
      <template v-for="menu in menuList">
        <Divider v-if="menu.separator" :key="menu.label + '_divider'" size="small">
          {{ menu.label ? t(menu.label) : '' }}
        </Divider>
        <Button
          v-else
          :key="menu.label"
          role="menuitem"
          type="text"
          size="small"
          class="justify-between"
          @click="handleClick(menu)"
          @mouseenter="handleItemHover(menu, $event)"
        >
          <div class="text-nowrap">
            {{ t(menu.label) }}
          </div>
          <Icon v-if="menu.children" icon="arrowRight" :size="14" class="ml-8" />
        </Button>
      </template>
      <Transition name="menu">
        <div
          v-show="secondaryMenu"
          ref="secondaryMenuRef"
          role="menu"
          :style="secondaryMenuPosition"
          class="gui-menu fixed z-9999 p-6 rounded-8 flex flex-col gap-2 backdrop-blur-sm"
        >
          <template v-for="m in secondaryMenu">
            <Divider v-if="m.separator" :key="m.label + '_divider'" size="small">
              {{ m.label ? t(m.label) : '' }}
            </Divider>
            <Button
              v-else
              :key="m.label"
              role="menuitem"
              type="text"
              size="small"
              class="justify-start"
              @click.stop="handleClick(m)"
            >
              <div class="text-nowrap">{{ t(m.label) }}</div>
            </Button>
          </template>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style lang="less" scoped>
.menu-enter-active,
.menu-leave-active {
  transition:
    transform 0.16s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.16s ease;
  transform-origin: top;
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: scaleY(0.92);
}

.gui-menu {
  background: var(--menu-bg);
  border: 1px solid var(--border-color);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
  min-width: 120px;
}
</style>
