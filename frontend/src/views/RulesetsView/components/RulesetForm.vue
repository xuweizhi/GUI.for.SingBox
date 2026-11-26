<script setup lang="ts">
import { ref, inject, watch, h } from 'vue'
import { useI18n } from 'vue-i18n'

import { RulesetFormatOptions } from '@/constant/kernel'
import { RulesetFormat } from '@/enums/kernel'
import { useFormDraft } from '@/hooks/useFormDraft'
import { useRulesetsStore } from '@/stores'
import { deepClone, message, sampleID } from '@/utils'

import Button from '@/components/Button/index.vue'

interface Props {
  id?: string
  isUpdate?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  id: '',
  isUpdate: false,
})

const loading = ref(false)

const ruleset = ref<App.RuleSet>({
  id: sampleID(),
  name: '',
  updateTime: 0,
  format: RulesetFormat.Binary,
  type: 'Http',
  url: '',
  count: 0,
  path: `data/rulesets/${sampleID()}.srs`,
  disabled: false,
})

const { t } = useI18n()
const rulesetsStore = useRulesetsStore()

const finishSave = inject<() => Promise<void>>('submit')
const handleCancel = inject('cancel') as any

const handleSubmit = async () => {
  if (loading.value) return
  errorField.value = ''
  if (!ruleset.value.name.trim()) {
    return invalid('name')
  }
  if (ruleset.value.type !== 'Manual' && !ruleset.value.url.trim()) {
    return invalid('url')
  }
  if (!ruleset.value.path.trim()) {
    return invalid('path')
  }
  loading.value = true

  try {
    if (props.isUpdate) {
      await rulesetsStore.editRuleset(props.id, ruleset.value)
    } else {
      await rulesetsStore.addRuleset(ruleset.value)
    }
    await finishSave?.()
  } catch (error: any) {
    console.error(props.isUpdate ? 'editRuleset: ' : 'addRuleset: ', error)
    message.error(error)
  } finally {
    loading.value = false
  }
}

if (props.isUpdate) {
  const r = rulesetsStore.getRulesetById(props.id)
  if (r) {
    ruleset.value = deepClone(r)
  }
}

watch(
  () => ruleset.value.type,
  (v) => {
    if (v === 'Manual') {
      ruleset.value.format = RulesetFormat.Source
    }
  },
)

watch(
  () => ruleset.value.format,
  (v, old) => {
    const isJson = v === RulesetFormat.Source
    if (!isJson && ruleset.value.type === 'Manual') {
      ruleset.value.format = old
      message.error('Not support')
      return
    }
    ruleset.value.path = ruleset.value.path.replace(
      isJson ? /\.srs$/i : /\.json$/i,
      isJson ? '.json' : '.srs',
    )
  },
)

const { errorField, errorMessage, invalid } = useFormDraft(() => ruleset.value)
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
        onClick: handleSubmit,
      },
      () => t('common.save'),
    ),
}

defineExpose({ modalSlots })
</script>

<template>
  <div ref="formRoot" class="resource-form">
    <div class="form-item">
      {{ t('ruleset.rulesetType') }}
      <Radio
        v-model="ruleset.type"
        :options="[
          { label: 'common.http', value: 'Http' },
          { label: 'common.file', value: 'File' },
          { label: 'ruleset.manual', value: 'Manual' },
        ]"
      />
    </div>
    <div v-show="ruleset.type !== 'Manual'" class="form-item">
      {{ t('ruleset.format.name') }}
      <Radio v-model="ruleset.format" :options="RulesetFormatOptions" />
    </div>
    <div class="form-item" :data-invalid="errorField === 'name'">
      {{ t('ruleset.name') }} *
      <div class="w-full">
        <Input v-model="ruleset.name" autofocus class="w-full" />
        <small v-if="errorField === 'name'" class="field-error" role="alert">{{
          errorMessage
        }}</small>
      </div>
    </div>
    <div v-show="ruleset.type !== 'Manual'" class="form-item" :data-invalid="errorField === 'url'">
      {{ t('ruleset.url') }} *
      <div class="w-full">
        <Input
          v-model="ruleset.url"
          allow-paste
          :placeholder="
            ruleset.type === 'Http'
              ? 'http(s)://'
              : 'data/local/{filename}.' +
                (ruleset.format === RulesetFormat.Binary ? 'srs' : 'json')
          "
          class="w-full"
        />
        <small v-if="errorField === 'url'" class="field-error" role="alert">{{
          errorMessage
        }}</small>
      </div>
    </div>
    <div class="form-item" :data-invalid="errorField === 'path'">
      {{ t('ruleset.path') }} *
      <div class="w-full">
        <Input
          v-model="ruleset.path"
          :placeholder="`data/rulesets/{filename}.${ruleset.format === RulesetFormat.Binary ? 'srs' : 'json'}`"
          class="w-full"
        />
        <small v-if="errorField === 'path'" class="field-error" role="alert">{{
          errorMessage
        }}</small>
      </div>
    </div>
  </div>
</template>
