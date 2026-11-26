<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { AbsolutePath, ReadDir, RemoveFile } from '@/bridge'
import { CoreCacheFilePath, CoreWorkingDirectory } from '@/constant/kernel'
import { useAppSettingsStore, useKernelApiStore } from '@/stores'
import { confirm, formatBytes, message, modal, previewCode } from '@/utils'

import BranchDetail from './components/BranchDetail.vue'
import CoreConfiguration from './components/CoreConfig.vue'
import NetworkSettings from './components/NetworkSettings.vue'

const { t } = useI18n()
const settings = useAppSettingsStore()
const kernelApiStore = useKernelApiStore()

const handleCoreConfiguraion = async (isAlpha: boolean) => {
  const m = modal({ title: 'settings.kernel.config.name', size: 'lg' })
  m.setContent(CoreConfiguration, { isAlpha }).open()
}

const showDirectory = async () => {
  try {
    const [path, entries] = await Promise.all([
      AbsolutePath(CoreWorkingDirectory),
      ReadDir(CoreWorkingDirectory),
    ])
    const listing = entries.map((entry) =>
      entry.isDir ? entry.name + '/' : entry.name + '   ' + formatBytes(entry.size),
    )
    previewCode(path, listing.join('\n'), 'text')
  } catch (error) {
    message.error(error)
  }
}

const handleClearCoreCache = async () => {
  try {
    await confirm(t('settings.kernel.clearCache'), t('settings.kernel.confirmClearCache'), {
      type: 'text',
      okText: 'settings.kernel.clearCache',
      danger: true,
    })
  } catch {
    return
  }

  try {
    if (kernelApiStore.running) {
      await kernelApiStore.restartCore(() => RemoveFile(CoreCacheFilePath))
    } else {
      await RemoveFile(CoreCacheFilePath)
    }
    message.success('common.success')
  } catch (error: any) {
    message.error(error)
    console.log(error)
  }
}
</script>

<template>
  <div class="flex flex-col gap-12 mb-8">
    <div class="px-4 py-8 text-16 font-bold">{{ $t('settings.kernel.version') }}</div>
    <section class="branch-grid">
      <BranchDetail :is-alpha="false" @config="handleCoreConfiguraion(false)" />
      <BranchDetail :is-alpha="true" @config="handleCoreConfiguraion(true)" />
    </section>
    <Card>
      <div class="settings-row">
        <div>{{ $t('settings.autoStartKernel') }}</div>
        <Switch v-model="settings.app.autoStartKernel" />
      </div>
      <div class="settings-row">
        <div>{{ $t('settings.realMemoryUsage') }}</div>
        <Switch v-model="settings.app.kernel.realMemoryUsage" />
      </div>
      <div class="settings-row">
        <div>
          {{ $t('settings.autoRestartKernel.name') }}
          <span class="font-normal text-12">{{ $t('settings.autoRestartKernel.tips') }}</span>
        </div>
        <Switch v-model="settings.app.autoRestartKernel" />
      </div>
      <div class="settings-row">
        <div>{{ $t('workspace.coreDirectory') }}</div>
        <div class="flex flex-wrap items-center gap-8">
          <Button size="small" icon="folder" @click="showDirectory">
            {{ $t('workspace.coreDirectory') }}
          </Button>
          <Button size="small" icon="clear3" @click="handleClearCoreCache">
            {{ $t('settings.kernel.clearCache') }}
          </Button>
        </div>
      </div>
    </Card>
    <NetworkSettings />
  </div>
</template>

<style scoped>
.branch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
  gap: 12px;
}
</style>
