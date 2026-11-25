<script setup lang="ts">
import * as Stores from '@/stores'
import { message } from '@/utils'

import { CommandView } from '@/components'

interface Props {
  loading: boolean
}

defineProps<Props>()

const appStore = Stores.useAppStore()
const kernelApiStore = Stores.useKernelApiStore()

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
  Array.from(appStore.modalMinimizers).reverse().forEach((minimize) => minimize())
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

  <CommandView v-if="!loading" />

  <div
    v-if="appStore.modalMinimizers.size || appStore.modalMinimized.length || kernelApiStore.needRestart || kernelApiStore.restarting"
    class="fixed right-32 bottom-32 flex flex-col gap-8 z-9999"
  >
    <Dropdown v-if="appStore.modalMinimizers.size || appStore.modalMinimized.length" placement="top">
      <Button
        icon="adjust"
        :aria-label="$t('common.modalList')"
        class="shadow"
      />
      <template #overlay="{ close }">
        <Card :title="$t('common.modalList')">
          <template #extra>
            <Button
              size="small"
              type="link"
              @click="
                () => {
                  openAll()
                  close()
                }
              "
            >
              {{ $t('common.openAll') }}
            </Button>
            <Button size="small" type="link" @click="minimizeAll">
              {{ $t('common.minimizeAll') }}
            </Button>
          </template>
          <div class="flex flex-col gap-4 p-4 min-w-128">
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
                {{ $t(modal.title()) }}
              </Button>
              <Button
                icon="close"
                type="text"
                size="small"
                :aria-label="$t('common.close')"
                @click="modal.closeFn"
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
.restart-pill {
  border-radius: 999px;
  padding: 8px 16px;
}
</style>
