<script setup lang="ts">
import { ref, inject, h } from 'vue'
import { useI18n } from 'vue-i18n'

import { useFormDraft } from '@/hooks/useFormDraft'
import { useSubscribesStore } from '@/stores'
import { message } from '@/utils'

import Button from '@/components/Button/index.vue'

interface Props {
  id: string
}

const props = defineProps<Props>()

const loading = ref(false)
const subscribe = ref<App.Subscription>()
const code = ref('')

const { t } = useI18n()
const subscribeStore = useSubscribesStore()

const handleCancel = inject('cancel') as any
const handleSubmit = inject('submit') as any

const handleSave = async () => {
  const latest = subscribeStore.getSubscribeById(props.id) || subscribe.value
  if (!latest || loading.value) return
  loading.value = true
  try {
    await subscribeStore.editSubscribe(props.id, { ...latest, script: code.value })
    message.success('common.success')
    await handleSubmit()
  } catch (error: any) {
    message.error(error)
    console.log(error)
  } finally {
    loading.value = false
  }
}

const s = subscribeStore.getSubscribeById(props.id)
if (s) {
  subscribe.value = s
  code.value = s.script
}
useFormDraft(() => code.value)

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
  <div ref="formRoot" class="h-full">
    <CodeEditor v-model="code" lang="javascript" editable class="h-full" />
  </div>
</template>
