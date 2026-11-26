<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, onActivated, useTemplateRef } from 'vue'

import { formatBytes } from '@/utils'

interface Props {
  height?: number
  padding?: number
  legend?: string[]
  series: number[][]
}

const props = withDefaults(defineProps<Props>(), {
  height: undefined,
  padding: 72,
  legend: () => ['upload', 'download'],
})

const MAX_HISTORY = 60
const svgRef = useTemplateRef<SVGSVGElement>('svgRef')
const width = ref(320)
const showLines = ref([true, true])
const hoverIndex = ref<number | null>(null)
const fillColors = ['rgba(139, 92, 246, 0.2)', 'rgba(14, 165, 233, 0.2)']
let resizeObserver: ResizeObserver | undefined

const strokeColors = computed(() => {
  const upload = showLines.value[0] ? '#8b5cf6' : 'var(--muted-color)'
  const download = showLines.value[1] ? '#0ea5e9' : 'var(--muted-color)'
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
  const maxUpload = Math.max(...(normalizedSeries.value[0] || []), 1024)
  const maxDownload = Math.max(...(normalizedSeries.value[1] || []), 1024)
  if (showLines.value[0] && showLines.value[1]) return Math.max(maxUpload, maxDownload)
  if (showLines.value[0]) return maxUpload
  if (showLines.value[1]) return maxDownload
  return 1024
})

const chartHeight = computed(() => props.height ?? Math.max(156, Math.min(280, width.value * 0.26)))
const plotHeight = computed(() => chartHeight.value - 20)
const plotTop = 10
const plotBottom = computed(() => chartHeight.value - 10)
const rightPad = 6
const spacing = computed(() =>
  Math.max(1, (width.value - props.padding - rightPad) / (MAX_HISTORY - 1)),
)

const updateSvgWidth = () => {
  const el = svgRef.value
  if (!el) return
  const nextWidth = Math.floor(el.getBoundingClientRect().width || el.clientWidth)
  if (nextWidth > 0) width.value = nextWidth
}

const seriesGeometry = computed(() => {
  const { padding } = props
  const h = plotHeight.value
  const endX = Math.round((MAX_HISTORY - 1) * spacing.value + padding)
  return normalizedSeries.value.map((newS, index) => {
    if (!showLines.value[index]) return { line: '', area: '' }
    const line = newS
      .map((c, i) => {
        const x = Math.round(i * spacing.value + padding)
        const y = Math.round(plotTop + h - (c / maxValue.value) * h)
        return `${x},${y}`
      })
      .join(' ')
    const area = `${padding},${plotBottom.value} ${line} ${endX},${plotBottom.value}`
    return { line, area }
  })
})

const hoveredData = computed(() => {
  if (hoverIndex.value === null) return null
  const idx = hoverIndex.value
  const up = normalizedSeries.value[0]?.[idx] ?? 0
  const down = normalizedSeries.value[1]?.[idx] ?? 0
  const x = Math.round(idx * spacing.value + props.padding)
  return { idx, up, down, x }
})

const onPointerMove = (event: PointerEvent) => {
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

const onPointerLeave = () => {
  hoverIndex.value = null
}

const toggleUpload = () => {
  showLines.value[0] = !showLines.value[0]
}

const toggleDownload = () => {
  showLines.value[1] = !showLines.value[1]
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
  if (typeof ResizeObserver !== 'undefined' && svgRef.value) {
    resizeObserver = new ResizeObserver(updateSvgWidth)
    resizeObserver.observe(svgRef.value)
  } else {
    window.addEventListener('resize', updateSvgWidth)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', updateSvgWidth)
})

onActivated(updateSvgWidth)
</script>

<template>
  <div class="gui-traffic-chart rounded-12 p-12 relative">
    <div class="traffic-chart__header flex flex-wrap items-center justify-between gap-8 mb-8 text-12">
      <div class="flex items-center gap-12">
        <button
          type="button"
          class="traffic-legend-btn"
          :class="{ 'is-off': !showLines[0] }"
          :aria-pressed="showLines[0]"
          @click="toggleUpload"
        >
          <span class="traffic-legend-dot" :style="{ background: strokeColors[0] }"></span>
          <span>{{ legend[0] }}</span>
        </button>
        <button
          type="button"
          class="traffic-legend-btn"
          :class="{ 'is-off': !showLines[1] }"
          :aria-pressed="showLines[1]"
          @click="toggleDownload"
        >
          <span class="traffic-legend-dot" :style="{ background: strokeColors[1] }"></span>
          <span>{{ legend[1] }}</span>
        </button>
      </div>
      <div
        class="traffic-chart__readout flex items-center gap-12 font-mono"
        :style="{ visibility: hoveredData ? 'visible' : 'hidden' }"
      >
        <span class="traffic-readout--upload">↑ {{ formatBytes(hoveredData?.up ?? 0) }}/s</span>
        <span class="traffic-readout--download">↓ {{ formatBytes(hoveredData?.down ?? 0) }}/s</span>
      </div>
    </div>

    <svg
      ref="svgRef"
      role="img"
      :aria-label="legend.join(' / ')"
      :height="chartHeight"
      width="100%"
      class="block"
      xmlns="http://www.w3.org/2000/svg"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
    >
      <template v-for="(tick, idx) in yTicks" :key="idx">
        <text :y="tick.y + 4" class="traffic-chart__axis-label" x="2" fill="var(--muted-color)">
          {{ tick.label }}
        </text>
        <line
          :y1="tick.y"
          :x2="Math.max(padding, width - rightPad)"
          :y2="tick.y"
          :x1="padding"
          class="traffic-chart__grid-line"
          stroke-dasharray="3 4"
          stroke="var(--border-color)"
          stroke-opacity="0.8"
        />
      </template>

      <template v-for="(geom, index) in seriesGeometry" :key="index">
        <polygon
          v-if="showLines[index] && geom.area"
          :points="geom.area"
          :fill="fillColors[index]"
          stroke="none"
        />
        <polyline
          v-if="showLines[index] && geom.line"
          :points="geom.line"
          :stroke="strokeColors[index]"
          fill="none"
          :class="index === 0 ? 'traffic-chart__series--upload' : 'traffic-chart__series--download'"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
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

.traffic-chart__header {
  min-height: 24px;
}

.traffic-chart__axis-label {
  font-size: calc(11px * var(--font-scale, 1));
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
  font-size: calc(12px * var(--font-scale, 1));
  font-weight: 600;
}

.traffic-readout--upload {
  color: #a78bfa;
}
:global(body[theme-mode='light']) .traffic-readout--upload {
  color: #7c3aed;
}

.traffic-readout--download {
  color: #38bdf8;
}
:global(body[theme-mode='light']) .traffic-readout--download {
  color: #0284c7;
}
</style>
