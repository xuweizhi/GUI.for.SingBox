<script lang="ts" setup>
import { ref, computed, isVNode, h, onMounted, onUnmounted, useTemplateRef } from 'vue'

import vMenu from '@/directives/menu'
import useI18n from '@/lang'
import { getValue } from '@/utils'

export type Column = {
  title: string
  key: string
  align?: 'center' | 'left' | 'right'
  fixed?: 'right'
  ellipsis?: boolean
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
const emit = defineEmits<{ 'row-click': [record: Recordable] }>()
const handleRowClick = (event: MouseEvent, record: Recordable) => {
  const target = event.target as Element | null
  if (
    target?.closest(
      'button, a, input, select, textarea, [role="button"], [role="menuitem"], .gui-dropdown',
    )
  )
    return
  emit('row-click', record)
}

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
    result = h('div', { class: 'cell-ellipsis__inner' }, String(result))
  }
  return result
}
const cellTitle = (column: Column, record: Recordable) => {
  if (!column.ellipsis) return undefined
  const value = getValue(record, column.key)
  const result = column.customRender?.({ value, record }) ?? value
  return typeof result === 'string' || typeof result === 'number' ? String(result) : undefined
}
const hasFixedRight = computed(() => tableColumns.value.some((column) => column.fixed === 'right'))
const viewport = useTemplateRef<HTMLElement>('viewport')
const table = useTemplateRef<HTMLElement>('table')
const canScrollLeft = ref(false)
const canScrollRight = ref(false)
const updateEdges = () => {
  const el = viewport.value
  if (!el) return
  canScrollLeft.value = el.scrollLeft > 1
  canScrollRight.value = el.scrollWidth - el.clientWidth - el.scrollLeft > 1
}
let observer: ResizeObserver | undefined
onMounted(() => {
  if (typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(updateEdges)
  if (viewport.value) observer.observe(viewport.value)
  if (table.value) observer.observe(table.value)
})
onUnmounted(() => observer?.disconnect())
</script>

<template>
  <div
    class="gui-table rounded-8"
    :class="{
      'scroll-left': canScrollLeft,
      'scroll-right': canScrollRight,
      'has-fixed-right': hasFixedRight,
    }"
  >
    <div ref="viewport" class="table-viewport overflow-auto" @scroll.passive="updateEdges">
      <table ref="table" class="w-full text-12 border-collapse">
        <thead>
          <tr class="sticky top-0 gui-table__head-row">
            <th
              v-for="column in tableColumns"
              :key="column.key"
              :aria-sort="
                column.sort
                  ? sortField === column.key
                    ? sortReverse
                      ? 'descending'
                      : 'ascending'
                    : 'none'
                  : undefined
              "
              :tabindex="column.sort ? 0 : undefined"
              :class="{
                'fixed-right': column.fixed,
                'cursor-pointer gui-table__th--sortable': !!column.sort,
              }"
              class="px-8 py-10 whitespace-nowrap"
              @keydown.enter.prevent="handleChangeSortField(column)"
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
            class="transition-all duration-200"
            @click="handleRowClick($event, record)"
          >
            <td
              v-for="column in tableColumns"
              :key="column.key"
              :style="{ textAlign: column.align || 'left' }"
              class="select-text p-8"
              :class="{ 'fixed-right': column.fixed, 'cell-ellipsis': column.ellipsis }"
              :title="cellTitle(column, record)"
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
  </div>
</template>

<style lang="less" scoped>
.gui-table {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
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

  th.fixed-right {
    z-index: 3;
  }
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
        --row-bg: var(--table-tr-odd-bg);
        --row-hover-bg: var(--table-tr-odd-hover-bg);
        background: var(--row-bg);
        &:hover {
          --row-bg: var(--row-hover-bg);
          background: var(--row-bg);
        }
      }
      &:nth-child(even) {
        --row-bg: var(--table-tr-even-bg);
        --row-hover-bg: var(--table-tr-even-hover-bg);
        background: var(--row-bg);
        &:hover {
          --row-bg: var(--row-hover-bg);
          background: var(--row-bg);
        }
      }
    }
  }
}
.fixed-right {
  position: sticky;
  right: 0;
  z-index: 2;
  background: var(--row-bg, var(--table-tr-even-bg));
}
.scroll-right .fixed-right {
  box-shadow: -6px 0 10px -4px rgba(0, 0, 0, 0.16);
}
.cell-ellipsis {
  max-width: 22em;
  overflow: hidden;
  white-space: nowrap;
}
.cell-ellipsis__inner {
  max-width: 22em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.table-viewport {
  min-height: 0;
  border-radius: inherit;
}
.gui-table::before,
.gui-table::after {
  position: absolute;
  inset-block: 0;
  width: 10px;
  z-index: 2;
  pointer-events: none;
}
.scroll-left::before {
  content: '';
  left: 0;
  background: linear-gradient(to right, var(--surface-border), transparent);
}
.scroll-right::after {
  content: '';
  right: 0;
  background: linear-gradient(to left, var(--surface-border), transparent);
}
.has-fixed-right.scroll-right::after {
  display: none;
}
</style>
