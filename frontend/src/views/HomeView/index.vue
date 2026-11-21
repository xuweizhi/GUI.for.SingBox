<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import logo from '@/assets/logo'
import { useAppSettingsStore, useProfilesStore, useKernelApiStore } from '@/stores'
import { APP_TITLE, message, modal } from '@/utils'

import GroupsController from './components/GroupsController.vue'
import KernelLogs from './components/KernelLogs.vue'
import OverView from './components/OverView.vue'
import QuickStart from './components/QuickStart.vue'

const showController = ref(false)

const { t } = useI18n()

const appSettingsStore = useAppSettingsStore()
const profilesStore = useProfilesStore()
const kernelApiStore = useKernelApiStore()

const handleStartKernel = async () => {
  try {
    await kernelApiStore.startCore()
  } catch (error: any) {
    console.error(error)
    message.error(error.message || error)
  }
}

const handleShowQuickStart = () => {
  modal({ title: 'subscribes.enterLink' }).setContent(QuickStart).open()
}

const handleShowKernelLogs = () => {
  const m = modal({
    title: 'home.overview.viewlog',
    width: '90',
    height: '90',
    submit: false,
    cancelText: 'common.close',
    maskClosable: true,
  })
  m.setContent(KernelLogs).open()
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && showController.value) {
    showController.value = false
  }
}

watch(showController, (v) => {
  if (v) {
    kernelApiStore.refreshProviderProxies()
  } else {
    kernelApiStore.refreshConfig()
  }
})

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="home-view relative h-full">
    <div
      v-if="(!kernelApiStore.running && !kernelApiStore.stopping) || kernelApiStore.starting"
      class="w-full min-h-[85%] flex flex-col items-center justify-center py-24"
    >
      <img :src="logo" draggable="false" class="w-128 mb-16" />

      <template v-if="profilesStore.profiles.length === 0">
        <p class="text-muted mb-16">{{ t('home.noProfile', [APP_TITLE]) }}</p>
        <Button type="primary" @click="handleShowQuickStart">{{ t('home.quickStart') }}</Button>
      </template>

      <template v-else>
        <div class="home-profile-options flex flex-wrap justify-center gap-12 mb-32">
          <Card
            v-for="p in profilesStore.profiles.slice(0, profilesStore.profiles.length > 4 ? 3 : 4)"
            :key="p.id"
            :selected="appSettingsStore.app.kernel.profile === p.id"
            interactive
            @click="appSettingsStore.app.kernel.profile = p.id"
          >
            <div
              class="w-128 h-full flex items-center justify-center py-24 text-center font-bold text-13"
            >
              {{ p.name }}
            </div>
          </Card>
          <Dropdown v-if="profilesStore.profiles.length > 4" placement="top">
            <Card interactive class="h-full">
              <div
                class="w-128 h-full flex items-center justify-center py-24 text-center font-bold text-13"
              >
                {{ t('common.more') }} ({{ profilesStore.profiles.length - 3 }})
              </div>
            </Card>
            <template #overlay="{ close }">
              <div class="flex flex-col gap-2 p-6 min-w-160">
                <Button
                  v-for="p in profilesStore.profiles.slice(3)"
                  :key="p.id"
                  type="text"
                  class="justify-between"
                  @click="
                    () => {
                      appSettingsStore.app.kernel.profile = p.id
                      close()
                    }
                  "
                >
                  <span>{{ p.name }}</span>
                  <Icon
                    v-if="appSettingsStore.app.kernel.profile === p.id"
                    icon="selected"
                    color="var(--accent-text)"
                  />
                </Button>
              </div>
            </template>
          </Dropdown>
          <Card interactive @click="handleShowQuickStart">
            <div
              class="w-128 h-full flex items-center justify-center py-24 text-center font-bold text-13 text-muted"
            >
              + {{ t('home.quickStart') }}
            </div>
          </Card>
        </div>
        <Button
          :loading="kernelApiStore.starting"
          type="primary"
          size="large"
          @click="handleStartKernel"
        >
          {{ t('home.overview.start') }}
        </Button>
        <Button type="link" size="small" class="mt-8" @click="handleShowKernelLogs">
          {{ t('home.overview.viewlog') }}
        </Button>
      </template>
    </div>

    <template v-else-if="!kernelApiStore.coreStateLoading">
      <div v-show="!showController" class="home-overview-scroll">
        <OverView @open-groups="showController = true" />
        <Divider class="controller-trigger mt-16">
          <Button type="link" size="small" @click="showController = true">
            {{ t('home.overview.allGroups') }}
          </Button>
        </Divider>
      </div>

      <div v-if="showController" class="controller-panel pb-32">
        <div class="controller-panel__bar flex items-center justify-between gap-8 mb-12">
          <div class="font-bold text-16">{{ t('home.overview.allGroups') }}</div>
          <Button
            type="normal"
            size="small"
            icon="arrowLeft"
            @click="showController = false"
          >
            {{ t('router.overview') }}
          </Button>
        </div>
        <GroupsController />
      </div>
    </template>
  </div>
</template>

<style scoped>
.home-profile-options {
  max-width: 800px;
}
.controller-panel__bar {
  padding: 0 8px;
}
@media (max-width: 700px) {
  .home-profile-options {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .home-profile-options :deep(.w-128) {
    width: 100%;
    overflow-wrap: anywhere;
  }
}
</style>
