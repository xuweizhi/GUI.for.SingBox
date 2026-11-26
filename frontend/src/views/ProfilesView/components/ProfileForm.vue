<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'

import { RuleAction, RuleType } from '@/enums/kernel'
import { useNodeGroupsStore, useProfilesStore } from '@/stores'
import {
  previewCode,
  confirm,
  deepClone,
  findOutboundGraphIssues,
  generateConfig,
  getOutboundChainLabels,
  getPrimaryProxyOutbound,
  isValidJson,
  message,
} from '@/utils'

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
  step: Step.General,
})

import DnsConfig from './DnsConfig.vue'
import GeneralConfig from './GeneralConfig.vue'
import InboundsConfig from './InboundsConfig.vue'
import MixinAndScript from './MixinAndScriptConfig.vue'
import OutboundsConfig from './OutboundsConfig.vue'
import RouteConfig from './RouteConfig.vue'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const outboundEditor = useTemplateRef('outboundEditor')
const editOutbound = async (id: string) => {
  currentStep.value = Step.Outbounds
  await nextTick()
  outboundEditor.value?.editById(id)
}
onMounted(() => {
  if (typeof route.query.outbound === 'string') void editOutbound(route.query.outbound)
})
const profilesStore = useProfilesStore()
const nodeGroupsStore = useNodeGroupsStore()

const loading = ref(false)
const currentStep = ref(Math.max(1, Math.min(Step.MixinScript, props.step)))

const selectStep = (step: number) => {
  const next = Math.max(1, Math.min(Step.MixinScript, step))
  currentStep.value = next
  if (String(route.query.step || '') !== String(next)) {
    void router.replace({ query: { ...route.query, step: String(next) } }).catch(() => undefined)
  }
}

const stepItems = [
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
  set: (id) => {
    profile.value.primary_proxy_outbound = id
  },
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

const nameRequired = ref(false)
const graphIssues = computed(() =>
  findOutboundGraphIssues(profile.value.outbounds, nodeGroupsStore.nodeGroups),
)
const validationReport = computed(() => {
  const p = profile.value
  const nameMissing = p.name.trim() ? 0 : 1
  const outboundCount = graphIssues.value.length
  const outboundIds = new Set(p.outbounds.map((outbound) => outbound.id))
  const rulesetIds = new Set(p.route.rule_set.map((ruleset) => ruleset.id))
  const inboundIds = new Set(p.inbounds.map((inbound) => inbound.id))
  const serverIds = new Set(p.dns.servers.map((server) => server.id))
  let routeCount = p.route.final && !outboundIds.has(p.route.final) ? 1 : 0
  let dnsCount = p.dns.final && !serverIds.has(p.dns.final) ? 1 : 0
  const routeRuleLost = (rule: App.Rule) => {
    if (rule.type === RuleType.InsertionPoint) return false
    let lost = !rule.payload
    if (rule.action === RuleAction.Route) lost ||= !outboundIds.has(rule.outbound)
    else if (rule.action === RuleAction.RouteOptions) lost ||= !isValidJson(rule.outbound)
    if (rule.type === RuleType.Inbound) lost ||= !inboundIds.has(rule.payload)
    else if (rule.type === RuleType.IpIsPrivate)
      lost ||= !['true', 'false'].includes(rule.payload)
    else if (rule.type === RuleType.RuleSet)
      lost ||= rule.payload.split(',').some((id) => !rulesetIds.has(id))
    return lost
  }
  const dnsRuleLost = (rule: App.DnsRule) => {
    if (rule.type === RuleType.InsertionPoint) return false
    let lost = !rule.payload
    if (rule.action === RuleAction.Route) lost ||= !serverIds.has(rule.server)
    else if (
      rule.action === RuleAction.RouteOptions ||
      rule.action === RuleAction.Predefined
    )
      lost ||= !isValidJson(rule.server)
    else if (rule.action === RuleAction.Reject)
      lost ||= !['default', 'drop'].includes(rule.server)
    if (rule.type === RuleType.Inbound) lost ||= !inboundIds.has(rule.payload)
    else if (rule.type === RuleType.RuleSet)
      lost ||= rule.payload.split(',').some((id) => !rulesetIds.has(id))
    else if (rule.type === RuleType.Inline) lost ||= !isValidJson(rule.payload)
    return lost
  }
  routeCount += p.route.rules.filter((rule) => rule.enable && routeRuleLost(rule)).length
  dnsCount += p.dns.rules.filter((rule) => rule.enable && dnsRuleLost(rule)).length
  const stepIssues = [0, 0, outboundCount, routeCount, dnsCount, 0]
  const total = nameMissing + outboundCount + routeCount + dnsCount
  return { nameMissing, stepIssues, total }
})
const validationIssueCount = computed(() => validationReport.value.total)
const jumpToFirstIssue = () => {
  if (validationReport.value.nameMissing) {
    nameRequired.value = true
    document.getElementById('profile-name')?.focus()
    return
  }
  const idx = validationReport.value.stepIssues.findIndex((count) => count > 0)
  if (idx !== -1) selectStep(idx + 1)
}
const counts = computed(() => [
  null,
  profile.value.inbounds.length,
  profile.value.outbounds.length,
  profile.value.route.rules.length,
  profile.value.dns.servers.length + profile.value.dns.rules.length,
  null,
])
const handleSave = async () => {
  if (loading.value || missing) return
  if (!profile.value.name.trim()) {
    nameRequired.value = true
    document.getElementById('profile-name')?.focus()
    return
  }
  if (graphIssues.value.some((issue) => issue.type === 'reserved-tag')) {
    selectStep(Step.Outbounds)
    message.error(t('kernel.outbounds.reservedTag'))
    return
  }
  const cycle = graphIssues.value.find((issue) => issue.type === 'cycle')
  if (cycle) {
    selectStep(Step.Outbounds)
    message.error(
      t('kernel.outbounds.cycle', [
        getOutboundChainLabels(cycle.chain, profile.value.outbounds).join(' → '),
      ]),
    )
    return
  }
  const missingNodeGroup = graphIssues.value.find((issue) => issue.type === 'missing-node-group')
  if (missingNodeGroup) {
    selectStep(Step.Outbounds)
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
    baseline = JSON.stringify(profile.value)
    message.success('common.success')
    await router.push('/profiles')
  } catch (error: any) {
    console.error('handleSave: ', error)
    message.error(error)
  } finally {
    loading.value = false
  }
}

const handlePreview = async () => {
  try {
    const config = await generateConfig(profile.value)
    previewCode(profile.value.name || t('common.preview'), JSON.stringify(config, null, 2))
  } catch (error: any) {
    message.error(error.message || error)
  }
}

const original = props.id ? profilesStore.getProfileById(props.id) : undefined
const missing = Boolean(props.id && !original)
if (original) profile.value = deepClone(original)
let baseline = JSON.stringify(profile.value)
const dirty = () => JSON.stringify(profile.value) !== baseline
const allowLeave = async () => {
  if (!dirty()) return true
  try {
    await confirm(t('common.warning'), t('workspace.discard'))
    return true
  } catch {
    return false
  }
}
onBeforeRouteLeave(allowLeave)
onBeforeRouteUpdate((to, from) => {
  if (to.path === from.path) return true
  return allowLeave()
})
const beforeUnload = (event: BeforeUnloadEvent) => {
  if (dirty()) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onUnmounted(() => window.removeEventListener('beforeunload', beforeUnload))
</script>

<template>
  <Empty v-if="missing" description="workspace.missingProfile" />
  <section v-else class="profile-workspace">
    <header class="profile-header flex flex-wrap items-center gap-8">
      <RouterLink to="/profiles">← {{ t('router.profiles') }}</RouterLink>
      <Input
        v-model="profile.name"
        input-id="profile-name"
        :label="t('profile.name')"
        :placeholder="t('profile.name')"
        class="flex-1 min-w-128"
      />
      <Button icon="preview" @click="handlePreview">{{ t('common.preview') }}</Button>
      <Button @click="router.push('/profiles')">{{ t('common.cancel') }}</Button>
      <Button type="primary" :loading="loading" @click="handleSave">{{ t('common.save') }}</Button>
      <small v-if="nameRequired && !profile.name.trim()" class="field-error" role="alert"
        >{{ t('profile.name') }} · {{ t('workspace.required') }}</small
      >
    </header>
    <nav class="profile-stepper" :aria-label="t('router.profiles')">
      <Button
        v-for="(item, index) in stepItems"
        :key="item.title"
        :type="index + 1 === currentStep ? 'link' : 'text'"
        :aria-current="index + 1 === currentStep ? 'page' : undefined"
        class="justify-start shrink-0"
        @click="selectStep(index + 1)"
      >
        <span>{{ t(item.title) }}</span>
        <span v-if="counts[index] != null" class="ml-4 text-12 text-secondary">{{
          counts[index]
        }}</span>
        <span
          v-if="validationReport.stepIssues[index]"
          class="step-issue-badge ml-auto text-12"
          >{{ validationReport.stepIssues[index] }}</span
        >
      </Button>
      <button
        v-if="validationIssueCount"
        type="button"
        class="profile-health profile-health--issue text-12 text-danger"
        role="status"
        @click="jumpToFirstIssue"
      >
        {{ t('kernel.route.policy.validationTitle') }} · {{ validationIssueCount }}
      </button>
      <span v-else class="profile-health profile-health--ok text-12" role="status"
        >{{ t('workspace.validationOk') }}</span
      >
    </nav>
    <main class="profile-content">
      <div v-show="currentStep === Step.General">
        <GeneralConfig v-model="generalConfig" :outbound-options="outboundOptions" />
      </div>
      <div v-show="currentStep === Step.Inbounds">
        <InboundsConfig v-model="profile.inbounds" />
      </div>
      <div v-show="currentStep === Step.Outbounds">
        <OutboundsConfig
          ref="outboundEditor"
          v-model="profile.outbounds"
          :native="profile.native"
        />
      </div>
      <div v-show="currentStep === Step.Route">
        <RouteConfig
          v-model="profile.route"
          v-model:outbounds="profile.outbounds"
          v-model:primary-proxy-outbound="primaryProxy"
          :inbound-options="inboundOptions"
          :outbound-options="outboundOptions"
          :server-options="serverOptions"
          :dns="profile.dns"
          @edit-outbound="editOutbound"
        />
      </div>
      <div v-show="currentStep === Step.Dns">
        <DnsConfig
          v-model="profile.dns"
          :profile="profile"
          :inbound-options="inboundOptions"
          :outbound-options="outboundOptions"
          :rule-set="profile.route.rule_set"
        />
      </div>
      <div v-show="currentStep === Step.MixinScript">
        <MixinAndScript v-model="mixinAndScriptConfig" />
      </div>
    </main>
  </section>
</template>
<style scoped>
.profile-workspace {
  display: grid;
  grid-template: auto minmax(0, 1fr) / minmax(150px, 190px) minmax(0, 1fr);
  gap: 16px;
  height: 100%;
  min-height: 0;
}
.profile-header {
  grid-column: 1/-1;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--surface-border);
}
.profile-stepper {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  min-height: 0;
  overflow-y: auto;
}
.step-issue-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  font-weight: 700;
  color: var(--danger-color);
  background: var(--danger-soft);
}
.profile-health {
  margin-top: 8px;
  padding: 5px 10px;
  border: 0;
  border-radius: 999px;
  font-weight: 600;
  text-align: left;
}
.profile-health--ok {
  color: var(--color-success);
  background: var(--success-soft);
}
.profile-health--issue {
  background: var(--danger-soft);
  cursor: pointer;
}
.profile-content {
  min-width: 0;
  overflow: auto;
}
@container (max-width: 640px) {
  .profile-workspace {
    grid-template: auto auto minmax(0, 1fr) / minmax(0, 1fr);
    gap: 8px;
  }
  .profile-header {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .profile-header > a {
    grid-column: 1 / -1;
  }
  .profile-header > .gui-input {
    grid-column: 1 / -1;
    width: 100%;
  }
  .profile-header > .gui-button {
    min-width: 0;
  }
  .profile-header > .field-error {
    grid-column: 1 / -1;
  }
  .profile-stepper {
    flex-direction: row;
    align-items: center;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .profile-health {
    margin-top: 0;
    margin-left: auto;
    white-space: nowrap;
    flex-shrink: 0;
  }
}
</style>
