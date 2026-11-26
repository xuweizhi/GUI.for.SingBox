<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { probeApiAvailability } from '@/api/kernel'
import { CoreStartTime } from '@/bridge'
import { ModeOptions } from '@/constant/kernel'
import { useAppSettingsStore, useKernelApiStore, useProfilesStore, useAppStore } from '@/stores'
import { confirm, handleChangeMode, message, modal } from '@/utils'
import CommonController from '@/views/HomeView/components/CommonController.vue'
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const kernelApiStore = useKernelApiStore()
const appSettingsStore = useAppSettingsStore()
const profiles = useProfilesStore()
const appStore = useAppStore()
const coreVersion = ref('')
const startedAt = ref(0)
const clock = ref(Date.now())
const uptime = computed(() => {
  const seconds = Math.max(0, Math.floor((clock.value - startedAt.value) / 1000))
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
})
watch(
  () => kernelApiStore.running && kernelApiStore.pid,
  (pid, _, cleanup) => {
    coreVersion.value = ''
    startedAt.value = 0
    if (!pid) return
    let current = true
    const timer = window.setInterval(() => (clock.value = Date.now()), 1000)
    cleanup(() => {
      current = false
      clearInterval(timer)
    })
    void probeApiAvailability()
      .then((info) => {
        if (current) coreVersion.value = info.version || ''
      })
      .catch(() => {})
    void CoreStartTime()
      .then((time) => {
        if (current) startedAt.value = time
      })
      .catch(() => {})
  },
  { immediate: true },
)
const modeKey = ref(0)
const onModeChange = async (mode: 'direct' | 'global' | 'rule') => {
  try {
    await handleChangeMode(mode)
  } catch (error) {
    modeKey.value++
    message.error(error)
  }
}
const switchingProfileId = ref('')
const busy = computed(
  () =>
    !!switchingProfileId.value ||
    kernelApiStore.starting ||
    kernelApiStore.stopping ||
    kernelApiStore.restarting,
)
const handleRestartKernel = async () => {
  emit('close')
  try {
    await kernelApiStore.restartCore()
  } catch (error: any) {
    console.error(error)
    message.error(error.message || error)
  }
}

const handleStopKernel = async () => {
  emit('close')
  try {
    await confirm(t('home.overview.stop'), t('common.confirmStopCore'), {
      type: 'text',
      okText: 'home.overview.stop',
      danger: true,
    })
  } catch {
    return
  }

  try {
    await kernelApiStore.stopCore()
  } catch (error: any) {
    console.error(error)
    message.error(error.message || error)
  }
}

const handleSwitchProfile = async (profileId: string) => {
  const previous = appSettingsStore.app.kernel.profile
  if (
    previous === profileId ||
    switchingProfileId.value ||
    kernelApiStore.starting ||
    kernelApiStore.stopping ||
    kernelApiStore.restarting
  )
    return
  appSettingsStore.app.kernel.profile = profileId
  switchingProfileId.value = profileId
  try {
    if (kernelApiStore.running) await kernelApiStore.restartCore()
    message.success('common.success')
  } catch (error: any) {
    appSettingsStore.app.kernel.profile = previous
    console.error(error)
    message.error(error.message || error)
  } finally {
    switchingProfileId.value = ''
  }
}

const onTunSwitchChange = async (enable: boolean) => {
  try {
    await kernelApiStore.updateConfig('tun', { enable })
  } catch (error: any) {
    kernelApiStore.config.tun.enable = kernelApiStore.running && !enable
    console.error(error)
    message.error(error.message || error)
  }
}

const handleShowSettings = () => {
  emit('close')
  const m = modal({
    title: 'home.overview.settings',
    cancelText: 'common.close',
    size: 'md',
    submit: false,
    maskClosable: true,
  })
  m.setContent(CommonController).open()
}
</script>
<template>
  <div class="p-12 flex flex-col gap-10 core-controls">
    <strong>{{ t(kernelApiStore.running ? 'common.coreRunning' : 'common.coreStopped') }}</strong>
    <Select
      :model-value="appSettingsStore.app.kernel.profile"
      :disabled="busy"
      :options="profiles.profiles.map((p) => ({ label: p.name, value: p.id }))"
      :placeholder="t('profiles.select')"
      @change="handleSwitchProfile"
    />
    <template v-if="kernelApiStore.running">
      <div v-if="coreVersion || startedAt" class="text-secondary text-12 flex flex-wrap gap-8">
        <span v-if="coreVersion">sing-box {{ coreVersion }}</span>
        <span v-if="startedAt">{{ t('workspace.uptime') }} {{ uptime }}</span>
      </div>
      <Radio
        :key="kernelApiStore.config.mode + '-' + modeKey"
        :model-value="kernelApiStore.config.mode"
        :options="ModeOptions"
        @change="onModeChange"
      />
      <Switch v-model="kernelApiStore.config.tun.enable" @change="onTunSwitchChange">{{
        t('home.overview.tunMode')
      }}</Switch>
      <div @click="emit('close')">
        <CustomAction :actions="appStore.customActions.core_state" />
      </div>
      <div class="flex flex-wrap gap-6">
        <Button icon="settings" @click="handleShowSettings">{{
          t('home.overview.settings')
        }}</Button>
        <Button icon="restart" :disabled="busy" @click="handleRestartKernel">{{
          t('home.overview.restart')
        }}</Button>
        <Button icon="stop" :disabled="busy" @click="handleStopKernel">{{
          t('home.overview.stop')
        }}</Button>
      </div>
    </template>
    <Button
      v-else
      type="primary"
      :disabled="busy || !profiles.currentProfile"
      @click="kernelApiStore.startCore().catch(message.error)"
      >{{ t('home.overview.start') }}</Button
    >
  </div>
</template>
<style scoped>
.core-controls {
  width: min(300px, 88vw);
}
</style>
