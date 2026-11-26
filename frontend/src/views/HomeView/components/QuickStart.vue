<script setup lang="ts">
import { computed, h, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useProfilesStore, useAppSettingsStore, useSubscribesStore } from '@/stores'
import { message, sampleID } from '@/utils'

import Button from '@/components/Button/index.vue'

const { t } = useI18n()
const subscribeStore = useSubscribesStore()
const profilesStore = useProfilesStore()
const appSettingsStore = useAppSettingsStore()

const url = ref('')
const name = ref('')
const decryptPassword = ref('')
const loading = ref(false)

const handleCancel = inject('cancel') as any
const handleSubmit = inject('submit') as any

const attempted = ref(false)
const urlBlurred = ref(false)
const valid = computed(() => {
  try {
    return ['http:', 'https:'].includes(new URL(url.value.trim()).protocol)
  } catch {
    return false
  }
})
const handleSave = async () => {
  attempted.value = true
  if (!valid.value || loading.value) return
  const resolvedName = name.value.trim() || sampleID()
  const resolvedUrl = url.value.trim()

  const sub = subscribeStore.getSubscribeTemplate(resolvedName, { url: resolvedUrl })
  sub.decryptPassword = decryptPassword.value

  loading.value = true

  let added = false
  try {
    await subscribeStore.addSubscribe(sub, false)
    added = true
    await subscribeStore.updateSubscribe(sub.id)
    const profile = profilesStore.getProfileTemplate(resolvedName)
    for (const outbound of profile.outbounds.slice(0, 2)) {
      outbound.outbounds.push({ id: sub.id, tag: sub.id, type: 'Subscription' })
    }
    await profilesStore.addProfile(profile)
    added = false
    appSettingsStore.app.kernel.profile = profile.id
    message.success('home.initSuccessful')
    await handleSubmit()
  } catch (error) {
    message.error(error)
    if (added) await subscribeStore.deleteSubscribe(sub.id).catch((err) => message.error(err))
  } finally {
    loading.value = false
  }
}

const modalSlots = {
  cancel: () =>
    h(
      Button,
      {
        disabled: loading.value,
        onClick: handleCancel,
      },
      () => t('common.cancel'),
    ),
  submit: () =>
    h(
      Button,
      {
        type: 'primary',
        loading: loading.value,
        onClick: handleSave,
      },
      () => t('common.save'),
    ),
}

defineExpose({ modalSlots })
</script>

<template>
  <div class="form-grid" @keydown.enter.prevent="handleSave">
    <label for="quick-name">{{ t('profile.name') }}</label>
    <Input v-model="name" input-id="quick-name" clearable />
    <label for="quick-url">URL</label>
    <div :data-invalid="(attempted || urlBlurred) && !valid ? 'true' : undefined">
      <Input
        v-model="url"
        input-id="quick-url"
        autofocus
        clearable
        allow-paste
        placeholder="https://"
        class="w-full"
        @submit="urlBlurred = true"
      />
      <span
        v-if="(attempted || urlBlurred) && !valid"
        role="alert"
        class="field-error text-12"
        >{{ t('workspace.url') }}</span
      >
    </div>
    <label for="quick-password">{{ t('subscribe.decryptPassword') }}</label>
    <Input v-model="decryptPassword" input-id="quick-password" type="password" clearable />
  </div>
</template>
