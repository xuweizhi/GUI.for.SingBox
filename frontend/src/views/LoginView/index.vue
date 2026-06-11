<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import { useWebuiAuthStore } from '@/stores'
import { message } from '@/utils'
import { resolveRedirectTarget } from '@/utils/webuiAuth'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const authStore = useWebuiAuthStore()

const input = ref(authStore.token)
const loading = computed(() => authStore.status === 'checking')

const submit = async () => {
  if (!input.value.trim()) return

  try {
    const ok = await authStore.verifyToken(input.value)
    if (!ok) {
      message.error('auth.invalidToken')
      return
    }

    const redirect = resolveRedirectTarget(route.query.redirect as string | undefined)
    await router.replace(redirect)
  } catch (error) {
    message.error(error)
  }
}
</script>

<template>
  <div class="login-view min-h-full flex items-center justify-center px-16">
    <Card class="login-card w-full py-24 px-16">
      <div class="text-24 font-bold">{{ t('auth.title') }}</div>
      <div class="text-14 opacity-70 mt-8">{{ t('auth.description') }}</div>

      <Input
        v-model="input"
        placeholder="auth.tokenPlaceholder"
        autofocus
        class="mt-20 w-full"
        @submit="submit"
      />

      <div v-if="authStore.lastError" class="text-12 mt-12" style="color: var(--error-color)">
        {{ t(authStore.lastError) }}
      </div>

      <Button type="primary" class="mt-20 w-full justify-center" :loading="loading" @click="submit">
        {{ t('auth.submit') }}
      </Button>
    </Card>
  </div>
</template>

<style lang="less" scoped>
.login-view {
  background:
    radial-gradient(circle at top, color-mix(in srgb, var(--primary-color) 12%, transparent), transparent 38%),
    linear-gradient(180deg, color-mix(in srgb, var(--card-bg) 70%, transparent), transparent);
}

.login-card {
  max-width: 420px;
}
</style>
