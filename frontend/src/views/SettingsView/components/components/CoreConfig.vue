<script lang="ts" setup>
import { h, inject, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useI18n } from 'vue-i18n'

import { DraggableOptions } from '@/constant/app'
import { DefaultCoreConfig } from '@/constant/kernel'
import { Branch } from '@/enums/app'
import { useFormDraft } from '@/hooks/useFormDraft'
import { useAppSettingsStore, useKernelApiStore } from '@/stores'
import { deepClone, message, processMagicVariables } from '@/utils'

import Button from '@/components/Button/index.vue'

interface Props {
  isAlpha: boolean
}

const props = defineProps<Props>()

const tabs = [
  { tab: 'settings.kernel.config.env', key: 'env' },
  { tab: 'settings.kernel.config.args', key: 'args' },
]

const activeKey = ref('env')
const handleCancel = inject('cancel') as any
const handleSubmit = inject('submit') as any

const { t } = useI18n()
const appSettings = useAppSettingsStore()
const kernelApiStore = useKernelApiStore()

const source = props.isAlpha ? appSettings.app.kernel.alpha : appSettings.app.kernel.main

const model = ref(deepClone(source))
const { isDirty } = useFormDraft(() => model.value)

const handleSave = () => {
  const changed = isDirty()
  Object.assign(source, deepClone(model.value))
  if (
    changed &&
    kernelApiStore.running &&
    (appSettings.app.kernel.branch === Branch.Alpha) === props.isAlpha
  ) {
    kernelApiStore.needRestart = true
  }
  message.success('common.success')
  handleSubmit()
}

const modalSlots = {
  action: () =>
    h(
      Button,
      {
        type: 'link',
        class: 'mr-auto',
        onClick: () => {
          const { env, args } = DefaultCoreConfig()
          model.value.env = env
          model.value.args = args
        },
      },
      () => t('common.reset'),
    ),
  cancel: () =>
    h(
      Button,
      {
        onClick: handleCancel,
      },
      () => t('common.cancel'),
    ),
  submit: () =>
    h(
      Button,
      {
        type: 'primary',
        onClick: handleSave,
      },
      () => t('common.save'),
    ),
}

defineExpose({ modalSlots })
</script>

<template>
  <div ref="formRoot">
    <Tabs v-model:active-key="activeKey" :items="tabs">
      <template #env>
        <Empty v-if="Object.keys(model.env).length === 0" />
        <Card v-else :title="t('common.preview')">
          <div class="flex flex-col gap-6">
            <div
              v-for="[key, value] in Object.entries(model.env)"
              :key="key"
              class="env-preview-row"
            >
              <Tag class="env-preview-cell">
                <div class="h-full flex items-center py-2 break-all whitespace-pre-wrap">
                  {{ key }}
                </div>
              </Tag>
              <span class="self-center text-muted">:</span>
              <Tag class="env-preview-cell">
                <div class="h-full flex items-center py-2 break-all whitespace-pre-wrap">
                  {{ processMagicVariables(value) }}
                </div>
              </Tag>
            </div>
          </div>
        </Card>
        <KeyValueEditor v-model="model.env" class="mt-16" />
      </template>

      <template #args>
        <Empty v-if="model.args.length === 0" />
        <Card v-else :title="t('common.preview')">
          <VueDraggable
            v-model="model.args"
            v-bind="DraggableOptions"
            class="flex flex-wrap items-center gap-6"
          >
            <div v-for="(item, index) in model.args" :key="index">
              <Tag size="small">
                <div class="py-2 break-all whitespace-pre-wrap">
                  {{ processMagicVariables(item) }}
                </div>
              </Tag>
            </div>
          </VueDraggable>
        </Card>
        <InputList v-model="model.args" class="mt-16" />
      </template>
    </Tabs>
  </div>
</template>

<style scoped>
.env-preview-row {
  display: grid;
  grid-template-columns: minmax(90px, 1fr) auto minmax(0, 2.5fr);
  gap: 6px;
  align-items: stretch;
}
.env-preview-cell {
  margin: 0;
  min-width: 0;
}
</style>
