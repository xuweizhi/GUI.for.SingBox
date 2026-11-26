<script setup lang="ts">
import { useAppStore } from '@/stores'
const props = defineProps<{ items: App.Menu[]; name: string }>()
const app = useAppStore()
let openedPosition: typeof app.menuPosition | undefined
const open = (event: MouseEvent) => {
  const trigger = event.currentTarget as HTMLElement
  if (app.menuShow && openedPosition === app.menuPosition) {
    app.menuShow = false
    return
  }
  const rect = trigger.getBoundingClientRect()
  app.menuPosition = { x: rect.right, y: rect.bottom + 4, align: 'end' }
  app.menuList = props.items
  app.menuShow = true
  openedPosition = app.menuPosition
}
</script>
<template>
  <Button
    type="text"
    size="small"
    icon="more"
    aria-haspopup="menu"
    :aria-label="$t('common.more') + ' · ' + name"
    @click.stop="open"
  />
</template>
