<script setup lang="ts">
import { ViewOptions } from '@/constant/app'
defineProps<{ total: number; count: number; filters: { label: string; value: string }[] }>()
const view = defineModel<App.View>('view', { required: true })
const query = defineModel<string>('query', { required: true })
const filter = defineModel<string>('filter', { required: true })
const sort = defineModel<string>('sort', { required: true })
const clearFilters = () => {
  query.value = ''
  filter.value = ''
}
</script>
<template>
  <div class="grid-list-header">
    <Radio v-model="view" :options="ViewOptions" size="small" />
    <span class="resource-count-badge">{{ count === total ? total : count + ' / ' + total }}</span>
    <Input
      v-model="query"
      clearable
      size="small"
      :placeholder="$t('common.search')"
      class="resource-search"
    />
    <Select
      v-if="filters.length"
      v-model="filter"
      :options="[{ label: 'workspace.all', value: '' }, ...filters]"
      size="small"
    />
    <Select
      v-model="sort"
      :options="[
        { label: 'workspace.manual', value: 'manual' },
        { label: 'workspace.byName', value: 'name' },
      ]"
      size="small"
    />
    <div class="ml-auto flex flex-wrap items-center gap-6"><slot /></div>
  </div>
  <Empty v-if="total && !count"
    ><template #description>
      <div>
        {{
          $t('workspace.noMatches', [
            query.trim() || $t(filters.find((o) => o.value === filter)?.label || 'workspace.all'),
          ])
        }}
      </div>
      <Button
        type="link"
        @click="clearFilters"
        >{{ $t('workspace.clearFilters') }}</Button
      >
    </template></Empty
  >
</template>
