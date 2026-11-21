<script lang="ts" setup>
import { ref, watch } from 'vue'

interface Props {
  modelValue?: Recordable
  placeholder?: [string, string]
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: () => ({}),
  placeholder: () => ['key', 'value'],
})

const emit = defineEmits(['change', 'update:modelValue'])

const entries = ref<[string, string][]>(
  Object.entries(props.modelValue).map(([k, v]) => [k, String(v ?? '')]),
)

const handleDel = (i: number) => {
  entries.value.splice(i, 1)
  emitUpdate()
}

const handleAdd = () => {
  entries.value.push(['', ''])
  emitUpdate()
}

let internalUpdate = false

watch(
  () => props.modelValue,
  (val) => {
    if (!internalUpdate) {
      entries.value = Object.entries(val).map(([k, v]) => [k, String(v ?? '')])
    }
    internalUpdate = false
  },
  { deep: true },
)

const emitUpdate = () => {
  const obj = Object.fromEntries(entries.value)
  internalUpdate = true
  emit('update:modelValue', obj)
  emit('change', obj)
}
</script>

<template>
  <div class="gui-kv-editor inline-flex flex-col gap-6">
    <div v-for="(entry, i) in entries" :key="i" class="flex items-center gap-6">
      <Input
        v-model="entry[0]"
        :placeholder="placeholder[0]"
        auto-size
        class="flex-1"
        @change="emitUpdate"
        @submit="emitUpdate"
      />
      <span class="text-muted text-12 shrink-0" aria-hidden="true">:</span>
      <Input
        v-model="entry[1]"
        :placeholder="placeholder[1]"
        auto-size
        class="flex-1"
        @change="emitUpdate"
        @submit="emitUpdate"
      />
      <Button
        type="text"
        size="small"
        :icon-size="14"
        icon="delete"
        :aria-label="$t('common.delete')"
        class="shrink-0 text-danger"
        @click="handleDel(i)"
      />
    </div>
    <Button type="normal" size="small" icon="add" :aria-label="$t('common.add')" @click="handleAdd">
      {{ $t('common.add') }}
    </Button>
  </div>
</template>

<style lang="less" scoped>
.gui-kv-editor {
  width: 440px;
  max-width: 100%;
  min-width: 0;
}
</style>
