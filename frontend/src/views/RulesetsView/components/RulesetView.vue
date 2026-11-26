<script setup lang="ts">
import { ref, inject, h } from 'vue'
import { useI18n } from 'vue-i18n'

import { FileExists, ReadFile } from '@/bridge'
import { EmptyRuleSet } from '@/constant/kernel'
import { useFormDraft } from '@/hooks/useFormDraft'
import { useRulesetsStore } from '@/stores'
import { deepClone, message } from '@/utils'

import Button from '@/components/Button/index.vue'

interface Props {
  id: string
}

const props = defineProps<Props>()

const loading = ref(false)
const ready = ref(false)
const loadError = ref('')
const ruleset = ref<App.RuleSet>()
const rulesetContent = ref<string>('')

const handleCancel = inject('cancel') as any
const handleSubmit = inject('submit') as any

const { t } = useI18n()
const rulesetsStore = useRulesetsStore()
const { resetBaseline } = useFormDraft(() => rulesetContent.value)

const handleSave = async () => {
  if (!ruleset.value || !ready.value || loading.value) return
  loading.value = true
  try {
    await rulesetsStore.saveLocalRuleset(ruleset.value.id, rulesetContent.value)
    await handleSubmit()
  } catch (error: any) {
    message.error(error)
    console.log(error)
  } finally {
    loading.value = false
  }
}

const initContent = async () => {
  loadError.value = ''
  ready.value = false
  const r = rulesetsStore.getRulesetById(props.id)
  if (!r) {
    loadError.value = t('common.empty')
    return
  }
  ruleset.value = deepClone(r)
  try {
    const exists = await FileExists(r.path)
    if (!exists && r.type === 'Manual') {
      rulesetContent.value = JSON.stringify(EmptyRuleSet, null, 2)
    } else {
      rulesetContent.value = await ReadFile(r.path)
    }
    ready.value = true
    resetBaseline()
  } catch (error: any) {
    loadError.value = error?.message || String(error)
    message.error(error)
  }
}

void initContent()

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
    <CodeEditor v-if="ready" v-model="rulesetContent" lang="json" editable class="h-full" />
    <div v-else-if="loadError" class="flex-1 flex flex-col items-center justify-center gap-12 p-16">
      <div class="text-13 text-danger text-center break-all" role="alert">{{ loadError }}</div>
      <Button type="primary" size="small" @click="initContent">{{ t('common.retry') }}</Button>
    </div>
    <div v-else class="flex-1 flex items-center justify-center">
      <Icon icon="loading" :size="24" class="rotation" />
    </div>
  </div>
</template>
