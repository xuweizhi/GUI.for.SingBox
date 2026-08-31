<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useNodeGroupsStore } from '@/stores'
import { confirm, message, modal } from '@/utils'

import NodeGroupForm from './components/NodeGroupForm.vue'

const { t } = useI18n()
const nodeGroupsStore = useNodeGroupsStore()
const groupCards = computed(() =>
  nodeGroupsStore.nodeGroups.map((group) => ({
    group,
    resolution: nodeGroupsStore.resolveGroup(group),
    dependencies: nodeGroupsStore.getDependencies(group.id),
  })),
)

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
  try {
    if (dependencies.length) {
      const lines = dependencies
        .map((dependency) => `${dependency.profileName} / ${dependency.outboundName}`)
        .join('\n')
      await confirm(
        t('common.delete'),
        t('nodeGroups.deleteReferenced', [lines]),
        { type: 'text', okText: 'common.delete' },
      )
    } else {
      await confirm(t('common.delete'), group.name, { type: 'text', okText: 'common.delete' })
    }
    await nodeGroupsStore.deleteNodeGroup(group.id, { cascade: dependencies.length > 0 })
    message.success('common.success')
  } catch (error: any) {
    if (error !== t('common.canceled')) message.error(error.message || error)
  }
}
</script>

<template>
  <div class="grid-list-header">
    <div class="mr-auto font-bold">{{ t('nodeGroups.title') }}</div>
    <Button type="primary" icon="add" @click="openForm()">{{ t('common.add') }}</Button>
  </div>

  <div v-if="nodeGroupsStore.nodeGroups.length === 0" class="grid-list-empty">
    <Empty :description="t('nodeGroups.empty')">
      <template #description>
        <div>{{ t('nodeGroups.empty') }}</div>
        <Button type="link" class="mt-8" @click="openForm()">{{ t('common.add') }}</Button>
      </template>
    </Empty>
  </div>

  <div v-else class="grid-list-grid">
    <Card
      v-for="card in groupCards"
      :key="card.group.id"
      :title="card.group.name"
      class="grid-list-item"
    >
      <template #title-prefix>
        <img v-if="card.group.icon" :src="card.group.icon" class="w-18 h-18 mr-4" />
      </template>
      <template #extra>
        <Button
          v-tips="'common.edit'"
          :aria-label="t('common.edit')"
          icon="edit"
          type="text"
          size="small"
          @click="openForm(card.group.id)"
        />
        <Button
          v-tips="'common.delete'"
          :aria-label="t('common.delete')"
          icon="delete"
          type="text"
          size="small"
          @click="removeGroup(card.group)"
        />
      </template>
      <div class="flex flex-col gap-8 text-12">
        <div class="flex gap-6">
          <Tag color="blue">{{ t(`nodeGroups.${card.group.mode}`) }}</Tag>
          <Tag>{{ t('nodeGroups.resolved') }} {{ card.resolution.nodes.length }}</Tag>
          <Tag v-if="card.resolution.issues.length" color="orange">
            {{ t('nodeGroups.unresolved') }} {{ card.resolution.issues.length }}
          </Tag>
        </div>
        <div>
          {{ t('nodeGroups.dependencies') }}:
          <template v-if="card.dependencies.length">
            {{ card.dependencies.map((item) => `${item.profileName} / ${item.outboundName}`).join('、') }}
          </template>
          <span v-else class="opacity-60">{{ t('nodeGroups.noDependencies') }}</span>
        </div>
        <div class="flex flex-wrap gap-4">
          <Tag v-for="node in card.resolution.nodes.slice(0, 8)" :key="node.key">
            {{ node.proxy.tag }}
          </Tag>
          <span v-if="card.resolution.nodes.length > 8">…</span>
        </div>
      </div>
    </Card>
  </div>
</template>
