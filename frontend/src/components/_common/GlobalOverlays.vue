<script setup lang="ts">
import { computed } from 'vue'

import * as Stores from '@/stores'
import { message } from '@/utils'

import { CommandView } from '@/components'

interface Props {
  loading: boolean
  authenticated?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  authenticated: true,
})

const appStore = Stores.useAppStore()
const kernelApiStore = Stores.useKernelApiStore()

const hasMaximizedModal = computed(() => (appStore.modalMaximized?.size ?? 0) > 0)

const handleRestartCore = async () => {
  try {
    await kernelApiStore.restartCore()
  } catch (error: unknown) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}

const openAll = () => {
  appStore.modalMinimized.slice().forEach((m) => m.openFn())
}

const minimizeAll = () => {
  Array.from(appStore.modalMinimizers)
    .reverse()
    .forEach((minimize) => minimize())
}

const handleCloseMinimized = async (
  modalItem: (typeof appStore.modalMinimized)[number],
  closeDropdown: () => void,
) => {
  try {
    await modalItem.closeFn()
    if (!appStore.modalMinimized.length) closeDropdown()
  } catch (error: unknown) {
    message.error(error instanceof Error ? error.message : String(error))
  }
}
</script>

<template>
  <Menu
    v-model="appStore.menuShow"
    :position="appStore.menuPosition"
    :menu-list="appStore.menuList"
  />

  <Tips
    v-model="appStore.tipsShow"
    :position="appStore.tipsPosition"
    :message="appStore.tipsMessage"
  />

  <CommandView v-if="!props.loading && props.authenticated" />

  <div
    v-if="
      props.authenticated &&
      !hasMaximizedModal &&
      (appStore.modalMinimizers.size ||
        appStore.modalMinimized.length ||
        kernelApiStore.needRestart ||
        kernelApiStore.restarting)
    "
    class="global-dock fixed right-32 bottom-32 flex flex-col items-end gap-8"
  >
    <Dropdown
      v-if="appStore.modalMinimizers.size || appStore.modalMinimized.length"
      placement="top"
      align="end"
      :trigger="['click']"
    >
      <div class="modal-dock-trigger">
        <Button
          icon="adjust"
          :aria-label="$t('common.modalList')"
          class="shadow"
          :title="
            appStore.modalMinimized.map((m) => $t(m.title() || 'common.modalList')).join(', ') ||
            $t('common.modalList')
          "
        />
        <span v-if="appStore.modalMinimized.length" class="modal-dock-badge">{{
          appStore.modalMinimized.length
        }}</span>
      </div>
      <template #overlay="{ close }">
        <Card :title="$t('common.modalList')">
          <template #extra>
            <Button
              size="small"
              type="link"
              :disabled="!appStore.modalMinimized.length"
              @click="
                () => {
                  openAll()
                  close()
                }
              "
            >
              {{ $t('common.openAll') }}
            </Button>
            <Button
              size="small"
              type="link"
              :disabled="!appStore.modalMinimizers.size"
              @click="
                () => {
                  minimizeAll()
                  close()
                }
              "
            >
              {{ $t('common.minimizeAll') }}
            </Button>
          </template>
          <div class="flex flex-col gap-4 p-4 min-w-160">
            <div
              v-if="!appStore.modalMinimized.length"
              class="text-12 text-muted text-center py-8 px-6"
            >
              {{ $t('common.none') }}
            </div>
            <div
              v-for="modal in appStore.modalMinimized"
              :key="modal.id"
              class="flex items-center justify-between gap-4"
            >
              <Button
                class="flex-1 justify-start"
                type="text"
                @click="
                  () => {
                    modal.openFn()
                    close()
                  }
                "
              >
                {{ $t(modal.title() || 'common.modalList') }}
              </Button>
              <Button
                icon="close"
                type="text"
                size="small"
                :aria-label="$t('common.close')"
                @click="handleCloseMinimized(modal, close)"
              />
            </div>
          </div>
        </Card>
      </template>
    </Dropdown>
    <Button
      v-if="kernelApiStore.needRestart || kernelApiStore.restarting"
      v-tips="'home.overview.restart'"
      :aria-label="$t('home.overview.restart')"
      :loading="kernelApiStore.restarting"
      icon="restart"
      type="primary"
      class="restart-pill shadow"
      @click="handleRestartCore"
    >
      {{ $t('common.restartNeeded') }}
    </Button>
  </div>
</template>

<style scoped>
.global-dock {
  z-index: var(--z-dock, 9000);
}
.restart-pill {
  border-radius: 999px;
  padding: 8px 16px;
}
.modal-dock-trigger {
  position: relative;
  display: inline-flex;
}
.modal-dock-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--accent-text);
  color: var(--btn-primary-color);
  font-size: calc(10px * var(--font-scale, 1));
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  pointer-events: none;
}
</style>
