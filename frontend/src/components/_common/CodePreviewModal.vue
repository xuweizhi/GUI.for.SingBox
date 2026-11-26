<script setup lang="ts">
import { computed, ref } from 'vue'

import { ClipboardSetText } from '@/bridge'
import { message } from '@/utils'

import CodeEditor from '@/components/CodeEditor/index.vue'
import CodeViewer from '@/components/CodeViewer/index.vue'
const props = defineProps<{ content: string; lang: 'json' | 'javascript' | 'yaml' | 'text' }>()
const MAX_SEARCH_RESULTS = 500
const query = ref('')
const search = computed(() => query.value.trim())
const matchedLines = computed(() => {
  const needle = search.value.toLowerCase()
  if (!needle) return []
  return props.content
    .split('\n')
    .map((text, i) => ({ text, number: i + 1 }))
    .filter((line) => line.text.toLowerCase().includes(needle))
})
const visibleLines = computed(() => matchedLines.value.slice(0, MAX_SEARCH_RESULTS))
const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
const highlight = (text: string) => {
  const target = search.value
  if (!target) return escapeHtml(text)
  const lower = text.toLowerCase()
  const needle = target.toLowerCase()
  let result = ''
  let start = 0
  let index = lower.indexOf(needle)
  while (index !== -1) {
    result += escapeHtml(text.slice(start, index))
    result += `<mark>${escapeHtml(text.slice(index, index + target.length))}</mark>`
    start = index + target.length
    index = lower.indexOf(needle, start)
  }
  return result + escapeHtml(text.slice(start))
}
const copy = async () => {
  try {
    if (await ClipboardSetText(props.content)) message.success('common.copied')
    else message.error('ClipboardSetText Error')
  } catch (error) {
    message.error(error)
  }
}
</script>
<template>
  <div class="code-preview-toolbar flex items-center gap-8">
    <Input v-model="query" clearable :placeholder="$t('common.search')" class="flex-1" />
    <span v-if="search" class="resource-count-badge shrink-0">
      {{
        matchedLines.length > MAX_SEARCH_RESULTS
          ? `${MAX_SEARCH_RESULTS} / ${matchedLines.length}`
          : matchedLines.length
      }}
    </span>
    <Button icon="copy" @click="copy">{{ $t('common.copy') }}</Button>
  </div>
  <template v-if="search">
    <Empty v-if="!matchedLines.length" />
    <div v-else class="mt-8 flex flex-col gap-2">
      <div
        v-for="line in visibleLines"
        :key="line.number"
        class="font-mono text-13 break-all whitespace-pre-wrap"
      >
        <span class="text-muted mr-8">{{ line.number }}</span
        ><span v-html="highlight(line.text)"></span>
      </div>
    </div>
  </template>
  <CodeEditor
    v-if="lang !== 'text'"
    v-show="!search"
    :lang="lang"
    :editable="false"
    :toolbar="false"
    :model-value="content"
    class="mt-8"
  />
  <CodeViewer
    v-else
    v-show="!search"
    :model-value="content"
    :copyable="false"
    :toolbar="false"
    lang="text"
    class="mt-8"
  />
</template>

<style scoped>
.code-preview-toolbar {
  position: sticky;
  top: 0;
  z-index: 1;
  padding-bottom: 8px;
  background: var(--surface-elevated-bg, var(--modal-bg));
}
</style>
