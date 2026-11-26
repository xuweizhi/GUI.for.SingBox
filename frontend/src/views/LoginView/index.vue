<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import logo from '@/assets/logo'
import { Theme } from '@/enums/app'
import { useAppSettingsStore, useAppStore, useWebuiAuthStore } from '@/stores'
import { message } from '@/utils'
import { resolveRedirectTarget } from '@/utils/webuiAuth'

const LANG_KEY = 'gfs.login.lang'
const THEME_KEY = 'gfs.login.theme'

const appearance = useAppSettingsStore()
const appStore = useAppStore()
const { t, te, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const authStore = useWebuiAuthStore()

const input = ref(authStore.token)
watch(input, () => {
  if (authStore.lastError) authStore.lastError = ''
})
const loading = computed(() => authStore.status === 'checking')
const languageOptions = computed(() =>
  appStore.locales.length
    ? appStore.locales
    : [
        { label: '简体中文', value: 'zh' },
        { label: 'English', value: 'en' },
      ],
)
const currentLanguageLabel = computed(() => {
  const label = languageOptions.value.find((item) => item.value === locale.value)?.label
  return label && te(label) ? t(label) : label || locale.value
})

const persistPreference = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignore storage errors in restricted environments
  }
}
const applyPreferences = () => {
  try {
    const lang = window.localStorage.getItem(LANG_KEY)
    if (lang && languageOptions.value.some((item) => item.value === lang)) {
      appearance.previewLoginAppearance({ lang })
    }
    const theme = window.localStorage.getItem(THEME_KEY)
    if (theme === Theme.Light || theme === Theme.Dark) {
      appearance.previewLoginAppearance({ theme })
    }
  } catch {
    // ignore storage errors in restricted environments
  }
}
const switchLanguage = () => {
  const options = languageOptions.value
  if (!options.length) return
  const index = options.findIndex((item) => item.value === locale.value)
  const next = options[(index + 1) % options.length]!
  appearance.previewLoginAppearance({ lang: next.value }, true)
  persistPreference(LANG_KEY, next.value)
}
const switchTheme = (event: MouseEvent) => {
  document.documentElement.style.setProperty('--x', event.clientX + 'px')
  document.documentElement.style.setProperty('--y', event.clientY + 'px')
  const next = appearance.themeMode === Theme.Dark ? Theme.Light : Theme.Dark
  appearance.previewLoginAppearance({ theme: next }, true)
  persistPreference(THEME_KEY, next)
}

const onEnterKey = (event: KeyboardEvent) => {
  if (event.isComposing) return
  void submit()
}

onMounted(applyPreferences)

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
      <div class="flex justify-end gap-6">
        <Button size="small" type="text" @click="switchLanguage">{{
          currentLanguageLabel
        }}</Button>
        <Button
          size="small"
          type="text"
          :aria-label="t('common.switchTheme')"
          :icon="appearance.themeMode === Theme.Dark ? 'sun' : 'moon'"
          @click="switchTheme"
        />
      </div>
      <div class="login-brand">
        <img :src="logo" alt="" width="36" height="36" /> GUI.for.SingBox
      </div>
      <h1 class="login-title">{{ t('auth.title') }}</h1>
      <p class="login-description">{{ t('auth.description') }}</p>

      <form @submit.prevent="submit">
        <label for="webui-token" class="login-label">{{ t('workspace.token') }}</label>
        <Input
          v-model="input"
          input-id="webui-token"
          type="password"
          :placeholder="t('auth.tokenPlaceholder')"
          autofocus
          class="w-full"
          autocomplete="current-password"
          @keydown.enter="onEnterKey"
        />

        <div v-if="authStore.lastError" role="alert" class="login-error mt-12">
          {{ t(authStore.lastError) }}
        </div>

        <Button
          type="primary"
          :loading="loading"
          :disabled="!input.trim()"
          class="login-submit mt-20 w-full"
          @click="submit"
        >
          {{ t('auth.submit') }}
        </Button>
      </form>
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
.login-error {
  color: var(--color-danger);
  background: var(--danger-soft);
  border: 1px solid var(--color-danger);
  border-radius: var(--control-radius);
  padding: 8px 12px;
  font-size: calc(14px * var(--font-scale, 1));
}
.login-submit {
  width: 100%;
  padding: 10px;
}
</style>
