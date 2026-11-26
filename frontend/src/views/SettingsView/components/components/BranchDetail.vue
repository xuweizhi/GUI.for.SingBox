<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { ReadDir, AbsolutePath, RemoveFile } from '@/bridge'
import { CoreCacheFilePath, CoreWorkingDirectory } from '@/constant/kernel'
import { Branch } from '@/enums/app'
import { useCoreBranch } from '@/hooks/useCoreBranch'
import { useAppSettingsStore } from '@/stores'
import { useKernelApiStore } from '@/stores'
import { confirm, message, previewCode, formatBytes } from '@/utils'

import SwitchBranch from './SwitchBranch.vue'

interface Props {
  isAlpha: boolean
}

const props = withDefaults(defineProps<Props>(), {})

const branch = computed(() => (props.isAlpha ? Branch.Alpha : Branch.Main))
const settings = useAppSettingsStore()
const emit = defineEmits(['config'])

const { t } = useI18n()
const kernelApiStore = useKernelApiStore()

const {
  restartable,
  updatable,
  rollbackable,
  rollingBack,
  versionDetail,
  localVersion,
  localVersionLoading,
  remoteVersion,
  remoteVersionLoading,
  downloading,
  downloadProgress,
  cancelDownload,
  refreshLocalVersion,
  refreshRemoteVersion,
  downloadCore,
  restartCore,
  rollbackCore,
  openReleasePage,
} = useCoreBranch(props.isAlpha)

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
const refreshVersions = () => {
  void refreshLocalVersion(true)
  void refreshRemoteVersion(true)
}
</script>

<template>
  <Card :title="isAlpha ? 'Alpha' : 'Stable'" :selected="settings.app.kernel.branch === branch">
    <template #extra><SwitchBranch :branch="branch" /></template>
    <p class="text-12 text-secondary">
      {{ t(isAlpha ? 'settings.kernel.alpha' : 'settings.kernel.stable') }}
    </p>

    <div v-if="versionDetail" class="text-12 text-muted pt-8 break-all line-clamp-2 font-mono">
      {{ versionDetail }}
    </div>
    <div class="flex flex-wrap items-center gap-8 min-h-38 py-6">
      <Tag :color="updatable ? 'orange' : 'default'">
        {{ t('settings.kernel.local') }}
        :
        {{ localVersionLoading ? 'Loading' : localVersion || t('kernel.notFound') }}
      </Tag>
      <Tag :color="updatable ? 'purple' : 'default'">
        {{ t('settings.kernel.remote') }}
        :
        {{ remoteVersionLoading ? 'Loading' : remoteVersion }}
      </Tag>
      <Button
        v-show="!localVersionLoading && !remoteVersionLoading && updatable"
        :loading="downloading"
        icon="sparkle"
        size="small"
        type="primary"
        class="ml-auto"
        @click="downloadCore"
      >
        {{ downloading ? downloadProgress : t('settings.kernel.update') }}
      </Button>
      <Button
        v-if="downloading && cancelDownload"
        icon="close"
        size="small"
        type="primary"
        class="ml-2"
        @click="cancelDownload"
      />
      <Button
        v-show="!localVersionLoading && !remoteVersionLoading && restartable"
        :loading="kernelApiStore.restarting"
        size="small"
        type="primary"
        class="ml-auto"
        @click="restartCore"
      >
        {{ t('settings.kernel.restart') }}
      </Button>
    </div>
    <div class="resource-card-footer">
      <Button
        type="text"
        size="small"
        icon="refresh"
        :loading="localVersionLoading || remoteVersionLoading"
        @click="refreshVersions"
        >{{ t('common.refresh') }}</Button
      >
      <Button
        v-if="rollbackable"
        v-tips="'settings.kernel.rollbackTip'"
        :aria-label="t('settings.kernel.rollbackTip')"
        :loading="rollingBack"
        :disabled="downloading"
        icon="rollback"
        type="text"
        size="small"
        @click="rollbackCore"
      />
      <Button
        v-tips="'settings.kernel.clearCache'"
        :aria-label="t('settings.kernel.clearCache')"
        type="text"
        size="small"
        icon="clear3"
        @click="handleClearCoreCache"
      />
      <Button
        type="text"
        size="small"
        icon="folder"
        :aria-label="t('workspace.coreDirectory')"
        :title="t('workspace.coreDirectory')"
        @click="showDirectory"
      />
      <Button
        v-tips="'settings.kernel.linkTip'"
        :aria-label="t('settings.kernel.linkTip')"
        icon="link"
        type="text"
        size="small"
        @click="openReleasePage"
      />
      <Button
        v-tips="'settings.kernel.config.name'"
        :aria-label="t('settings.kernel.config.name')"
        type="text"
        size="small"
        icon="settings3"
        @click="emit('config')"
      />
    </div>
  </Card>
</template>
