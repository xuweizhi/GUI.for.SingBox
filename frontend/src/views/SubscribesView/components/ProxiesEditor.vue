<script setup lang="ts">
import { ref, inject, h } from 'vue'
import { useI18n } from 'vue-i18n'

import { ReadFile, WriteFile } from '@/bridge'
import { useSubscribesStore } from '@/stores'
import {
  deepClone,
  ignoredError,
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
const previousEntries = ref<Recordable[]>([])
const sub = ref(deepClone(props.sub))

const { t } = useI18n()
const subscribeStore = useSubscribesStore()

const handleCancel = inject('cancel') as any
const handleSubmit = inject('submit') as any

const handleSave = async () => {
  loading.value = true
  try {
    const { path, proxies, id } = sub.value
    const parsed = JSON.parse(proxiesText.value)
    const { outbounds: proxiesWithId, importedDns } = extractSubscriptionConfig(parsed)
    sub.value.proxies = reconcileSubscriptionProxyIds(
      proxies,
      previousEntries.value,
      proxiesWithId,
      sampleID,
    )
    if (!Array.isArray(parsed)) sub.value.importedDns = importedDns
    const previousContent = (await ignoredError(ReadFile, path)) || '[]'
    await WriteFile(path, JSON.stringify(omitArray(proxiesWithId, ['__id_in_gui']), null, 2))
    try {
      await subscribeStore.editSubscribe(id, sub.value)
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
  }
  loading.value = false
}

const initProxiesText = async () => {
  const content = (await ignoredError(ReadFile, sub.value.path)) || '[]'
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
}

initProxiesText().catch((error) => message.error(error.message || error))

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
        onClick: handleSave,
      },
      () => t('common.save'),
    ),
}

defineExpose({ modalSlots })
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="text-12 text-secondary mb-8">{{ t('subscribe.endpointEditorHint') }}</div>
    <CodeEditor v-model="proxiesText" lang="json" editable class="flex-1 min-h-0" />
  </div>
</template>
