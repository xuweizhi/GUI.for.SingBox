<script lang="ts" setup>
import { computed, watch } from 'vue'

interface Props {
  total: number
  size?: 'default' | 'small' | 'large'
  pageSize?: number
}

const model = defineModel<number>('current', { default: 1 })
const props = withDefaults(defineProps<Props>(), { size: 'default', pageSize: 9 })

const pageNum = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
watch([model, pageNum], ([current, last]) => {
  const page = Math.min(last, Math.max(1, current))
  if (current !== page) model.value = page
}, { immediate: true })
const isFirstPage = computed(() => model.value <= 1)
const isLastPage = computed(() => model.value >= pageNum.value)

const range = (start: number, end: number) => {
  if (end < start) return []
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}

const pages = computed(() => {
  const total = pageNum.value
  const current = model.value
  if (total <= 8) return range(1, total)
  if (current <= 4) {
    return [...range(1, 7), 'next', total] as const
  } else if (current >= total - 3) {
    return [1, 'prev', ...range(total - 6, total)] as const
  } else {
    return [1, 'prev', ...range(current - 2, current + 2), 'next', total] as const
  }
})

const handlePrev = () => {
  if (!isFirstPage.value) model.value = Math.max(1, model.value - 1)
}
const handleNext = () => {
  if (!isLastPage.value) model.value = Math.min(pageNum.value, model.value + 1)
}
const handleJump = (page: number | 'prev' | 'next') => {
  if (typeof page === 'number') {
    model.value = page
    return
  }
  if (page === 'prev') {
    model.value = Math.max(1, model.value - 5)
  } else if (page === 'next') {
    model.value = Math.min(pageNum.value, model.value + 5)
  }
}
</script>

<template>
  <nav class="inline-flex items-center gap-2" aria-label="Pagination">
    <Button
      icon="arrowLeft"
      type="text"
      :size="size"
      :disabled="isFirstPage"
      :aria-label="$t('common.prevStep')"
      @click="handlePrev"
    />
    <Button v-if="pages.length === 0" type="text" :size="size" disabled> ... </Button>
    <Button
      v-for="item in pages"
      :key="item"
      :type="item === model ? 'primary' : 'text'"
      :size="size"
      :aria-current="item === model ? 'page' : undefined"
      class="min-w-32"
      @click="handleJump(item)"
    >
      {{ item === 'prev' || item === 'next' ? '...' : item }}
    </Button>
    <Button
      icon="arrowRight"
      type="text"
      :size="size"
      :disabled="isLastPage"
      :aria-label="$t('common.nextStep')"
      @click="handleNext"
    />
  </nav>
</template>
