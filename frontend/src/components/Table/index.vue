<script lang="ts" setup>
import { ref, computed, isVNode, h } from 'vue'

import vMenu from '@/directives/menu'
import useI18n from '@/lang'
import { getValue } from '@/utils'

export type Column = {
  title: string
  key: string
  align?: 'center' | 'left' | 'right'
  hidden?: boolean
  minWidth?: string
  sort?: (a: Record<string, any>, b: Record<string, any>) => number
  customRender?: (v: { value: any; record: Record<string, any> }) => any
}

interface Props {
  menu?: App.Menu[]
  columns: Column[]
  dataSource: Record<string, any>[]
  sort?: string
}

const props = withDefaults(defineProps<Props>(), {
  menu: () => [],
  sort: undefined,
})

const sortField = ref(props.sort)
const sortReverse = ref(true)
const sortFunc = computed(
  () => props.columns.find((column) => column.key === sortField.value)?.sort,
)

const { t } = useI18n.global

const handleChangeSortField = (column: Column) => {
  if (!column.sort) return
  if (sortField.value === column.key) {
    if (sortReverse.value) {
      sortReverse.value = false
      return
    }
    sortField.value = ''
    sortReverse.value = true
    return
  }
  sortField.value = column.key
  sortReverse.value = true
}

const tableData = computed(() => {
  if (!sortField.value || !sortFunc.value) return props.dataSource
  const sorted = props.dataSource.slice().sort(sortFunc.value)
  if (sortReverse.value) sorted.reverse()
  return sorted
})

const tableColumns = computed(() => {
  return props.columns.filter((column) => !column.hidden)
})

const renderCell = (column: Column, record: Recordable) => {
  const value = getValue(record, column.key)
  let result = column.customRender?.({ value, record }) ?? value ?? '-'
  if (!isVNode(result)) {
    result = h('div', String(result))
  }
  return result
}
</script>

<template>
  <div class="gui-table overflow-auto rounded-8">
    <table class="w-full text-12 border-collapse">
      <thead>
        <tr class="sticky top-0 gui-table__head-row">
          <th
            v-for="column in tableColumns"
            :key="column.key"
            :class="{ 'cursor-pointer gui-table__th--sortable': !!column.sort }"
            class="px-8 py-10 whitespace-nowrap"
            @click="handleChangeSortField(column)"
          >
            <div
              :style="{
                justifyContent: { left: 'flex-start', center: 'center', right: 'flex-end' }[
                  column.align || 'left'
                ],
                minWidth: column.minWidth || 'auto',
              }"
              class="flex items-center gap-4"
            >
              <span>{{ t(column.title) }}</span>
              <span v-if="column.sort" class="gui-table__sort-icon" aria-hidden="true">
                <template v-if="sortField === column.key">
                  {{ sortReverse ? '↓' : '↑' }}
                </template>
                <template v-else>⇅</template>
              </span>
            </div>
          </th>
        </tr>
      </thead>
      <tbody v-if="tableData.length">
        <tr
          v-for="record in tableData"
          :key="record.id"
          v-menu="menu.map((v) => ({ ...v, handler: () => v.handler?.(record) }))"
          class="transition duration-200"
        >
          <td
            v-for="column in tableColumns"
            :key="column.key"
            :style="{ textAlign: column.align || 'left' }"
            class="select-text whitespace-nowrap p-8"
          >
            <slot :name="column.key" :="{ column, record }">
              <component :is="renderCell(column, record)" />
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="tableData.length === 0" class="py-32">
      <Empty :icon-size="48" />
    </div>
  </div>
</template>

<style lang="less" scoped>
.gui-table {
  border: 1px solid var(--surface-border, var(--border-color));
  border-radius: var(--card-radius, 12px);
  background: var(--surface-bg, var(--card-bg));
  box-shadow: var(--card-shadow);
  backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
  -webkit-backdrop-filter: blur(var(--surface-blur, 0px)) saturate(var(--surface-saturate, 100%));
}

.gui-table__head-row {
  z-index: 1;
  background: var(--table-tr-even-bg);
  border-bottom: 1px solid var(--border-color);
}

.gui-table__th--sortable:hover {
  color: var(--accent-text);
}

.gui-table__sort-icon {
  font-size: 11px;
  color: var(--muted-color);
}

table {
  tbody {
    tr {
      &:nth-child(odd) {
        background: var(--table-tr-odd-bg);
        &:hover {
          background: var(--table-tr-odd-hover-bg);
        }
      }
      &:nth-child(even) {
        background: var(--table-tr-even-bg);
        &:hover {
          background: var(--table-tr-even-hover-bg);
        }
      }
    }
  }
}
</style>
