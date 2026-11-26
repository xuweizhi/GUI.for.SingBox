<script setup lang="ts">
import { computed, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useI18n, I18nT } from 'vue-i18n'

import { DraggableOptions } from '@/constant/app'
import { EmptyRuleSet } from '@/constant/kernel'
import { DefaultRouteRule, DefaultRouteRuleset } from '@/constant/profile'
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
  picker,
  deepClone,
  modal,
} from '@/utils'
import { removeUnusedResourceCache } from '@/utils/configPersistence'

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
    await rulesetsStore.deleteRuleset(r.id)
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
    const selected = await picker
      .resource('profile', 'profiles.select', { max: 1, min: 1 })
      .catch(() => undefined)
    const profile = selected?.items[0]
    if (!profile) return

    const insertionPointIndex = profile.route.rules.findIndex(
      (rule) => rule.type === RuleType.InsertionPoint,
    )

    if (insertionPointIndex === -1) {
      message.warn('kernel.missingInsertionPoint')
      return
    }

    const profileRuleset = profile.route.rule_set.find(
      (item) => item.type === RulesetType.Local && item.path === ruleset.id,
    )
    if (
      profileRuleset &&
      profile.route.rules.some(
        (rule) =>
          rule.type === RuleType.RuleSet && rule.payload.split(',').includes(profileRuleset.id),
      )
    ) {
      message.info('common.added')
      return
    }

    const outboundOptions = profile.outbounds.map((outbound) => ({
      label: outbound.tag,
      value: outbound.id,
      description: outbound.type,
    }))
    if (!outboundOptions.length) {
      message.warn('kernel.route.rules.invalid')
      return
    }
    const target = await picker
      .single('kernel.route.rules.outbound', outboundOptions, [outboundOptions[0]!.value])
      .catch(() => undefined)
    if (!target) return

    const nextProfile = deepClone(profile)
    let rulesetReferenceId = profileRuleset?.id
    if (!rulesetReferenceId) {
      const rulesetReference = {
        ...DefaultRouteRuleset(),
        tag: ruleset.name,
        format: ruleset.format,
        path: ruleset.id,
      }
      nextProfile.route.rule_set.unshift(rulesetReference)
      rulesetReferenceId = rulesetReference.id
    }

    nextProfile.route.rules.splice(insertionPointIndex + 1, 0, {
      ...DefaultRouteRule(),
      payload: rulesetReferenceId,
      outbound: target,
    })

    await profilesStore.editProfile(nextProfile.id, nextProfile)
    message.success('common.success')
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
      disabled: r.disabled || r.updating,
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

const onSortUpdate = debounce(rulesetsStore.saveRulesets, 1000)
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
      :disabled="noUpdateNeeded"
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

      <div class="resource-card-footer">
        <Button
          :disabled="r.disabled"
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
      </div>
      <div v-if="usedBy(r.id).length" class="flex flex-wrap gap-6 mt-8">
        <span class="text-muted">{{ t('nodeGroups.dependencies') }}</span>
        <RouterLink
          v-for="p in usedBy(r.id)"
          :key="p.id"
          :to="{ name: 'EditProfile', params: { id: p.id }, query: { step: 4 } }"
          ><Tag size="small">{{ p.name }}</Tag></RouterLink
        >
      </div>
    </Card>
  </VueDraggable>
</template>
