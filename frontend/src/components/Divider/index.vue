<script setup lang="ts">
defineProps<{ size?: 'small' | 'default' }>()
</script>
<template>
  <div
    role="separator"
    class="gui-divider flex items-center w-full"
    :class="size === 'small' ? 'my-4' : 'my-12'"
  >
    <span v-if="$slots.default" class="gui-divider__content text-12 px-8"><slot /></span>
  </div>
</template>
<style scoped>
.gui-divider::before,
.gui-divider:has(span)::after {
  content: '';
  flex: 1;
  border-top: 1px solid var(--divider-color);
}
</style>
