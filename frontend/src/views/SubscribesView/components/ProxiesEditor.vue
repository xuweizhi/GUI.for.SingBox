<script setup lang="ts">
import { ref, inject, h } from 'vue'
import { useI18n } from 'vue-i18n'

import { FileExists, ReadFile, WriteFile } from '@/bridge'
import { useFormDraft } from '@/hooks/useFormDraft'
import { useSubscribesStore } from '@/stores'
import {
  deepClone,
  message,
  omitArray,
  reconcileSubscriptionProxyIds,
  sampleID,
} from '@/utils'
import { extractSubscriptionConfig, subscriptionConfigForEditing } from '@/utils/subscriptionConfig'

import Button from '@/components/Button/index.vue'

interface Props {
  sub: App.Subscription
}

const props = defineProps<Props>()

const loading = ref(false)
const proxiesText = ref('')
const ready = ref(false)
const loadError = ref('')
const previousEntries = ref<Recordable[]>([])
const sub = ref(deepClone(props.sub))

const { t } = useI18n()
const subscribeStore = useSubscribesStore()

const handleCancel = inject('cancel') as any
const handleSubmit = inject('submit') as any
const { resetBaseline } = useFormDraft(() => proxiesText.value)

const readContent = () => ReadFile(sub.value.path).catch(async (error) => {
  if (sub.value.proxies.length || await FileExists(sub.value.path)) throw error
  return '[]'
})

const handleSave = async () => {
  if (!ready.value || loading.value) return
  loading.value = true
  try {
    const { path, proxies, id } = sub.value
    const parsed = JSON.parse(proxiesText.value)
    const { outbounds: proxiesWithId, importedDns } = extractSubscriptionConfig(parsed)
    const nextProxies = reconcileSubscriptionProxyIds(
      proxies,
      previousEntries.value,
      proxiesWithId,
      sampleID,
    )
    const next = { ...sub.value, proxies: nextProxies, ...(!Array.isArray(parsed) ? { importedDns } : {}) }
    const previousContent = await readContent()
    await WriteFile(path, JSON.stringify(omitArray(proxiesWithId, ['__id_in_gui']), null, 2))
    try {
      await subscribeStore.editSubscribe(id, next)
    } catch (saveError: any) {
      try {
        await WriteFile(path, previousContent)
      } catch (rollbackError: any) {
        throw new Error(
          `Failed to save subscription (${saveError.message || saveError}) and restore node cache (${rollbackError.message || rollbackError})`,
        )
      }
      throw saveError
    }
    handleSubmit()
  } catch (error: any) {
    console.log(error)

    message.error(error.message || error)
  } finally {
    loading.value = false
  }
}

const initProxiesText = async () => {
  loadError.value = ''
  ready.value = false
  try {
    const content = await readContent()
    const { outbounds: proxies, importedDns } = extractSubscriptionConfig(JSON.parse(content))
    previousEntries.value = proxies
    if (importedDns) sub.value.importedDns = importedDns
    const proxiesWithId = proxies.map((proxy) => {
      return {
        __id_in_gui: sub.value.proxies.find((v) => v.tag === proxy.tag)?.id || sampleID(),
        ...proxy,
      }
    })
    proxiesText.value = JSON.stringify(
      subscriptionConfigForEditing(proxiesWithId, sub.value.importedDns),
      null,
      2,
    )
    ready.value = true
    resetBaseline()
  } catch (error: any) {
    loadError.value = error?.message || String(error)
    message.error(error?.message || error)
  }
}

void initProxiesText()

const modalSlots = {
  cancel: () =>
    h(
      Button,
      {
        disabled: loading.value,
        onClick: handleCancel,
      },
      () => t('common.cancel'),
    ),
  submit: () =>
    h(
      Button,
      {
        type: 'primary',
        loading: loading.value,
        disabled: !ready.value,
        onClick: handleSave,
      },
      () => t('common.save'),
    ),
}

defineExpose({ modalSlots })
</script>

<template>
  <div ref="formRoot" class="h-full flex flex-col">
    <div class="text-12 text-secondary mb-8">{{ t('subscribe.endpointEditorHint') }}</div>
    <CodeEditor v-if="ready" v-model="proxiesText" lang="json" editable class="flex-1 min-h-0" />
    <div v-else-if="loadError" class="flex-1 flex flex-col items-center justify-center gap-12 p-16">
      <div class="text-13 text-danger text-center break-all" role="alert">{{ loadError }}</div>
      <Button type="primary" size="small" @click="initProxiesText">{{ t('common.retry') }}</Button>
    </div>
    <div v-else class="flex-1 flex items-center justify-center">
      <Icon icon="loading" :size="24" class="rotation" />
    </div>
  </div>
</template>
