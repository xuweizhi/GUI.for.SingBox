<script setup lang="ts">
import { computed, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useI18n, I18nT } from 'vue-i18n'

import { DraggableOptions } from '@/constant/app'
import { EmptyRuleSet } from '@/constant/kernel'
import { View } from '@/enums/app'
import { RulesetFormat, RulesetType, RuleType } from '@/enums/kernel'
import { useRulesetsStore, useAppSettingsStore, useProfilesStore } from '@/stores'
import {
  confirm,
  debounce,
  formatRelativeTime,
  ignoredError,
  formatDate,
  message,
  deepClone,
  modal,
} from '@/utils'
import { removeUnusedResourceCache } from '@/utils/configPersistence'
import { addRulesetToProfile } from '@/utils/profileRuleset'

import ResourceActions from '@/components/_common/ResourceActions.vue'
import ResourcePageShell from '@/components/_common/ResourcePageShell.vue'

import RulesetForm from './components/RulesetForm.vue'
import RulesetHub from './components/RulesetHub.vue'
import RulesetView from './components/RulesetView.vue'

const sourceMenuList: App.Menu[] = [
  {
    label: 'rulesets.editRuleset',
    handler: (id: string) => handleEditRulesetList(id),
  },
  {
    label: 'common.clear',
    handler: (id: string) => handleClearRuleset(id),
  },
]

const { t } = useI18n()
const rulesetsStore = useRulesetsStore()
const appSettingsStore = useAppSettingsStore()
const profilesStore = useProfilesStore()
const usedBy = (id: string) =>
  profilesStore.profiles.filter((p) =>
    p.route.rule_set.some((r) => r.type === RulesetType.Local && r.path === id),
  )
const keywords = ref('')

const matches = computed(() => {
  const q = keywords.value.trim().toLowerCase()
  if (!q) return rulesetsStore.rulesets
  return rulesetsStore.rulesets.filter(
    (r) => r.name.toLowerCase().includes(q) || (r.path || '').toLowerCase().includes(q),
  )
})
const filter = ref('')
const sort = ref('manual')
const filters = [
  { label: 'common.enabled', value: 'enabled' },
  { label: 'common.disabled', value: 'disabled' },
]
const filteredRulesets = computed(() => {
  const records = matches.value.filter(
    (item) => !filter.value || (filter.value === 'disabled' ? item.disabled : !item.disabled),
  )
  return sort.value === 'name' ? records.sort((a, b) => a.name.localeCompare(b.name)) : records
})

const handleImportRuleset = async () => {
  const m = modal({
    title: 'rulesets.hub',
    toolbar: { minimize: true, maximize: true },
    cancelText: 'common.close',
    height: '90',
    width: '90',
    submit: false,
    maskClosable: true,
  })
  m.setContent(RulesetHub).open()
}

const handleShowRulesetForm = async (id?: string, isUpdate = false) => {
  const m = modal({
    title: isUpdate ? 'common.edit' : 'common.add',
    maxHeight: '90',
    size: 'lg',
  })
  m.setContent(RulesetForm, { id, isUpdate }).open()
}

const updatingAll = ref(false)
const handleUpdateRulesets = async () => {
  if (updatingAll.value || rulesetsStore.rulesets.some((item) => item.updating)) return
  updatingAll.value = true
  try {
    const results = await rulesetsStore.updateRulesets()
    const failures = results.filter((item) => !item.ok)
    if (failures.length) throw new Error(failures.map((item) => item.result).join('\n'))
    message.success('common.success')
  } catch (error: any) {
    console.error('updateRulesets: ', error)
    message.error(error)
  } finally {
    updatingAll.value = false
  }
}

const handleEditRulesetList = (id: string) => {
  const m = modal({
    title: rulesetsStore.getRulesetById(id)?.name,
    height: '90',
    width: '90',
  })
  m.setContent(RulesetView, { id }).open()
}

const handleUpdateRuleset = async (r: App.RuleSet) => {
  if (updatingAll.value || r.updating) return
  try {
    await rulesetsStore.updateRuleset(r.id)
  } catch (error: any) {
    console.error('updateRuleset: ', error)
    message.error(error)
  }
}

const handleDeleteRuleset = async (r: App.RuleSet) => {
  try {
    await confirm(
      t('common.delete'),
      [
        t('common.confirmDelete', [r.name]),
        ...usedBy(r.id).map((p) => t('workspace.usedBy', [p.name])),
      ].join('\n'),
      {
        type: 'text',
        okText: 'common.delete',
        danger: true,
      },
    )
  } catch {
    return
  }

  try {
    const affectedProfiles = usedBy(r.id)
    await rulesetsStore.deleteRuleset(r.id)
    for (const profile of affectedProfiles) {
      const nextProfile = deepClone(profile)
      const removedIds = new Set(
        nextProfile.route.rule_set
          .filter((item) => item.type === RulesetType.Local && item.path === r.id)
          .map((item) => item.id),
      )
      if (!removedIds.size) continue
      nextProfile.route.rule_set = nextProfile.route.rule_set.filter(
        (item) => !removedIds.has(item.id),
      )
      const stripRulesetRefs = <T extends { type: string; payload: string; enable: boolean }>(
        rules: T[],
      ) => {
        for (const rule of rules) {
          if (rule.type !== RuleType.RuleSet) continue
          const remaining = rule.payload
            .split(',')
            .filter((entry) => entry && !removedIds.has(entry))
          if (remaining.join(',') !== rule.payload) {
            rule.payload = remaining.join(',')
            if (!rule.payload) rule.enable = false
          }
        }
      }
      stripRulesetRefs(nextProfile.route.rules)
      stripRulesetRefs(nextProfile.dns.rules)
      await profilesStore.editProfile(nextProfile.id, nextProfile)
    }
    await ignoredError(removeUnusedResourceCache, r, rulesetsStore.rulesets)
    message.success('common.success')
  } catch (error: any) {
    console.error('deleteRuleset: ', error)
    message.error(error)
  }
}

const handleDisableRuleset = async (r: App.RuleSet) => {
  try {
    await rulesetsStore.editRuleset(r.id, { ...r, disabled: !r.disabled })
  } catch (error) {
    message.error(error)
  }
}

const handleClearRuleset = async (id: string) => {
  const r = rulesetsStore.getRulesetById(id)
  if (!r) return
  if (r.format != RulesetFormat.Source) return

  try {
    if (
      !(await confirm(t('common.clear'), t('common.confirmClear', [r.name]), {
        type: 'text',
        danger: true,
        okText: 'common.clear',
      }).then(
        () => true,
        () => false,
      ))
    )
      return
    await rulesetsStore.saveLocalRuleset(r.id, JSON.stringify(EmptyRuleSet, null, 2))
    message.success('common.success')
  } catch (error: any) {
    message.error(error)
    console.error(error)
  }
}

const handleAddRulesetToProfile = async (id: string) => {
  const ruleset = rulesetsStore.getRulesetById(id)
  if (!ruleset) return

  try {
    await addRulesetToProfile({
      kind: 'local',
      id: ruleset.id,
      name: ruleset.name,
      format: ruleset.format,
    })
  } catch (error) {
    message.error(error)
  }
}

const generateMenus = (r: App.RuleSet) => {
  const addToProfileMenu: App.Menu = {
    label: 'rulesets.addToProfile',
    handler: (id: string) => handleAddRulesetToProfile(id),
  }

  const actions = {
    [RulesetFormat.Source]: [addToProfileMenu, ...sourceMenuList],
    [RulesetFormat.Binary]: [addToProfileMenu],
  }[r.format].map((v) => ({ ...v, handler: () => v.handler?.(r.id) }))
  return [
    {
      label: 'common.update',
      disabled: r.disabled || r.updating || updatingAll.value,
      handler: () => handleUpdateRuleset(r),
    },
    ...actions,
    {
      label: r.disabled ? 'common.enable' : 'common.disable',
      handler: () => handleDisableRuleset(r),
    },
    { label: 'common.edit', handler: () => handleShowRulesetForm(r.id, true) },
    { label: 'common.delete', handler: () => handleDeleteRuleset(r) },
  ]
}

const noUpdateNeeded = computed(() => rulesetsStore.rulesets.every((v) => v.disabled))
const anyUpdating = computed(
  () => updatingAll.value || rulesetsStore.rulesets.some((item) => item.updating),
)

const onSortUpdate = debounce(
  () => rulesetsStore.saveRulesets().catch((error) => message.error(error)),
  1000,
)
</script>

<template>
  <div v-if="rulesetsStore.rulesets.length === 0" class="grid-list-empty">
    <Empty>
      <template #description>
        <I18nT keypath="rulesets.empty" tag="div" scope="global" class="flex items-center mt-12">
          <template #action>
            <Button type="link" @click="handleShowRulesetForm()">{{ t('common.add') }}</Button>
          </template>
          <template #import>
            <Button type="link" @click="handleImportRuleset">{{ t('rulesets.hub') }}</Button>
          </template>
        </I18nT>
      </template>
    </Empty>
  </div>

  <ResourcePageShell
    v-else
    v-model:query="keywords"
    v-model:view="appSettingsStore.app.rulesetsView"
    v-model:sort="sort"
    v-model:filter="filter"
    :filters="filters"
    :total="rulesetsStore.rulesets.length"
    :count="filteredRulesets.length"
  >
    <Button type="link" @click="handleImportRuleset">
      {{ t('rulesets.hub') }}
    </Button>
    <Button
      :disabled="noUpdateNeeded || anyUpdating"
      :type="noUpdateNeeded ? 'text' : 'link'"
      :loading="updatingAll"
      @click="handleUpdateRulesets"
    >
      {{ t('common.updateAll') }}
    </Button>
    <Button type="primary" icon="add" @click="handleShowRulesetForm()">
      {{ t('common.add') }}
    </Button>
  </ResourcePageShell>

  <VueDraggable
    v-if="filteredRulesets.length"
    v-model="rulesetsStore.rulesets"
    v-bind="DraggableOptions"
    :disabled="Boolean(keywords.trim() || filter || sort !== 'manual')"
    :class="'grid-list-' + appSettingsStore.app.rulesetsView"
    @update="onSortUpdate"
  >
    <Card
      v-for="r in filteredRulesets"
      :key="r.id"
      v-menu="generateMenus(r)"
      :title="r.name"
      :disabled="r.disabled"
      class="grid-list-item"
    >
      <template #title-prefix>
        <Tag v-if="r.updating" color="cyan" size="small">
          {{ t('ruleset.updating') }}
        </Tag>
      </template>

      <template #extra><ResourceActions :items="generateMenus(r)" :name="r.name" /></template>

      <div class="resource-meta-list">
        <div class="flex items-center gap-6 mb-4">
          <Tag size="small" :color="r.format === RulesetFormat.Binary ? 'purple' : 'cyan'">
            {{ t('ruleset.format.' + r.format) }}
          </Tag>
          <Tag v-if="r.format === RulesetFormat.Source" size="small" color="default">
            {{ t('rulesets.rulesetCount') }}: {{ r.count }}
          </Tag>
        </div>
        <div class="resource-meta-row">
          <span>{{ t('common.updateTime') }}</span>
          <span class="resource-meta-value">
            {{
              r.updateTime
                ? appSettingsStore.app.rulesetsView === View.Grid
                  ? formatRelativeTime(r.updateTime)
                  : formatDate(r.updateTime, 'YYYY-MM-DD HH:mm:ss')
                : '--'
            }}
          </span>
        </div>
      </div>

      <div v-if="usedBy(r.id).length" class="flex flex-wrap items-center gap-6 mt-8 text-12">
        <span class="text-muted">{{ t('nodeGroups.dependencies') }}</span>
        <RouterLink
          v-for="p in usedBy(r.id)"
          :key="p.id"
          :to="{ name: 'EditProfile', params: { id: p.id }, query: { step: 4, tab: 'rule_set' } }"
          ><Tag size="small">{{ p.name }}</Tag></RouterLink
        >
      </div>

      <div class="resource-card-footer">
        <Button
          :disabled="r.disabled || updatingAll"
          :loading="r.updating"
          type="normal"
          size="small"
          icon="refresh"
          @click="handleUpdateRuleset(r)"
        >
          {{ t('common.update') }}
        </Button>
        <Button
          v-if="r.format === RulesetFormat.Source"
          type="text"
          size="small"
          @click="handleEditRulesetList(r.id)"
        >
          {{ t('rulesets.editRuleset') }}
        </Button>
        <Button v-else type="text" size="small" @click="handleAddRulesetToProfile(r.id)">
          {{ t('rulesets.addToProfile') }}
        </Button>
        <Button type="text" size="small" class="ml-auto" @click="handleShowRulesetForm(r.id, true)">
          {{ t('common.edit') }}
        </Button>
      </div>
    </Card>
  </VueDraggable>
</template>
