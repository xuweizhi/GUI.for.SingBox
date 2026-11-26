<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { HttpGet, ReadFile } from '@/bridge'
import { usePluginsStore } from '@/stores'
import { message } from '@/utils'

interface Props {
  id: string
}

const props = defineProps<Props>()

const { t } = useI18n()
const files = ref<{ original: string; updated: string }>()
const loadError = ref('')

const pluginsStore = usePluginsStore()

const fetchAndUpdatePluginCode = async () => {
  loadError.value = ''
  files.value = undefined
  const p = pluginsStore.getPluginById(props.id)
  if (!p) {
    loadError.value = t('common.empty')
    return
  }
  try {
    const [original, { body, status }] = await Promise.all([
      pluginsStore.getPluginCodefromCache(p.id) ?? ReadFile(p.path),
      HttpGet<string>(p.url),
    ])
    if (status !== 200) throw new Error(`HTTP ${status}`)
    files.value = { original, updated: body }
  } catch (error: any) {
    loadError.value = error?.message || String(error)
    message.error(error)
  }
}

void fetchAndUpdatePluginCode()
</script>

<template>
  <div class="h-full flex flex-col">
    <CodeEditor
      v-if="files"
      :model-value="files.updated"
      :original="files.original"
      lang="javascript"
      mode="diff"
      class="h-full"
    />
    <div v-else-if="loadError" class="flex-1 flex flex-col items-center justify-center gap-12 p-16">
      <div class="text-13 text-danger text-center break-all" role="alert">{{ loadError }}</div>
      <Button type="primary" size="small" @click="fetchAndUpdatePluginCode">{{
        t('common.retry')
      }}</Button>
    </div>
    <div v-else class="flex-1 flex items-center justify-center">
      <Icon icon="loading" :size="24" class="rotation" />
    </div>
  </div>
</template>
