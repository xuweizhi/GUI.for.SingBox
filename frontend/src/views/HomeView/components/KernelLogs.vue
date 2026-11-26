<script setup lang="ts">
import LogsController from './LogsController.vue'
defineProps<{ inline?: boolean }>()
</script>
<template><LogsController initial-source="core" /></template>
