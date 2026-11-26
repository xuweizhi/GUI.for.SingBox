<script setup lang="ts">
import { ref, inject, h, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { useFormDraft } from '@/hooks/useFormDraft'
import { useNodeGroupsStore, useProfilesStore } from '@/stores'
import { generateConfig, message, restoreProfile } from '@/utils'

import Button from '@/components/Button/index.vue'

interface Props {
  profile: App.Profile
}

const props = defineProps<Props>()

const loading = ref(false)
const profileText = ref('')
const ready = ref(false)
const loadError = ref('')
let baseline: Recordable | undefined

const { t } = useI18n()
const profilesStore = useProfilesStore()
const nodeGroupsStore = useNodeGroupsStore()

const handleCancel = inject('cancel') as any
const handleSubmit = inject('submit') as any
const { resetBaseline } = useFormDraft(() => profileText.value)

const handleSave = async () => {
  if (!ready.value || loading.value) return
  loading.value = true
  try {
    const subscriptions = props.profile.outbounds.reduce((p, c) => {
      c.outbounds.forEach((outbound) => {
        if (outbound.type === 'NodeGroup') {
          nodeGroupsStore
            .resolveGroup(outbound.id)
            .nodes.forEach((node) => p.add(node.subscription.id))
        } else if (outbound.type !== 'Built-in' && outbound.type !== 'Native') {
          const id = outbound.type === 'Subscription' ? outbound.id : outbound.type
          p.add(id)
        }
      })
      return p
    }, new Set<string>())
    const newProfile = restoreProfile(JSON.parse(profileText.value), props.profile.name, {
      profile: props.profile,
      baseline,
      subscriptionIds: [...subscriptions],
    })
    newProfile.id = props.profile.id
    newProfile.mixin = props.profile.mixin
    newProfile.script = props.profile.script
    await profilesStore.editProfile(props.profile.id, newProfile)
    await handleSubmit()
  } catch (error: any) {
    console.log(error)
    message.error(error.message || error)
  } finally {
    loading.value = false
  }
}

const loadConfig = async () => {
  loadError.value = ''
  ready.value = false
  try {
    const text = await generateConfig(props.profile, {
      enableStableConfigCompat: false,
      enablePluginProcessing: false,
      enableMixinProcessing: false,
      enableScriptProcessing: false,
    })
    baseline = JSON.parse(JSON.stringify(text))
    profileText.value = JSON.stringify(text, null, 2)
    ready.value = true
    resetBaseline()
  } catch (error: any) {
    loadError.value = error?.message || String(error)
    message.error(error)
  }
}

onMounted(() => {
  void loadConfig()
})

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
        disabled: !ready.value,
        onClick: handleSave,
      },
      () => t('common.save'),
    ),
}

defineExpose({ modalSlots })
</script>

<template>
  <div ref="formRoot" class="h-full flex flex-col">
    <CodeEditor v-if="ready" v-model="profileText" lang="json" editable class="h-full" />
    <div v-else-if="loadError" class="flex-1 flex flex-col items-center justify-center gap-12 p-16">
      <div class="text-13 text-danger text-center break-all" role="alert">{{ loadError }}</div>
      <Button type="primary" size="small" @click="loadConfig">{{ t('common.retry') }}</Button>
    </div>
    <div v-else class="flex-1 flex items-center justify-center">
      <Icon icon="loading" :size="24" class="rotation" />
    </div>
  </div>
</template>
