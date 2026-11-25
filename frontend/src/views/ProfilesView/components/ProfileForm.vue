<script setup lang="ts">
import { ref, inject, computed, useTemplateRef, h } from 'vue'
import { useI18n } from 'vue-i18n'

import { useNodeGroupsStore, useProfilesStore } from '@/stores'
import {
  alert,
  deepClone,
  findOutboundGraphIssues,
  generateConfig,
  getOutboundChainLabels,
  getPrimaryProxyOutbound,
  message,
} from '@/utils'

import Button from '@/components/Button/index.vue'

interface Props {
  id?: string
  step?: number
}

enum Step {
  Name = 0,
  General = 1,
  Inbounds = 2,
  Outbounds = 3,
  Route = 4,
  Dns = 5,
  MixinScript = 6,
}

const props = withDefaults(defineProps<Props>(), {
  id: '',
  step: Step.Name,
})

import DnsConfig from './DnsConfig.vue'
import GeneralConfig from './GeneralConfig.vue'
import InboundsConfig from './InboundsConfig.vue'
import MixinAndScript from './MixinAndScriptConfig.vue'
import OutboundsConfig from './OutboundsConfig.vue'
import RouteConfig from './RouteConfig.vue'

const { t } = useI18n()
const inboundsRef = useTemplateRef('inboundsRef')
const outboundsRef = useTemplateRef('outboundsRef')
const routeRef = useTemplateRef('routeRef')
const dnsRef = useTemplateRef('dnsRef')
const profilesStore = useProfilesStore()
const nodeGroupsStore = useNodeGroupsStore()

const loading = ref(false)
const currentStep = ref(props.step)

const stepItems = [
  { title: 'profile.step.name' },
  { title: 'profile.step.general' },
  { title: 'profile.step.inbounds' },
  { title: 'profile.step.outbounds' },
  { title: 'profile.step.route' },
  { title: 'profile.step.dns' },
  { title: 'profile.step.mixin-script' },
] as const

const profile = ref<App.Profile>(profilesStore.getProfileTemplate())

const primaryProxy = computed({
  get: () => getPrimaryProxyOutbound(profile.value)?.id || '',
  set: (id) => { profile.value.primary_proxy_outbound = id },
})

const inboundOptions = computed(() =>
  profile.value.inbounds.map((v) => ({ label: v.tag, value: v.id })),
)

const outboundOptions = computed(() =>
  profile.value.outbounds.map((v) => ({ label: v.tag, value: v.id })),
)

const serverOptions = computed(() =>
  profile.value.dns.servers.map((v) => ({ label: v.tag, value: v.id })),
)

const generalConfig = computed({
  get() {
    return { log: profile.value.log, experimental: profile.value.experimental }
  },
  set({ log, experimental }) {
    profile.value.log = log
    profile.value.experimental = experimental
  },
})

const mixinAndScriptConfig = computed({
  get() {
    return { mixin: profile.value.mixin, script: profile.value.script }
  },
  set({ mixin, script }) {
    profile.value.mixin = mixin
    profile.value.script = script
  },
})

const handleCancel = inject('cancel') as any
const handleSubmit = inject('submit') as any
const handlePrevStep = () => currentStep.value--
const handleNextStep = () => currentStep.value++

const handleSave = async () => {
  const graphIssues = findOutboundGraphIssues(profile.value.outbounds, nodeGroupsStore.nodeGroups)
  if (graphIssues.some((issue) => issue.type === 'reserved-tag')) {
    message.error(t('kernel.outbounds.reservedTag'))
    return
  }
  const cycle = graphIssues.find((issue) => issue.type === 'cycle')
  if (cycle) {
    message.error(
      t('kernel.outbounds.cycle', [
        getOutboundChainLabels(cycle.chain, profile.value.outbounds).join(' → '),
      ]),
    )
    return
  }
  const missingNodeGroup = graphIssues.find((issue) => issue.type === 'missing-node-group')
  if (missingNodeGroup) {
    message.error(t('kernel.outbounds.missingNodeGroup', [missingNodeGroup.targetId]))
    return
  }
  const primaryProxy = getPrimaryProxyOutbound(profile.value)
  profile.value.primary_proxy_outbound = primaryProxy?.id

  loading.value = true
  try {
    if (props.id) {
      await profilesStore.editProfile(props.id, profile.value)
    } else {
      await profilesStore.addProfile(profile.value)
    }
    await handleSubmit()
  } catch (error: any) {
    console.error('handleSave: ', error)
    message.error(error)
  }
  loading.value = false
}

const handlePreview = async () => {
  try {
    const config = await generateConfig(profile.value)
    alert(profile.value.name || t('common.preview'), JSON.stringify(config, null, 2))
  } catch (error: any) {
    message.error(error.message || error)
  }
}

const goToStep = (index: number) => {
  if (!profile.value.name && index !== Step.Name) return
  currentStep.value = index
}

if (props.id) {
  const p = profilesStore.getProfileById(props.id)
  if (p) {
    profile.value = deepClone(p)
  }
}

const modalSlots = {
  title: () =>
    h(
      'div',
      { class: 'font-bold text-16 line-clamp-1' },
      profile.value.name
        ? `${profile.value.name} · ${t(stepItems[currentStep.value]!.title)}`
        : t(stepItems[currentStep.value]!.title),
    ),

  toolbar: () => [
    h(
      Button,
      {
        type: 'text',
        size: 'small',
        icon: 'preview',
        onClick: handlePreview,
      },
      () => t('common.preview'),
    ),
  ],
  action: () => [
    h(
      Button,
      {
        disabled: currentStep.value === Step.Name,
        onClick: handlePrevStep,
      },
      () => t('common.prevStep'),
    ),
    h(
      Button,
      {
        class: 'mr-auto',
        disabled: !profile.value.name || currentStep.value === stepItems.length - 1,
        onClick: handleNextStep,
      },
      () => t('common.nextStep'),
    ),
  ],
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
        disabled: !profile.value.name,
        onClick: handleSave,
      },
      () => t('common.save'),
    ),
}

defineExpose({ modalSlots })
</script>

<template>
  <div class="profile-form flex flex-col gap-12">
    <nav class="profile-stepper" role="tablist" :aria-label="t('router.profiles')">
      <button
        v-for="(item, index) in stepItems"
        :key="item.title"
        type="button"
        role="tab"
        :aria-selected="currentStep === index"
        :disabled="!profile.name && index !== Step.Name"
        :class="{ 'is-active': currentStep === index }"
        class="profile-stepper__item"
        @click="goToStep(index)"
      >
        <span class="profile-stepper__index">{{ index + 1 }}</span>
        <span>{{ t(item.title) }}</span>
      </button>
    </nav>

    <div v-if="currentStep === Step.Name" class="form-item">
      {{ t('profile.name') }} *
      <Input
        v-model="profile.name"
        autofocus
        clearable
        :placeholder="t('profile.name')"
        class="flex-1"
      />
    </div>
    <div v-if="currentStep === Step.General">
      <GeneralConfig v-model="generalConfig" :outbound-options="outboundOptions" />
    </div>
    <div v-if="currentStep === Step.Inbounds">
      <InboundsConfig ref="inboundsRef" v-model="profile.inbounds" />
    </div>
    <div v-if="currentStep === Step.Outbounds">
      <OutboundsConfig ref="outboundsRef" v-model="profile.outbounds" :native="profile.native" />
    </div>
    <div v-if="currentStep === Step.Route">
      <RouteConfig
        ref="routeRef"
        v-model="profile.route"
        v-model:outbounds="profile.outbounds"
        v-model:primary-proxy-outbound="primaryProxy"
        :inbound-options="inboundOptions"
        :outbound-options="outboundOptions"
        :server-options="serverOptions"
        :dns="profile.dns"
      />
    </div>
    <div v-if="currentStep === Step.Dns">
      <DnsConfig
        ref="dnsRef"
        v-model="profile.dns"
        :profile="profile"
        :inbound-options="inboundOptions"
        :outbound-options="outboundOptions"
        :rule-set="profile.route.rule_set"
      />
    </div>
    <div v-if="currentStep === Step.MixinScript">
      <MixinAndScript v-model="mixinAndScriptConfig" />
    </div>
  </div>
</template>

<style lang="less" scoped>
.profile-stepper {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-color);
}

.profile-stepper__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--card-bg);
  color: var(--muted-color);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color 0.14s ease,
    border-color 0.14s ease,
    color 0.14s ease;

  &:hover:not(:disabled) {
    color: var(--color);
    border-color: color-mix(in srgb, var(--accent-text) 45%, var(--border-color));
  }

  &.is-active {
    background: var(--accent-soft);
    border-color: var(--accent-text);
    color: var(--accent-text);
    font-weight: 600;
    .profile-stepper__index {
      background: var(--primary-color);
      color: var(--btn-primary-color);
    }
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.profile-stepper__index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--bg-color);
  font-size: 11px;
  font-weight: 700;
}
</style>
