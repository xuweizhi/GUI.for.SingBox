<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useNodeGroupsStore } from '@/stores'
import { confirm, message, modal } from '@/utils'

import NodeGroupForm from './components/NodeGroupForm.vue'

const { t } = useI18n()
const nodeGroupsStore = useNodeGroupsStore()
const keywords = ref('')

const groupCards = computed(() => {
  const q = keywords.value.trim().toLowerCase()
  return nodeGroupsStore.nodeGroups
    .filter((group) => !q || group.name.toLowerCase().includes(q))
    .map((group) => ({
      group,
      resolution: nodeGroupsStore.resolveGroup(group),
      dependencies: nodeGroupsStore.getDependencies(group.id),
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
  try {
    if (dependencies.length) {
      const lines = dependencies
        .map((dependency) => `${dependency.profileName} / ${dependency.outboundName}`)
        .join('\n')
      await confirm(t('common.delete'), t('nodeGroups.deleteReferenced', [lines]), {
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
    await nodeGroupsStore.deleteNodeGroup(group.id, { cascade: dependencies.length > 0 })
    message.success('common.success')
  } catch (error: any) {
    if (error !== t('common.canceled')) message.error(error.message || error)
  }
}
</script>

<template>
  <div class="grid-list-header">
    <span class="resource-count-badge">
      {{
        keywords.trim()
          ? `${groupCards.length} / ${nodeGroupsStore.nodeGroups.length}`
          : nodeGroupsStore.nodeGroups.length
      }}
    </span>
    <Input
      v-if="nodeGroupsStore.nodeGroups.length > 0"
      v-model="keywords"
      size="small"
      clearable
      auto-size
      :placeholder="t('common.search')"
      class="resource-search mr-auto"
    />
    <div v-else class="mr-auto"></div>
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

  <Empty v-else-if="groupCards.length === 0" />

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
          icon-color="var(--danger-color)"
          type="text"
          size="small"
          @click="removeGroup(card.group)"
        />
      </template>
      <div class="flex flex-col gap-8 text-12">
        <div class="flex flex-wrap gap-6">
          <Tag color="blue" size="small">{{ t(`nodeGroups.${card.group.mode}`) }}</Tag>
          <Tag size="small">{{ t('nodeGroups.resolved') }} {{ card.resolution.nodes.length }}</Tag>
          <Tag v-if="card.resolution.issues.length" color="orange" size="small">
            {{ t('nodeGroups.unresolved') }} {{ card.resolution.issues.length }}
          </Tag>
        </div>
        <div class="text-muted">
          {{ t('nodeGroups.dependencies') }}:
          <template v-if="card.dependencies.length">
            <span class="resource-meta-value">
              {{
                card.dependencies
                  .map((item) => `${item.profileName} / ${item.outboundName}`)
                  .join('、')
              }}
            </span>
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
    </Card>
  </div>
</template>
