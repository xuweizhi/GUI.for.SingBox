<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { hasActiveOverlay } from '@/hooks/useOverlayFocus'
import { useAppSettingsStore, useAppStore, usePluginsStore } from '@/stores'
import { debounce, message } from '@/utils'
import { getCommands } from '@/utils/command'

import Input from '@/components/Input/index.vue'

const loading = ref(false)
const showCommandPanel = ref(false)
const userInput = ref('')
const selected = ref(0)
const inputRef = useTemplateRef<typeof Input>('inputRef')
const panelRef = useTemplateRef<HTMLElement>('panelRef')
const commands = ref(getCommands())
const commandEls = new Map<number, HTMLElement>()
let previouslyFocused: HTMLElement | null = null

const setCommandEl = (index: number, el: unknown) => {
  if (el instanceof HTMLElement) commandEls.set(index, el)
  else commandEls.delete(index)
}

const hitCommand = computed(() => {
  const query = userInput.value.trim().toLocaleLowerCase()
  if (!query) return commands.value
  const tokens = query.split(/\s+/).filter(Boolean)
  return commands.value.filter((v) => {
    const haystack = `${v.label} ${v.cmd} ${v.desc || ''}`.toLocaleLowerCase()
    return tokens.every((token) => haystack.includes(token))
  })
})

const { t } = useI18n()
const appStore = useAppStore()
const appSettings = useAppSettingsStore()
const pluginsStore = usePluginsStore()

const openPanel = () => {
  if (hasActiveOverlay() || appStore.modalStack.length > 0) return
  previouslyFocused = document.activeElement as HTMLElement | null
  showCommandPanel.value = true
  selected.value = 0
  nextTick(() => inputRef.value?.focus())
}

const closePanel = () => {
  if (loading.value) return
  showCommandPanel.value = false
  userInput.value = ''
  if (previouslyFocused?.isConnected && typeof previouslyFocused.focus === 'function') {
    previouslyFocused.focus()
  }
  previouslyFocused = null
}

const handleExecCommand = async (index: number) => {
  if (loading.value) return
  const target = hitCommand.value[index]
  if (!target) return
  loading.value = true
  try {
    await target.handler?.()
    userInput.value = ''
    showCommandPanel.value = false
    previouslyFocused = null
  } catch (error: any) {
    message.error(error?.message || error)
  } finally {
    loading.value = false
  }
  if (showCommandPanel.value) {
    nextTick(() => inputRef.value?.focus())
  }
}

const onKeydown = async (ev: KeyboardEvent) => {
  if (hasActiveOverlay() || ev.isComposing) return
  const isCommandShortcut =
    !ev.altKey &&
    (((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyK') ||
      ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.code === 'KeyP'))

  if (isCommandShortcut) {
    if (!showCommandPanel.value && appStore.modalStack.length > 0) return
    ev.preventDefault()
    if (showCommandPanel.value) {
      closePanel()
    } else {
      openPanel()
    }
    return
  }

  if (!showCommandPanel.value) return

  if (ev.key === 'Escape' || ev.code === 'Escape') {
    ev.preventDefault()
    ev.stopImmediatePropagation()
    closePanel()
    return
  }
  if (ev.key === 'Tab') {
    ev.preventDefault()
    inputRef.value?.focus()
    return
  }
  if (loading.value) return
  if (ev.key === 'ArrowUp') {
    ev.preventDefault()
    if (!hitCommand.value.length) return
    selected.value = selected.value <= 0 ? hitCommand.value.length - 1 : selected.value - 1
    commandEls.get(selected.value)?.scrollIntoView({ block: 'nearest' })
    return
  }
  if (ev.key === 'ArrowDown') {
    ev.preventDefault()
    if (!hitCommand.value.length) return
    selected.value = selected.value + 1 >= hitCommand.value.length ? 0 : selected.value + 1
    commandEls.get(selected.value)?.scrollIntoView({ block: 'nearest' })
    return
  }
  if (ev.key === 'Enter') {
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

watch(
  [
    () => appSettings.app.lang,
    () => appSettings.app.customFontPresets,
    () => pluginsStore.plugins,
    () => appStore.locales,
  ],
  updateCommands,
  { deep: true },
)

const onOpenCommandPalette = () => openPanel()

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('open-command-palette', onOpenCommandPalette)
})
onUnmounted(() => {
  updateCommands.cancel()
  commandEls.clear()
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('open-command-palette', onOpenCommandPalette)
})
</script>

<template>
  <Transition name="cmd-fade">
    <div
      v-if="showCommandPanel"
      class="command-mask fixed inset-0 flex justify-center items-start backdrop-blur-sm"
      @click.self="closePanel"
    >
      <div
        ref="panelRef"
        role="dialog"
        aria-modal="true"
        :aria-label="t('common.commandPalette')"
        class="command-panel overflow-hidden flex flex-col"
      >
        <div class="command-panel__header p-10 shrink-0">
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
        <div role="listbox" class="command-list flex-1 min-h-0 overflow-y-auto p-8 flex flex-col gap-6">
          <div
            v-for="(c, index) in hitCommand"
            :key="`${c.cmd}-${index}`"
            :ref="(el) => setCommandEl(index, el)"
            role="option"
            :aria-selected="index === selected"
            :class="{ 'is-selected': index === selected }"
            class="command-item rounded-8 px-12 py-8 cursor-pointer"
            @mousemove="selected !== index && (selected = index)"
            @click="handleExecCommand(index)"
          >
            <div class="flex items-center justify-between gap-8 min-w-0">
              <span class="font-bold text-13 line-clamp-1 min-w-0">{{ c.label }}</span>
              <span class="command-item__cmd text-12 text-muted font-mono shrink-0">{{
                c.cmd
              }}</span>
            </div>
            <div v-if="c.desc" class="text-12 text-muted mt-2">{{ c.desc }}</div>
          </div>
          <div v-show="hitCommand.length === 0" class="p-16 text-center text-13 text-muted">
            {{ t('commands.noMatching') }}
          </div>
        </div>
        <div
          class="command-panel__footer px-12 py-8 text-12 text-muted flex items-center justify-between shrink-0"
        >
          <span>{{ t('common.commandHints') }}</span>
          <span class="font-mono">{{ hitCommand.length }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style lang="less" scoped>
.command-mask {
  z-index: var(--z-command, 9500);
  background: var(--modal-mask-bg);
  padding: 56px 12px 16px;
}

.command-panel {
  width: min(580px, 100%);
  max-height: calc(100dvh - 80px);
  background: var(--surface-elevated-bg, var(--modal-bg));
  border: 1px solid var(--surface-border, var(--border-color));
  border-radius: var(--modal-radius, 14px);
  box-shadow: var(--modal-shadow);
  backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
  -webkit-backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
}

.command-panel__header {
  border-bottom: 1px solid var(--surface-border, var(--border-color));
}

.command-panel__footer {
  border-top: 1px solid var(--surface-border, var(--border-color));
  background: var(--surface-active-bg, var(--bg-color));
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

.command-item__cmd {
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
