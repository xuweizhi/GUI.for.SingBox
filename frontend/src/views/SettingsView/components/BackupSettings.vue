<script setup lang="ts">
import { computed, onActivated, reactive, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useWebuiAuthStore } from '@/stores'
import { formatBytes, message } from '@/utils'
import { withConfigMutation } from '@/utils/configPersistence'

interface Preview {
  created: string
  files: number
  bytes: number
  counts: Record<string, number>
  external: string[]
}

type BusyAction = '' | 'history' | 'export' | 'import' | 'snapshot' | 'upload' | 'download' | 'restore'

const { t } = useI18n()
const auth = useWebuiAuthStore()
const busyAction = ref<BusyAction>('')
const busy = computed(() => busyAction.value !== '')
const auto = ref(false)
const history = ref<string[]>([])
const picker = ref<HTMLInputElement>()
const selected = shallowRef<Blob>()
const preview = ref<Preview>()
const showPreview = ref(false)
const source = ref('')
const dav = reactive({ url: '', username: '', password: '' })

const request = async (action: string, init: RequestInit = {}) => {
  const response = await fetch('/__webui/api/backup/' + action, init)
  if (response.status === 401 && response.headers.get('X-GFS-WebUI-Auth') === 'required') {
    await auth.handleUnauthorized()
    throw new Error(t('auth.invalidToken'))
  }
  if (!response.ok) throw new Error((await response.text()).trim() || response.statusText)
  return response
}

const run = async (action: BusyAction, operation: () => Promise<void>) => {
  if (busy.value) return
  busyAction.value = action
  try {
    await operation()
  } catch (error) {
    message.error(error)
  } finally {
    busyAction.value = ''
  }
}

const refreshHistory = async () => {
  const state = await (await request('history')).json()
  auto.value = state.enabled
  history.value = state.files
}

onActivated(() => void run('history', refreshHistory))

const toggle = () =>
  run('history', async () => {
    await request('history', { method: 'PUT', body: JSON.stringify({ enabled: !auto.value }) })
    await refreshHistory()
  })

const exportZip = () =>
  run('export', async () => {
    const response = await withConfigMutation(() => request('export', { method: 'POST' }))
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = 'gui-for-singbox-' + new Date().toISOString().slice(0, 10) + '.zip'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  })

const inspect = async (blob: Blob, label: string) => {
  const response = await request('preview', { method: 'POST', body: blob })
  preview.value = await response.json()
  selected.value = blob
  source.value = label
  showPreview.value = true
}

const chooseFile = (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void run('import', () => inspect(file, file.name))
}

const chooseSnapshot = (name: string) =>
  run('snapshot', async () => {
    const response = await request('snapshot?name=' + encodeURIComponent(name))
    await inspect(await response.blob(), name)
  })

const restore = async () => {
  if (!selected.value || busy.value) return false
  busyAction.value = 'restore'
  try {
    await withConfigMutation(() => request('restore', { method: 'POST', body: selected.value }))
    window.location.reload()
  } catch (error) {
    message.error(error)
    return false
  } finally {
    busyAction.value = ''
  }
}

const webdav = (upload: boolean) =>
  run(upload ? 'upload' : 'download', async () => {
    const action = upload ? 'webdav-upload' : 'webdav-download'
    const send = () =>
      request(action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dav),
      })
    const response = upload ? await withConfigMutation(send) : await send()
    if (upload) message.success('common.success')
    else await inspect(await response.blob(), 'WebDAV')
  })
</script>

<template>
  <div class="flex flex-col gap-12">
    <Card :title="t('backup.local')">
      <p class="text-13 text-muted mt-0 mb-12">{{ t('backup.contents') }}</p>
      <div class="flex flex-wrap gap-8">
        <Button
          type="primary"
          :loading="busyAction === 'export'"
          :disabled="busy && busyAction !== 'export'"
          @click="exportZip"
        >
          {{ t('backup.export') }}
        </Button>
        <Button
          :loading="busyAction === 'import'"
          :disabled="busy && busyAction !== 'import'"
          @click="picker?.click()"
        >
          {{ t('backup.import') }}
        </Button>
        <input ref="picker" hidden type="file" accept=".zip,application/zip" @change="chooseFile" />
      </div>
    </Card>
    <Card :title="t('backup.history')">
      <Switch :model-value="auto" :disabled="busy" label="backup.auto" @change="toggle" />
      <div v-if="history.length" class="flex flex-col items-start gap-4 mt-12">
        <div class="text-12 text-muted">{{ t('backup.clickSnapshotHint') }}</div>
        <Button
          v-for="name in history"
          :key="name"
          type="link"
          size="small"
          :loading="busyAction === 'snapshot'"
          :disabled="busy && busyAction !== 'snapshot'"
          @click="chooseSnapshot(name)"
        >
          {{ name }}
        </Button>
      </div>
      <div v-else class="text-12 text-muted mt-10">
        {{ t('backup.noHistory') }}
      </div>
    </Card>
    <Card title="WebDAV">
      <div class="flex flex-col gap-8">
        <label for="backup-dav-url" class="text-13 font-bold">{{ t('backup.davUrl') }}</label>
        <Input v-model="dav.url" input-id="backup-dav-url" placeholder="https://…/backup.zip" />
        <label for="backup-dav-user" class="text-13 font-bold">{{ t('backup.username') }}</label>
        <Input v-model="dav.username" input-id="backup-dav-user" />
        <label for="backup-dav-password" class="text-13 font-bold">{{ t('backup.password') }}</label>
        <Input v-model="dav.password" type="password" input-id="backup-dav-password" />
        <div class="flex flex-wrap gap-8 mt-4">
          <Button
            type="primary"
            :loading="busyAction === 'upload'"
            :disabled="!dav.url || (busy && busyAction !== 'upload')"
            @click="webdav(true)"
          >
            {{ t('backup.upload') }}
          </Button>
          <Button
            :loading="busyAction === 'download'"
            :disabled="!dav.url || (busy && busyAction !== 'download')"
            @click="webdav(false)"
          >
            {{ t('backup.download') }}
          </Button>
        </div>
      </div>
    </Card>
    <Modal
      v-model:open="showPreview"
      title="backup.preview"
      submit-text="backup.restore"
      submit-type="danger"
      :on-ok="restore"
    >
      <div v-if="preview" class="flex flex-col gap-10">
        <div>
          <strong>{{ source }}</strong>
          <p class="text-12 text-muted my-4">
            {{ new Date(preview.created).toLocaleString() }} ·
            {{ t('backup.files', [preview.files, formatBytes(preview.bytes)]) }}
          </p>
        </div>
        <div class="backup-preview-counts rounded-8 p-10 flex flex-col gap-4 text-13">
          <div v-for="(count, key) in preview.counts" :key="key" class="flex justify-between">
            <span class="text-muted">{{ t('backup.resources.' + key) }}</span>
            <strong>{{ count }}</strong>
          </div>
        </div>
        <template v-if="preview.external.length">
          <p class="text-13 font-bold my-0">{{ t('backup.external') }}</p>
          <ul class="my-0 pl-16 text-12 font-mono">
            <li v-for="name in preview.external" :key="name" class="break-all">{{ name }}</li>
          </ul>
        </template>
        <div class="backup-replace-warning rounded-8 p-10 text-12">
          {{ t('backup.replace') }}
        </div>
      </div>
    </Modal>
  </div>
</template>

<style lang="less" scoped>
.backup-preview-counts {
  background: var(--bg-color);
  border: 1px solid var(--border-color);
}

.backup-replace-warning {
  color: var(--warning-color);
  background: var(--warning-soft);
  border: 1px solid color-mix(in srgb, var(--warning-color) 35%, transparent);
  line-height: 1.6;
}
</style>
