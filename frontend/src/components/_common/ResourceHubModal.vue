<script setup lang="ts">
defineProps<{ categories: string[]; loading: boolean; count: number }>()
const emit = defineEmits<{ refresh: [] }>()
const query = defineModel<string>('query', { required: true })
const category = defineModel<string>('category', { required: true })
const clearFilters = () => {
  query.value = ''
  category.value = ''
}
</script>
<template>
  <section class="hub">
    <div class="hub-toolbar flex flex-wrap items-center gap-8">
      <Input v-model="query" class="flex-1" clearable :placeholder="$t('common.search')" />
      <Select
        v-model="category"
        :options="[
          { label: 'workspace.all', value: '' },
          ...categories.map((c) => ({ label: c, value: c })),
        ]"
      />
      <Button
        icon="refresh"
        size="small"
        :loading="loading"
        :aria-label="$t('common.refresh')"
        @click="emit('refresh')"
      />
      <slot name="actions" />
    </div>
    <div v-if="count" class="hub-results"><slot /></div>
    <Empty v-else-if="!loading"
      ><template #description>
        <template v-if="query.trim() || category"
          >{{ $t('workspace.noMatches', [query.trim() || category]) }}
          <Button
            type="link"
            @click="clearFilters"
            >{{ $t('workspace.clearFilters') }}</Button
          >
        </template>
        <Button v-else type="link" @click="emit('refresh')">{{ $t('common.refresh') }}</Button>
      </template></Empty
    >
  </section>
</template>
<style scoped>
.hub {
  min-height: 0;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hub-toolbar {
  flex-shrink: 0;
}
.hub-results {
  overflow: auto;
  min-height: 0;
}
</style>
