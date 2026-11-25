<script setup lang="ts">
import { h, inject, ref } from 'vue'
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

const handleSave = async () => {
  if (loading.value) return
  if (!name.value) {
    name.value = sampleID()
  }

  const sub = subscribeStore.getSubscribeTemplate(name.value, { url: url.value })
  sub.decryptPassword = decryptPassword.value

  loading.value = true

  let added = false
  try {
    await subscribeStore.addSubscribe(sub, false)
    added = true
    await subscribeStore.updateSubscribe(sub.id)
    const profile = profilesStore.getProfileTemplate(name.value)
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
        disabled: !/^https?:\/\//.test(url.value),
        loading: loading.value,
        onClick: handleSave,
      },
      () => t('common.save'),
    ),
}

defineExpose({ modalSlots })
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex gap-4">
      <Input v-model="name" :placeholder="$t('profile.name')" auto-size clearable class="w-[25%]" />
      <Input
        v-model="url"
        placeholder="http(s)://"
        autofocus
        clearable
        allow-paste
        class="w-[75%]"
      />
    </div>
    <Input
      v-model="decryptPassword"
      :placeholder="$t('subscribe.decryptPassword')"
      type="password"
      clearable
      allow-paste
      class="w-full"
    />
  </div>
</template>
