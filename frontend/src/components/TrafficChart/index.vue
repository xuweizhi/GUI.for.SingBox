<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, onActivated, useTemplateRef } from 'vue'

import { formatBytes } from '@/utils'

interface Props {
  height?: number
  padding?: number
  legend?: string[]
  series: number[][]
}

const props = withDefaults(defineProps<Props>(), {
  height: undefined,
  padding: 64,
  legend: () => ['upload', 'download'],
})

const MAX_HISTORY = 60
const svgRef = useTemplateRef<SVGSVGElement>('svgRef')
const containerRef = useTemplateRef<HTMLElement>('containerRef')
const width = ref(320)
const points = ref<string[]>([])
const showLines = ref([true, true])
const hoverIndex = ref<number | null>(null)
const fillColors = ['rgba(136, 81, 227, 0.22)', 'rgba(46, 154, 229, 0.22)']
let resizeObserver: ResizeObserver | undefined

const strokeColors = computed(() => {
  const upload = showLines.value[0] ? '#8851e3' : 'var(--muted-color)'
  const download = showLines.value[1] ? '#2e9ae5' : 'var(--muted-color)'
  return [upload, download]
})

const normalizedSeries = computed(() =>
  props.series.map((s) => {
    const arr = [...s]
    if (arr.length < MAX_HISTORY) {
      arr.unshift(...Array.from({ length: MAX_HISTORY - arr.length }, () => 0))
    }
    return arr.slice(-MAX_HISTORY)
  }),
)

const maxValue = computed(() => {
  const maxUpload = Math.max(...(props.series[0] || []), 1024)
  const maxDownload = Math.max(...(props.series[1] || []), 1024)
  if (showLines.value[0] && showLines.value[1]) return Math.max(maxUpload, maxDownload)
  if (showLines.value[0]) return maxUpload
  if (showLines.value[1]) return maxDownload
  return 1024
})

const chartHeight = computed(() => props.height ?? Math.max(156, Math.min(280, width.value * 0.26)))
const plotHeight = computed(() => chartHeight.value - 20)
const plotTop = 10
const plotBottom = computed(() => chartHeight.value - 10)
const spacing = computed(() => Math.max(1, (width.value - props.padding - 8) / (MAX_HISTORY - 1)))

const updateSvgWidth = () => {
  const el = containerRef.value || svgRef.value
  if (el && el.clientWidth > 0) {
    width.value = el.clientWidth
    updateChart()
  }
}

const updateChart = () => {
  const { padding } = props
  const h = plotHeight.value
  points.value = normalizedSeries.value.map((newS, index) => {
    if (!showLines.value[index]) return ''
    const point = newS
      .map((c, i) => {
        const x = Math.round(i * spacing.value + padding)
        const y = Math.round(plotTop + h - (c / maxValue.value) * h)
        return `${x},${y}`
      })
      .join(' ')
    const startPos = `${padding},${plotBottom.value}`
    const endPos = `${Math.round((MAX_HISTORY - 1) * spacing.value + padding)},${plotBottom.value}`
    return `${startPos} ${point} ${endPos}`
  })
}

const hoveredData = computed(() => {
  if (hoverIndex.value === null) return null
  const idx = hoverIndex.value
  const up = normalizedSeries.value[0]?.[idx] ?? 0
  const down = normalizedSeries.value[1]?.[idx] ?? 0
  const x = Math.round(idx * spacing.value + props.padding)
  return { idx, up, down, x }
})

const onMouseMove = (event: MouseEvent) => {
  if (!svgRef.value) return
  const rect = svgRef.value.getBoundingClientRect()
  const relX = event.clientX - rect.left - props.padding
  if (relX < 0) {
    hoverIndex.value = null
    return
  }
  const idx = Math.round(relX / spacing.value)
  hoverIndex.value = Math.max(0, Math.min(MAX_HISTORY - 1, idx))
}

const onMouseLeave = () => {
  hoverIndex.value = null
}

const toggleUpload = () => {
  showLines.value[0] = !showLines.value[0]
  updateChart()
}

const toggleDownload = () => {
  showLines.value[1] = !showLines.value[1]
  updateChart()
}

const yTicks = computed(() => {
  const steps = 5
  return Array.from({ length: steps }, (_, i) => {
    const ratio = i / (steps - 1)
    return {
      y: Math.round(plotTop + ratio * plotHeight.value),
      label: `${formatBytes(maxValue.value * (1 - ratio))}/s`,
    }
  })
})

onMounted(() => {
  updateSvgWidth()
  if (typeof ResizeObserver !== 'undefined' && containerRef.value) {
    resizeObserver = new ResizeObserver(updateSvgWidth)
    resizeObserver.observe(containerRef.value)
  } else {
    window.addEventListener('resize', updateSvgWidth)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', updateSvgWidth)
})

onActivated(updateSvgWidth)

watch(() => props.series, updateChart, { deep: true })
</script>

<template>
  <div ref="containerRef" class="gui-traffic-chart rounded-12 p-12 relative">
    <div class="flex flex-wrap items-center justify-between gap-8 mb-8 text-12">
      <div class="flex items-center gap-12">
        <button
          type="button"
          class="traffic-legend-btn"
          :class="{ 'is-off': !showLines[0] }"
          @click="toggleUpload"
        >
          <span class="traffic-legend-dot" :style="{ background: strokeColors[0] }"></span>
          <span>{{ legend[0] }}</span>
        </button>
        <button
          type="button"
          class="traffic-legend-btn"
          :class="{ 'is-off': !showLines[1] }"
          @click="toggleDownload"
        >
          <span class="traffic-legend-dot" :style="{ background: strokeColors[1] }"></span>
          <span>{{ legend[1] }}</span>
        </button>
      </div>
      <div v-if="hoveredData" class="traffic-chart__readout flex items-center gap-12 font-mono">
        <span style="color: #8851e3">↑ {{ formatBytes(hoveredData.up) }}/s</span>
        <span style="color: #2e9ae5">↓ {{ formatBytes(hoveredData.down) }}/s</span>
      </div>
    </div>

    <svg
      ref="svgRef"
      :height="chartHeight"
      width="100%"
      xmlns="http://www.w3.org/2000/svg"
      @mousemove="onMouseMove"
      @mouseleave="onMouseLeave"
    >
      <template v-for="(tick, idx) in yTicks" :key="idx">
        <text :y="tick.y + 4" class="traffic-chart__axis-label" x="2" fill="var(--muted-color)">
          {{ tick.label }}
        </text>
        <line
          :y1="tick.y"
          :x2="width - 4"
          :y2="tick.y"
          :x1="padding"
          class="traffic-chart__grid-line"
          stroke-dasharray="3 4"
          stroke="var(--border-color)"
          stroke-opacity="0.8"
        />
      </template>

      <template v-for="(point, index) in points">
        <polyline
          v-if="showLines[index] && point"
          :key="index"
          :points="point"
          :stroke="strokeColors[index]"
          :fill="fillColors[index]"
          :class="index === 0 ? 'traffic-chart__series--upload' : 'traffic-chart__series--download'"
          stroke-width="2"
          stroke-linejoin="round"
        />
      </template>

      <line
        v-if="hoveredData"
        :x1="hoveredData.x"
        :x2="hoveredData.x"
        :y1="plotTop"
        :y2="plotBottom"
        stroke="var(--muted-color)"
        stroke-dasharray="2 2"
        stroke-opacity="0.65"
      />
    </svg>
  </div>
</template>

<style lang="less" scoped>
.gui-traffic-chart {
  background: var(--surface-bg);
  border: 1px solid var(--surface-border);
}

.traffic-chart__axis-label {
  font-size: 11px;
}

.traffic-legend-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color);
  font: inherit;
  cursor: pointer;
  transition:
    background-color 0.14s ease,
    opacity 0.14s ease;
  &:hover {
    background: var(--btn-text-hover-bg);
  }
  &.is-off {
    opacity: 0.45;
    text-decoration: line-through;
  }
}

.traffic-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex-shrink: 0;
}

.traffic-chart__readout {
  font-size: 12px;
  font-weight: 600;
}
</style>
