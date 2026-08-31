<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { Outbound } from '@/enums/kernel'
import {
  findOutboundGraphIssues,
  getOutboundChainLabels,
  getOutboundReferenceCount,
  getOutboundRole,
  getOutboundRoleLabel,
  resolveConfiguredOutboundChain,
  setInitialOutboundTarget,
} from '@/utils/outboundPolicy'

const props = defineProps<{ route: App.Route; outbounds: App.Outbound[]; dns: App.Dns }>()
const primaryProxyOutbound = defineModel<string | undefined>('primaryProxyOutbound', {
  default: '',
})
const { t } = useI18n()

const roleOrder: App.OutboundRole[] = ['proxy', 'auto', 'direct', 'block', 'fallback', 'global']
const roleColors: Record<
  App.OutboundRole,
  'blue' | 'cyan' | 'green' | 'red' | 'gold' | 'purple' | 'default'
> = {
  proxy: 'blue',
  auto: 'cyan',
  direct: 'green',
  block: 'red',
  fallback: 'gold',
  global: 'purple',
  custom: 'default',
}

const policyGroups = computed(() =>
  props.outbounds
    .filter((outbound) => getOutboundRole(outbound) !== 'custom')
    .sort((a, b) => roleOrder.indexOf(getOutboundRole(a)) - roleOrder.indexOf(getOutboundRole(b))),
)

const primaryOptions = computed(() =>
  props.outbounds
    .filter((outbound) => [Outbound.Selector, Outbound.Urltest].includes(outbound.type as Outbound))
    .filter(
      (outbound) => !['direct', 'block', 'fallback', 'global'].includes(getOutboundRole(outbound)),
    )
    .map((outbound) => ({ label: outbound.tag, value: outbound.id })),
)

const graphIssues = computed(() => findOutboundGraphIssues(props.outbounds))

const issueChain = (value: string[]) => getOutboundChainLabels(value, props.outbounds).join(' → ')

const displayName = (outbound: App.Outbound) => t(getOutboundRoleLabel(getOutboundRole(outbound)))

const references = (outbound: App.Outbound) =>
  getOutboundReferenceCount({ route: props.route, dns: props.dns }, outbound.id)

const chain = (outbound: App.Outbound) =>
  resolveConfiguredOutboundChain(outbound.id, props.outbounds).labels.join(' → ')

const rulesFor = (outbound: App.Outbound) =>
  props.route.rules.filter(
    (rule) => rule.enable && rule.action === 'route' && rule.outbound === outbound.id,
  )

const ruleLabel = (rule: App.Rule) => `${rule.type}: ${rule.payload}`

const hasContraryTarget = (outbound: App.Outbound) => {
  const role = getOutboundRole(outbound)
  const target = outbound.outbounds[0]?.id
  return (
    (role === 'direct' && target === Outbound.Block) ||
    (role === 'block' && target === Outbound.Direct)
  )
}

const targetOptions = (outbound: App.Outbound) => {
  const role = getOutboundRole(outbound)
  const byRole = (targetRole: App.OutboundRole) =>
    props.outbounds.find((candidate) => getOutboundRole(candidate) === targetRole)
  const proxy = props.outbounds.find((candidate) => candidate.id === primaryProxyOutbound.value)
  const direct = byRole('direct')
  const block = byRole('block')

  if (role === 'direct') {
    return [
      { label: 'kernel.outbounds.target.direct', value: Outbound.Direct },
      { label: 'kernel.outbounds.target.block', value: Outbound.Block },
    ]
  }
  if (role === 'block') {
    return [
      { label: 'kernel.outbounds.target.block', value: Outbound.Block },
      { label: 'kernel.outbounds.target.direct', value: Outbound.Direct },
    ]
  }
  if (role === 'fallback' || role === 'global') {
    return [
      proxy && { label: 'kernel.outbounds.role.proxy', value: proxy.id },
      direct && { label: 'kernel.outbounds.role.direct', value: direct.id },
      block && { label: 'kernel.outbounds.role.block', value: block.id },
    ].filter(Boolean) as Array<{ label: string; value: string }>
  }
  return []
}

const setTarget = (outbound: App.Outbound, value: string) => {
  const targetTag = props.outbounds.find((candidate) => candidate.id === value)?.tag || value
  setInitialOutboundTarget(outbound, value, targetTag)
}
</script>

<template>
  <div class="policy-overview">
    <Card class="mb-8" :title="t('kernel.route.policy.primaryProxy')">
      <div class="flex flex-wrap items-center gap-8 py-4">
        <div class="text-12 flex-1 min-w-192">
          {{ t('kernel.route.policy.primaryProxyDesc') }}
        </div>
        <Select v-model="primaryProxyOutbound" :options="primaryOptions" />
      </div>
    </Card>

    <div v-if="graphIssues.length" class="policy-warning rounded-6 p-8 mb-8 text-12">
      <div class="font-bold mb-4">{{ t('kernel.route.policy.validationTitle') }}</div>
      <div v-for="(issue, index) in graphIssues" :key="`${issue.type}-${index}`">
        {{ t(`kernel.route.policy.issue.${issue.type}`) }}: {{ issueChain(issue.chain) }}
      </div>
    </div>

    <div class="policy-grid grid gap-8">
      <Card v-for="outbound in policyGroups" :key="outbound.id">
        <template #title-prefix>
          <Tag :color="roleColors[getOutboundRole(outbound)]" size="small">
            {{ displayName(outbound) }}
          </Tag>
        </template>
        <template #extra>
          <Tag v-if="route.final === outbound.id" color="gold" size="small">
            {{ t('kernel.route.policy.final') }}
          </Tag>
        </template>

        <div class="text-12 mb-4 break-all">{{ outbound.tag }}</div>
        <div class="text-12 mb-4">
          {{ t('kernel.route.policy.references') }}:
          {{ references(outbound).routeRules + references(outbound).routeFinal }}
        </div>
        <div v-if="rulesFor(outbound).length" class="flex flex-wrap gap-4 mb-8">
          <Tag
            v-for="rule in rulesFor(outbound).slice(0, 3)"
            :key="rule.id"
            size="small"
            color="default"
          >
            {{ ruleLabel(rule) }}
          </Tag>
          <Tag v-if="rulesFor(outbound).length > 3" size="small" color="default">
            +{{ rulesFor(outbound).length - 3 }}
          </Tag>
        </div>
        <div class="text-12 mb-8 break-all">
          {{ t('kernel.route.policy.initialChain') }}: {{ chain(outbound) }}
        </div>

        <div v-if="targetOptions(outbound).length" class="flex items-center gap-8">
          <span class="text-12">{{ t('kernel.route.policy.initialTarget') }}</span>
          <Select
            :model-value="outbound.outbounds[0]?.id"
            :options="targetOptions(outbound)"
            size="small"
            @change="(value) => setTarget(outbound, value as string)"
          />
        </div>
        <div v-else-if="getOutboundRole(outbound) === 'auto'" class="text-12">
          {{
            t('kernel.route.policy.autoSummary', [
              outbound.outbounds.length,
              outbound.interval,
              outbound.tolerance,
            ])
          }}
        </div>
        <div v-if="hasContraryTarget(outbound)" class="semantic-warning text-12 mt-8">
          {{ t('kernel.route.policy.contraryTargetWarning') }}
        </div>
      </Card>
    </div>

    <div class="text-12 mt-8 policy-note">
      {{ t('kernel.route.policy.cacheNote') }}
    </div>
  </div>
</template>

<style scoped lang="less">
.policy-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.policy-warning {
  color: var(--level-4-color);
  background: var(--card-bg);
}

.policy-note {
  color: var(--level-3-color);
}

.semantic-warning {
  color: var(--level-4-color);
}

@media (max-width: 760px) {
  .policy-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
