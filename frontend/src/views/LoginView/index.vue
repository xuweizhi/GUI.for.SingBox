<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import logo from '@/assets/logo'
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
  if (!input.value.trim() || loading.value) return

  try {
    const ok = await authStore.verifyToken(input.value)
    if (!ok) {
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
  <main class="login-view">
    <Card class="login-card">
      <div class="login-brand">
        <img :src="logo" alt="" width="36" height="36" /> GUI.for.SingBox
      </div>
      <h1 class="login-title">{{ t('auth.title') }}</h1>
      <p class="login-description">{{ t('auth.description') }}</p>

      <label for="webui-token" class="login-label">Token</label>
      <Input
        v-model="input"
        input-id="webui-token"
        type="password"
        :placeholder="t('auth.tokenPlaceholder')"
        autofocus
        class="w-full"
        @keydown.enter.prevent="submit"
      />

      <div
        v-if="authStore.lastError"
        role="alert"
        class="text-14 mt-12"
        style="color: var(--level-3-color)"
      >
        {{ t(authStore.lastError) }}
      </div>

      <Button
        type="primary"
        class="mt-20 w-full justify-center"
        :disabled="!input.trim()"
        :loading="loading"
        @click="submit"
      >
        {{ t('auth.submit') }}
      </Button>
    </Card>
  </main>
</template>

<style lang="less" scoped>
.login-view {
  flex: 1;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background:
    radial-gradient(
      circle at top,
      color-mix(in srgb, var(--primary-color) 12%, transparent),
      transparent 38%
    ),
    linear-gradient(180deg, color-mix(in srgb, var(--card-bg) 70%, transparent), transparent);
}

.login-card {
  width: 100%;
  max-width: 420px;
  padding: 32px 16px;
}
.login-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  color: var(--muted-color);
}
.login-title {
  margin: 24px 0 8px;
  font-size: 24px;
}
.login-description {
  margin: 0 0 24px;
  color: var(--muted-color);
}
.login-label {
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
}
</style>
