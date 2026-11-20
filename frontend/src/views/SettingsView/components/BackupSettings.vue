<script setup lang="ts">
import { onActivated, reactive, ref, shallowRef } from 'vue'
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

const { t } = useI18n()
const auth = useWebuiAuthStore()
const busy = ref(false)
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

const run = async (operation: () => Promise<void>) => {
  if (busy.value) return
  busy.value = true
  try {
    await operation()
  } catch (error) {
    message.error(error)
  } finally {
    busy.value = false
  }
}

const refreshHistory = async () => {
  const state = await (await request('history')).json()
  auto.value = state.enabled
  history.value = state.files
}

onActivated(() => void run(refreshHistory))

const toggle = () =>
  run(async () => {
    await request('history', { method: 'PUT', body: JSON.stringify({ enabled: !auto.value }) })
    await refreshHistory()
  })

const exportZip = () =>
  run(async () => {
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
  if (file) void run(() => inspect(file, file.name))
}

const chooseSnapshot = (name: string) =>
  run(async () => {
    const response = await request('snapshot?name=' + encodeURIComponent(name))
    await inspect(await response.blob(), name)
  })

const restore = async () => {
  if (!selected.value || busy.value) return false
  busy.value = true
  try {
    await withConfigMutation(() => request('restore', { method: 'POST', body: selected.value }))
    window.location.reload()
  } catch (error) {
    message.error(error)
    return false
  } finally {
    busy.value = false
  }
}

const webdav = (upload: boolean) =>
  run(async () => {
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
      <p>{{ t('backup.contents') }}</p>
      <div class="flex flex-wrap gap-8">
        <Button :disabled="busy" @click="exportZip">{{ t('backup.export') }}</Button>
        <Button :disabled="busy" @click="picker?.click()">{{ t('backup.import') }}</Button>
        <input ref="picker" hidden type="file" accept=".zip,application/zip" @change="chooseFile" />
      </div>
    </Card>
    <Card :title="t('backup.history')">
      <Switch :model-value="auto" :disabled="busy" label="backup.auto" @change="toggle" />
      <div v-if="history.length" class="flex flex-col items-start gap-4 mt-8">
        <Button
          v-for="name in history"
          :key="name"
          type="link"
          :disabled="busy"
          @click="chooseSnapshot(name)"
        >
          {{ name }}
        </Button>
      </div>
    </Card>
    <Card title="WebDAV">
      <div class="flex flex-col gap-8">
        <label for="backup-dav-url">{{ t('backup.davUrl') }}</label>
        <Input v-model="dav.url" input-id="backup-dav-url" placeholder="https://…/backup.zip" />
        <label for="backup-dav-user">{{ t('backup.username') }}</label>
        <Input v-model="dav.username" input-id="backup-dav-user" />
        <label for="backup-dav-password">{{ t('backup.password') }}</label>
        <Input v-model="dav.password" type="password" input-id="backup-dav-password" />
        <div class="flex flex-wrap gap-8">
          <Button :disabled="busy || !dav.url" @click="webdav(true)">{{
            t('backup.upload')
          }}</Button>
          <Button :disabled="busy || !dav.url" @click="webdav(false)">{{
            t('backup.download')
          }}</Button>
        </div>
      </div>
    </Card>
    <Modal
      v-model:open="showPreview"
      title="backup.preview"
      submit-text="backup.restore"
      :on-ok="restore"
    >
      <div v-if="preview">
        <strong>{{ source }}</strong>
        <p>
          {{ new Date(preview.created).toLocaleString() }} ·
          {{ t('backup.files', [preview.files, formatBytes(preview.bytes)]) }}
        </p>
        <div v-for="(count, key) in preview.counts" :key="key">
          {{ t('backup.resources.' + key) }} · {{ count }}
        </div>
        <template v-if="preview.external.length">
          <p>{{ t('backup.external') }}</p>
          <ul>
            <li v-for="name in preview.external" :key="name" class="break-all">{{ name }}</li>
          </ul>
        </template>
        <p>{{ t('backup.replace') }}</p>
      </div>
    </Modal>
  </div>
</template>
