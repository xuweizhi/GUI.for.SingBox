<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useAppSettingsStore, useAppStore, usePluginsStore } from '@/stores'
import { debounce, message } from '@/utils'
import { getCommands } from '@/utils/command'

import Input from '@/components/Input/index.vue'

const loading = ref(false)
const showCommandPanel = ref(false)
const userInput = ref('')
const selected = ref(0)
const inputRef = useTemplateRef<typeof Input>('inputRef')
const commands = ref(getCommands())
const commandsRefMap: Record<string, HTMLElement | null> = {}

const hitCommand = computed(() => {
  const query = userInput.value.trim().toLocaleLowerCase()
  if (!query) return commands.value
  return commands.value.filter(
    (v) =>
      v.cmd.toLocaleLowerCase().includes(query) ||
      v.label.toLocaleLowerCase().includes(query) ||
      (v.desc || '').toLocaleLowerCase().includes(query),
  )
})

const { t } = useI18n()
const appStore = useAppStore()
const appSettings = useAppSettingsStore()
const pluginsStore = usePluginsStore()

const openPanel = () => {
  showCommandPanel.value = true
  selected.value = 0
  nextTick(() => inputRef.value?.focus())
}

const closePanel = () => {
  if (loading.value) return
  showCommandPanel.value = false
  userInput.value = ''
}

const handleExecCommand = async (index: number) => {
  const target = hitCommand.value[index]
  if (!target) return
  loading.value = true
  try {
    await target.handler?.()
    userInput.value = ''
    showCommandPanel.value = false
  } catch (error: any) {
    message.error(error?.message || error)
  }
  loading.value = false
  if (showCommandPanel.value) {
    nextTick(() => inputRef.value?.focus())
  }
}

const onKeydown = async (ev: KeyboardEvent) => {
  const isCommandShortcut =
    ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyK') ||
    ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.code === 'KeyP')

  if (isCommandShortcut) {
    ev.preventDefault()
    if (showCommandPanel.value) {
      closePanel()
    } else {
      openPanel()
    }
    return
  }

  if (!showCommandPanel.value || loading.value) return

  if (ev.code === 'Escape') {
    ev.preventDefault()
    ev.stopPropagation()
    if (userInput.value) {
      userInput.value = ''
      return
    }
    closePanel()
    return
  }
  if (ev.code === 'ArrowUp') {
    ev.preventDefault()
    if (!hitCommand.value.length) return
    selected.value = selected.value <= 0 ? hitCommand.value.length - 1 : selected.value - 1
    const target = hitCommand.value[selected.value]
    target && commandsRefMap[target.label]?.scrollIntoView({ block: 'nearest' })
    return
  }
  if (ev.code === 'ArrowDown') {
    ev.preventDefault()
    if (!hitCommand.value.length) return
    selected.value = selected.value + 1 >= hitCommand.value.length ? 0 : selected.value + 1
    const target = hitCommand.value[selected.value]
    target && commandsRefMap[target.label]?.scrollIntoView({ block: 'nearest' })
    return
  }
  if (ev.code === 'Enter') {
    ev.preventDefault()
    if (hitCommand.value.length) {
      await handleExecCommand(selected.value)
    } else {
      nextTick(() => inputRef.value?.focus())
    }
  }
}

watch(hitCommand, () => (selected.value = 0))

const updateCommands = debounce(() => {
  commands.value = getCommands()
}, 200)

watch([() => appSettings.app.lang, pluginsStore.plugins, () => appStore.locales], updateCommands)

const onOpenCommandPalette = () => openPanel()

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('open-command-palette', onOpenCommandPalette)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('open-command-palette', onOpenCommandPalette)
})
</script>

<template>
  <Transition name="cmd-fade">
    <div
      v-show="showCommandPanel"
      class="command-mask fixed inset-0 z-9999 flex justify-center items-start backdrop-blur-sm"
      @click.self="closePanel"
    >
      <div
        role="dialog"
        aria-modal="true"
        :aria-label="t('common.commandPalette')"
        class="command-panel rounded-12 overflow-hidden flex flex-col"
      >
        <div class="command-panel__header p-10">
          <Input
            ref="inputRef"
            v-model="userInput"
            :disabled="loading"
            :placeholder="t('common.search')"
            autofocus
            clearable
            class="w-full"
          >
            <template #prefix>
              <Icon icon="search" :size="15" color="var(--muted-color)" />
            </template>
            <template #suffix>
              <Icon v-show="loading" icon="loading" class="rotation" />
            </template>
          </Input>
        </div>
        <div class="overflow-y-auto p-8 flex flex-col gap-6" style="max-height: calc(100dvh - 180px)">
          <div
            v-for="(c, index) in hitCommand"
            :key="c.label"
            :ref="(el: any) => (commandsRefMap[c.label] = el)"
            :class="{ 'is-selected': index === selected }"
            class="command-item rounded-8 px-12 py-8 cursor-pointer"
            @mouseenter="selected = index"
            @click="handleExecCommand(index)"
          >
            <div class="flex items-center justify-between gap-8">
              <span class="font-bold text-13">{{ c.label }}</span>
              <span class="text-12 text-muted font-mono">{{ c.cmd }}</span>
            </div>
            <div v-if="c.desc" class="text-12 text-muted mt-2">{{ c.desc }}</div>
          </div>
          <div v-show="hitCommand.length === 0" class="p-16 text-center text-13 text-muted">
            {{ t('commands.noMatching') }}
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style lang="less" scoped>
.command-mask {
  background: var(--modal-mask-bg);
  padding: 56px 12px 16px;
}

.command-panel {
  width: min(580px, 100%);
  background: var(--modal-bg);
  border: 1px solid var(--border-color);
  box-shadow: 0 20px 48px rgba(15, 23, 42, 0.24);
}

.command-panel__header {
  border-bottom: 1px solid var(--border-color);
}

.command-item {
  border: 1px solid transparent;
  transition:
    background-color 0.12s ease,
    border-color 0.12s ease;

  &:hover,
  &.is-selected {
    background: var(--accent-soft);
    border-color: color-mix(in srgb, var(--accent-text) 45%, transparent);
  }
}

.cmd-fade-enter-active,
.cmd-fade-leave-active {
  transition: opacity 0.15s ease;
}

.cmd-fade-enter-from,
.cmd-fade-leave-to {
  opacity: 0;
}
</style>
