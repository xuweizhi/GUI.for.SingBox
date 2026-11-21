<script setup lang="ts">
import logo from '@/assets/logo'
import { APP_TITLE, APP_VERSION } from '@/utils/env'
</script>

<template>
  <div class="h-full flex flex-col items-center justify-center p-16 text-center">
    <img :src="logo" class="w-128" draggable="false" />
    <div class="text-24 font-bold mt-16 mb-8">{{ APP_TITLE }}</div>
    <div class="py-8 text-muted">{{ APP_VERSION }}</div>
    <div class="mt-12">
      <slot></slot>
    </div>
  </div>
</template>
