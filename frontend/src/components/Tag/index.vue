<script setup lang="ts">
import { ref } from 'vue'

interface Props {
  color?: 'cyan' | 'green' | 'red' | 'default' | 'primary' | 'orange' | 'gold' | 'blue' | 'purple'
  size?: 'small' | 'default'
  closeable?: boolean
  bordered?: boolean
}

withDefaults(defineProps<Props>(), {
  color: 'default',
  closeable: false,
  size: 'default',
  bordered: true,
})

const emit = defineEmits(['close'])

const show = ref(true)
const handleClose = () => {
  emit('close')
  show.value = false
}
</script>

<template>
  <div
    v-if="show"
    :class="['color-' + color, 'size-' + size, { 'border-0': !bordered }]"
    class="gui-tag px-8 mx-4 rounded-6 text-12 whitespace-nowrap inline-flex items-center"
  >
    <slot></slot>
    <Icon
      v-if="closeable"
      :size="size === 'small' ? 12 : 14"
      icon="close"
      color="currentColor"
      class="ml-4 cursor-pointer"
      @click.stop="handleClose"
    />
  </div>
</template>

<style lang="less" scoped>
.gui-tag {
  line-height: 1.5;
  font-weight: 500;
}

.color-cyan {
  color: var(--tag-cyan-color);
  background-color: var(--tag-cyan-bg);
  border: 1px solid var(--tag-cyan-border);
}
.color-green {
  color: var(--tag-green-color);
  background-color: var(--tag-green-bg);
  border: 1px solid var(--tag-green-border);
}
.color-red {
  color: var(--tag-red-color);
  background-color: var(--tag-red-bg);
  border: 1px solid var(--tag-red-border);
}
.color-default {
  color: var(--tag-default-color);
  background-color: var(--tag-default-bg);
  border: 1px solid var(--tag-default-border);
}
.color-primary {
  color: var(--btn-primary-color);
  background-color: var(--primary-color);
  border: 1px solid var(--primary-color);
}
.color-orange {
  color: var(--tag-orange-color);
  background-color: var(--tag-orange-bg);
  border: 1px solid var(--tag-orange-border);
}
.color-gold {
  color: var(--tag-gold-color);
  background-color: var(--tag-gold-bg);
  border: 1px solid var(--tag-gold-border);
}
.color-blue {
  color: var(--tag-blue-color);
  background-color: var(--tag-blue-bg);
  border: 1px solid var(--tag-blue-border);
}
.color-purple {
  color: var(--tag-purple-color);
  background-color: var(--tag-purple-bg);
  border: 1px solid var(--tag-purple-border);
}

.size-small {
  padding: 1px 6px;
  margin: 0 2px;
  font-size: calc(11px * var(--font-scale, 1));
  line-height: 1.4;
}
</style>
