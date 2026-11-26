<script lang="ts" setup>
import { ref, watch } from 'vue'

import { deepClone, message } from '@/utils'

interface Props {
  plugin: App.Plugin
  modelValue?: Recordable
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: () => ({}),
})

const emit = defineEmits(['change', 'update:modelValue'])

const model = ref(deepClone(props.modelValue ?? {}))

watch(
  () => props.modelValue,
  (val) => {
    model.value = deepClone(val ?? {})
  },
  { deep: true },
)

const getOptions = (val: string[]) => {
  return val.map((v) => {
    const arr = v.split(',')
    return { label: arr[0], value: arr[1] || arr[0] }
  })
}

const emitUpdate = () => {
  const val = deepClone(model.value)
  emit('update:modelValue', val)
  emit('change', val)
}

const onChange = (key: string, originalValue: any, value: any) => {
  // TODO: array order
  if (JSON.stringify(originalValue) === JSON.stringify(value)) {
    delete model.value[key]
  } else {
    model.value[key] = value
  }
  emitUpdate()
}

const handleReset = (key: string) => {
  delete model.value[key]
  emitUpdate()
}

const handleResetAll = () => {
  model.value = {}
  emitUpdate()
  message.success('common.success')
}

defineExpose({ reset: handleResetAll })
</script>

<template>
  <div class="flex flex-col gap-8 pr-8">
    <slot name="header" v-bind="{ handleResetAll }"></slot>
    <Card
      ><div
        v-for="conf in plugin.configuration"
        :key="conf.id"
        class="settings-row"
        :class="{
          'code-row': ['CodeViewer', 'CodeEditor', 'KeyValueEditor', 'InputList'].includes(
            conf.component as string,
          ),
        }"
      >
        <div>
          <div class="flex items-start justify-between gap-8">
            <div class="min-w-0">
              <strong>{{ conf.title }}</strong>
              <p class="text-12 text-secondary">{{ conf.description }}</p>
            </div>
            <Button
              v-if="model[conf.key] !== undefined"
              class="shrink-0"
              :aria-label="$t('settings.plugin.resetSetting')"
              icon="reset"
              type="text"
              size="small"
              @click="handleReset(conf.key)"
            />
          </div>
        </div>
        <div class="field-control flex w-full min-w-0 items-center gap-6">
          <Component
            :is="(conf.component as any) === 'CodeViewer' ? 'CodeEditor' : conf.component"
            :model-value="model[conf.key] ?? conf.value"
            :options="getOptions(conf.options)"
            :autofocus="false"
            editable
            lang="yaml"
            @update:model-value="(val: any) => onChange(conf.key, conf.value, val)"
          />
        </div></div
    ></Card>
  </div>
</template>

<style scoped>
.field-control {
  min-width: 0;
}
.code-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
.code-row .field-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
</style>
