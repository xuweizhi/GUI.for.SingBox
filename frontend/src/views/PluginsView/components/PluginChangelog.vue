<script setup lang="ts">
import { ref } from 'vue'

import { HttpGet, ReadFile } from '@/bridge'
import { usePluginsStore } from '@/stores'
import { message } from '@/utils'

interface Props {
  id: string
}

const props = defineProps<Props>()

const files = ref<{ original: string; updated: string }>()

const pluginsStore = usePluginsStore()

const fetchAndUpdatePluginCode = async () => {
  const p = pluginsStore.getPluginById(props.id)
  if (!p) return
  try {
    const [original, { body, status }] = await Promise.all([
      pluginsStore.getPluginCodefromCache(p.id) ?? ReadFile(p.path),
      HttpGet<string>(p.url),
    ])
    if (status !== 200) throw new Error(`HTTP ${status}`)
    files.value = { original, updated: body }
  } catch (error) {
    message.error(error)
  }
}

fetchAndUpdatePluginCode()
</script>

<template>
  <CodeEditor v-if="files" :model-value="files.updated" :original="files.original" lang="javascript" mode="diff" />
</template>
