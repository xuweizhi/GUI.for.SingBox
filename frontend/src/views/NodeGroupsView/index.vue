<script setup lang="ts">
import { computed, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useI18n } from 'vue-i18n'

import { DraggableOptions } from '@/constant/app'
import { useAppSettingsStore, useNodeGroupsStore } from '@/stores'
import { confirm, message, modal } from '@/utils'

import ResourceActions from '@/components/_common/ResourceActions.vue'
import ResourcePageShell from '@/components/_common/ResourcePageShell.vue'

import NodeGroupForm from './components/NodeGroupForm.vue'

const { t } = useI18n()
const nodeGroupsStore = useNodeGroupsStore()
const settings = useAppSettingsStore()
const filter = ref('')
const sort = ref('manual')
const keywords = ref('')

const groupCards = computed(() => {
  const q = keywords.value.trim().toLowerCase()
  return nodeGroupsStore.nodeGroups
    .filter(
      (group) =>
        (!q || group.name.toLowerCase().includes(q)) &&
        (!filter.value || group.mode === filter.value),
    )
    .sort((a, b) => (sort.value === 'name' ? a.name.localeCompare(b.name) : 0))
    .map((group) => ({
      group,
      resolution: nodeGroupsStore.resolveGroup(group),
      dependencies: nodeGroupsStore.getDependencies(group.id),
      preProxyGroup: group.pre_proxy_group_id
        ? nodeGroupsStore.getNodeGroupById(group.pre_proxy_group_id)
        : undefined,
      preProxyDependents: nodeGroupsStore.getPreProxyDependents(group.id),
    }))
})

const openForm = (id?: string) => {
  const instance = modal({
    title: id ? 'common.edit' : 'common.add',
    width: '90',
    height: '90',
  })
  instance.setContent(NodeGroupForm, { id }).open()
}

const removeGroup = async (group: App.NodeGroup) => {
  const dependencies = nodeGroupsStore.getDependencies(group.id)
  const dependentGroups = nodeGroupsStore.getPreProxyDependents(group.id)
  const hasReferences = dependencies.length > 0 || dependentGroups.length > 0
  try {
    if (hasReferences) {
      const sections: string[] = []
      if (dependencies.length) {
        const lines = dependencies
          .map((dependency) =>
            dependency.viaGroupName
              ? `${dependency.profileName} / ${dependency.outboundName} (${dependency.viaGroupName})`
              : `${dependency.profileName} / ${dependency.outboundName}`,
          )
          .join('\n')
        sections.push(t('nodeGroups.deleteReferenced', [lines]))
      }
      if (dependentGroups.length) {
        const names = dependentGroups.map((item) => item.name).join('\n')
        sections.push(t('nodeGroups.deleteReferencedPreProxy', [names]))
      }
      await confirm(t('common.delete'), sections.join('\n\n'), {
        type: 'text',
        okText: 'common.delete',
        danger: true,
      })
    } else {
      await confirm(t('common.delete'), t('common.confirmDelete', [group.name]), {
        type: 'text',
        okText: 'common.delete',
        danger: true,
      })
    }
    await nodeGroupsStore.deleteNodeGroup(group.id, { cascade: hasReferences })
    message.success('common.success')
  } catch (error: any) {
    if (error !== t('common.canceled')) message.error(error.message || error)
  }
}
const actions = (group: App.NodeGroup) => [
  { label: 'common.edit', handler: () => openForm(group.id) },
  { label: 'common.delete', handler: () => removeGroup(group) },
]
</script>

<template>
  <ResourcePageShell
    v-if="nodeGroupsStore.nodeGroups.length"
    v-model:view="settings.app.nodeGroupsView"
    v-model:query="keywords"
    v-model:sort="sort"
    v-model:filter="filter"
    :filters="[
      { label: 'nodeGroups.manual', value: 'manual' },
      { label: 'nodeGroups.filter', value: 'filter' },
    ]"
    :count="groupCards.length"
    :total="nodeGroupsStore.nodeGroups.length"
  >
    <Button type="primary" icon="add" @click="openForm()">{{ t('common.add') }}</Button>
  </ResourcePageShell>
  <div v-if="!nodeGroupsStore.nodeGroups.length" class="grid-list-empty">
    <Empty description="nodeGroups.empty">
      <template #description>
        <div class="text-12 text-muted mt-8">{{ t('nodeGroups.empty') }}</div>
        <Button type="primary" icon="add" class="mt-12" @click="openForm()">{{
          t('common.add')
        }}</Button>
      </template>
    </Empty>
  </div>
  <VueDraggable
    v-if="groupCards.length"
    v-model="nodeGroupsStore.nodeGroups"
    v-bind="DraggableOptions"
    :disabled="!!filter || !!keywords.trim() || sort !== 'manual'"
    :class="'grid-list-' + settings.app.nodeGroupsView"
    @update="nodeGroupsStore.saveNodeGroups().catch(message.error)"
  >
    <Card
      v-for="card in groupCards"
      :key="card.group.id"
      v-menu="actions(card.group)"
      :title="card.group.name"
      class="grid-list-item"
      @dblclick="openForm(card.group.id)"
    >
      <template #title-prefix>
        <img v-if="card.group.icon" :src="card.group.icon" class="w-18 h-18 mr-4" />
      </template>
      <template #extra
        ><ResourceActions :items="actions(card.group)" :name="card.group.name" />
      </template>
      <div class="flex flex-col gap-8 text-12">
        <div class="flex flex-wrap gap-6">
          <Tag color="blue" size="small">{{ t(`nodeGroups.${card.group.mode}`) }}</Tag>
          <Tag size="small">{{ t('nodeGroups.resolved') }} {{ card.resolution.nodes.length }}</Tag>
          <Tag
            v-if="card.group.pre_proxy_group_id"
            :color="card.preProxyGroup ? 'purple' : 'orange'"
            size="small"
          >
            {{ t('nodeGroups.preProxyBadge') }}:
            {{ card.preProxyGroup?.name || card.group.pre_proxy_group_id }}
          </Tag>
          <Tag v-if="card.resolution.issues.length" color="orange" size="small">
            {{ t('nodeGroups.unresolved') }} {{ card.resolution.issues.length }}
          </Tag>
        </div>
        <div class="flex flex-wrap items-center gap-4 text-muted">
          {{ t('nodeGroups.dependencies') }}:
          <template v-if="card.dependencies.length">
            <RouterLink
              v-for="dep in card.dependencies"
              :key="dep.profileId + dep.outboundId"
              :to="{
                name: 'EditProfile',
                params: { id: dep.profileId },
                query: { step: 3, outbound: dep.outboundId },
              }"
              @dblclick.stop
              ><Tag size="small">{{ dep.profileName }} / {{ dep.outboundName }}</Tag></RouterLink
            >
          </template>
          <span v-else>{{ t('nodeGroups.noDependencies') }}</span>
        </div>
        <div class="flex flex-wrap gap-4">
          <Tag v-for="node in card.resolution.nodes.slice(0, 8)" :key="node.key" size="small">
            {{ node.proxy.tag }}
          </Tag>
          <span v-if="card.resolution.nodes.length > 8" class="text-muted">
            +{{ card.resolution.nodes.length - 8 }}
          </span>
        </div>
      </div>
      <div class="resource-card-footer" @dblclick.stop>
        <Button size="small" icon="edit" @click.stop="openForm(card.group.id)">
          {{ t('common.edit') }}
        </Button>
      </div>
    </Card>
  </VueDraggable>
</template>
