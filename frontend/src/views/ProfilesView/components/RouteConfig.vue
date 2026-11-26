<script lang="ts" setup>
import { computed, ref, nextTick, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { useNodeGroupsStore } from '@/stores'
import { ensureNodeGroupOutlet, message, type NodeGroupOutletBehavior } from '@/utils'

import RoutePolicyOverview from './RoutePolicyOverview.vue'
import RouteRulesConfig from './RouteRulesConfig.vue'
import RouteRulesetConfig from './RouteRulesetConfig.vue'

interface Props {
  inboundOptions: { label: string; value: string }[]
  outboundOptions: { label: string; value: string }[]
  serverOptions: { label: string; value: string }[]
  dns: App.Dns
}

defineProps<Props>()

const model = defineModel<App.Profile['route']>({ required: true })
const outbounds = defineModel<App.Outbound[]>('outbounds', { required: true })
const primaryProxyOutbound = defineModel<string | undefined>('primaryProxyOutbound', {
  default: '',
})

const route = useRoute()
const validTabs = new Set(['policy', 'common', 'rule_set', 'rules'])
const resolveQueryTab = (value: unknown) =>
  typeof value === 'string' && validTabs.has(value) ? value : 'policy'
const activeKey = ref(resolveQueryTab(route.query.tab))
watch(
  () => route.query.tab,
  (tab) => {
    if (typeof tab === 'string' && validTabs.has(tab)) activeKey.value = tab
  },
)
const rulesConfigRef = useTemplateRef('rulesConfigRef')
const rulesetConfigRef = useTemplateRef('rulesetConfigRef')
const tabs = [
  { key: 'policy', tab: 'kernel.route.tab.policy' },
  { key: 'common', tab: 'kernel.route.tab.common' },
  { key: 'rule_set', tab: 'kernel.route.tab.rule_set' },
  { key: 'rules', tab: 'kernel.route.tab.rules' },
]

const { t } = useI18n()
const nodeGroupsStore = useNodeGroupsStore()
const currentOutlet = computed(() =>
  outbounds.value.find((outbound) => outbound.id === model.value.final),
)
const targetType = ref(currentOutlet.value?.source_node_group ? 'group' : 'outbound')
const emit = defineEmits<{ editOutbound: [id: string] }>()
const editRule = async (id: string) => {
  activeKey.value = 'rules'
  await nextTick()
  rulesConfigRef.value?.editById(id)
}
const finalNodeGroup = ref(currentOutlet.value?.source_node_group || '')
const finalNodeGroupBehavior = ref<NodeGroupOutletBehavior>(
  currentOutlet.value?.type === 'urltest' ? 'auto' : 'manual',
)

const nodeGroupOptions = computed(() =>
  nodeGroupsStore.nodeGroups.map((group) => ({ label: group.name, value: group.id })),
)

const applyFinalNodeGroup = () => {
  const group = nodeGroupsStore.getNodeGroupById(finalNodeGroup.value)
  if (!group) {
    if (finalNodeGroup.value) {
      message.error(t('kernel.outbounds.missingNodeGroup', [finalNodeGroup.value]))
      return false
    }
    if (currentOutlet.value?.source_node_group) model.value.final = ''
    return
  }
  const label = t(
    finalNodeGroupBehavior.value === 'auto' ? 'nodeGroups.outletAuto' : 'nodeGroups.outletManual',
  )
  model.value.final = ensureNodeGroupOutlet(
    outbounds.value,
    group,
    finalNodeGroupBehavior.value,
    label,
  ).id
}

const handleAdd = () => {
  const handlerMap: Record<string, (() => void) | undefined> = {
    policy: () => {},
    common: () => {},
    rules: rulesConfigRef.value?.handleAdd,
    rule_set: rulesetConfigRef.value?.handleAdd,
  }
  handlerMap[activeKey.value]?.()
}

defineExpose({ handleAdd })
const resetTarget = () => {
  model.value.final = ''
  finalNodeGroup.value = ''
}
</script>

<template>
  <Tabs v-model:active-key="activeKey" :items="tabs" tab-position="top">
    <template #policy>
      <RoutePolicyOverview
        v-model:primary-proxy-outbound="primaryProxyOutbound"
        :route="model"
        :outbounds="outbounds"
        :inbound-options="inboundOptions"
        :dns="dns"
        @edit-outbound="emit('editOutbound', $event)"
        @edit-rule="editRule"
      />
    </template>
    <template #common>
      <div class="form-item">
        {{ t('kernel.route.find_process') }}
        <Switch v-model="model.find_process" />
      </div>
      <div class="form-item">
        {{ t('kernel.route.auto_detect_interface') }}
        <Switch v-model="model.auto_detect_interface" />
      </div>
      <div v-if="!model.auto_detect_interface" class="form-item">
        {{ t('kernel.route.default_interface') }}
        <InterfaceSelect v-model="model.default_interface" clearable />
      </div>
      <div class="form-item">
        {{ t('kernel.route.default_domain_resolver.server') }}
        <Select v-model="model.default_domain_resolver.server" :options="serverOptions" clearable />
      </div>
      <!-- <div class="form-item">
        {{ t('kernel.route.default_domain_resolver.client_subnet') }}
        <Input v-model="model.default_domain_resolver.client_subnet" editable />
      </div> -->
      <div class="form-item">
        {{ t('kernel.route.final') }}
        <div class="flex flex-col gap-8">
          <Radio
            v-if="nodeGroupOptions.length || targetType === 'group'"
            v-model="targetType"
            :options="[
              { label: 'kernel.route.rules.outbound', value: 'outbound' },
              { label: 'router.nodeGroups', value: 'group' },
            ]"
            @change="resetTarget"
          />
          <Select
            v-if="targetType === 'outbound'"
            v-model="model.final"
            :options="outboundOptions"
            clearable
          />
          <template v-else>
            <Select
              v-model="finalNodeGroup"
              :options="nodeGroupOptions"
              clearable
              @change="applyFinalNodeGroup"
            />
            <Radio
              v-model="finalNodeGroupBehavior"
              :options="[
                { label: 'nodeGroups.outletManual', value: 'manual' },
                { label: 'nodeGroups.outletAuto', value: 'auto' },
              ]"
              @change="applyFinalNodeGroup"
            />
          </template>
        </div>
      </div>
    </template>
    <template #rule_set>
      <RouteRulesetConfig
        ref="rulesetConfigRef"
        v-model="model.rule_set"
        :outbound-options="outboundOptions"
      />
    </template>
    <template #rules>
      <RouteRulesConfig
        ref="rulesConfigRef"
        v-model="model.rules"
        :inbound-options="inboundOptions"
        :outbound-options="outboundOptions"
        :outbounds="outbounds"
        :server-options="serverOptions"
        :rule-set="model.rule_set"
      />
    </template>
  </Tabs>
</template>
