<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n, I18nT } from 'vue-i18n'

import { RemoveFile, WriteFile } from '@/bridge'
import { DraggableOptions, ViewOptions } from '@/constant/app'
import { BuiltInOutbound, EmptyRuleSet } from '@/constant/kernel'
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
const keywords = ref('')

const filteredRulesets = computed(() => {
  const q = keywords.value.trim().toLowerCase()
  if (!q) return rulesetsStore.rulesets
  return rulesetsStore.rulesets.filter(
    (r) => r.name.toLowerCase().includes(q) || (r.path || '').toLowerCase().includes(q),
  )
})

const handleImportRuleset = async () => {
  const m = modal({
    title: 'rulesets.hub',
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
    minWidth: '70',
  })
  m.setContent(RulesetForm, { id, isUpdate }).open()
}

const handleUpdateRulesets = async () => {
  try {
    await rulesetsStore.updateRulesets()
    message.success('common.success')
  } catch (error: any) {
    console.error('updateRulesets: ', error)
    message.error(error)
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
  try {
    await rulesetsStore.updateRuleset(r.id)
  } catch (error: any) {
    console.error('updateRuleset: ', error)
    message.error(error)
  }
}

const handleDeleteRuleset = async (r: App.RuleSet) => {
  try {
    await confirm(t('common.delete'), t('common.confirmDelete', [r.name]), {
      type: 'text',
      okText: 'common.delete',
      danger: true,
    })
  } catch {
    return
  }

  try {
    await ignoredError(RemoveFile, r.path)
    await rulesetsStore.deleteRuleset(r.id)
    message.success('common.success')
  } catch (error: any) {
    console.error('deleteRuleset: ', error)
    message.error(error)
  }
}

const handleDisableRuleset = async (r: App.RuleSet) => {
  r.disabled = !r.disabled
  rulesetsStore.editRuleset(r.id, r)
}

const handleClearRuleset = async (id: string) => {
  const r = rulesetsStore.getRulesetById(id)
  if (!r) return
  if (r.format != RulesetFormat.Source) return

  try {
    await WriteFile(r.path, JSON.stringify(EmptyRuleSet, null, 2))
    rulesetsStore.editRuleset(r.id, r)
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
    const { items } = await picker.resource('profile', 'profiles.select', { max: 1, min: 1 })
    const profile = items[0]
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

    const outboundOptions = [
      ...BuiltInOutbound.map((outbound) => ({ label: outbound, value: outbound })),
      ...profile.outbounds.map((outbound) => ({
        label: outbound.tag,
        value: outbound.id,
        description: outbound.type,
      })),
    ]
    const target = await picker.single('kernel.route.rules.outbound', outboundOptions, [
      profile.outbounds[0]?.id || BuiltInOutbound[0]!,
    ])

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

  return {
    [RulesetFormat.Source]: [addToProfileMenu, ...sourceMenuList],
    [RulesetFormat.Binary]: [addToProfileMenu],
  }[r.format].map((v) => ({ ...v, handler: () => v.handler?.(r.id) }))
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

  <div v-else class="grid-list-header">
    <Radio v-model="appSettingsStore.app.rulesetsView" :options="ViewOptions" />
    <span class="resource-count-badge">{{ rulesetsStore.rulesets.length }}</span>
    <Input
      v-model="keywords"
      size="small"
      clearable
      auto-size
      :placeholder="t('common.search')"
      class="resource-search mr-auto"
    />
    <Button type="link" @click="handleImportRuleset">
      {{ t('rulesets.hub') }}
    </Button>
    <Button
      :disabled="noUpdateNeeded"
      :type="noUpdateNeeded ? 'text' : 'link'"
      @click="handleUpdateRulesets"
    >
      {{ t('common.updateAll') }}
    </Button>
    <Button type="primary" icon="add" class="ml-16" @click="handleShowRulesetForm()">
      {{ t('common.add') }}
    </Button>
  </div>

  <Empty v-if="rulesetsStore.rulesets.length > 0 && filteredRulesets.length === 0" />

  <div
    v-else-if="rulesetsStore.rulesets.length > 0"
    v-draggable="[
      rulesetsStore.rulesets,
      { ...DraggableOptions, disabled: Boolean(keywords.trim()), onUpdate: onSortUpdate },
    ]"
    :class="'grid-list-' + appSettingsStore.app.rulesetsView"
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

      <template v-if="appSettingsStore.app.rulesetsView === View.Grid" #extra>
        <Dropdown>
          <Button
            type="text"
            size="small"
            icon="more"
            :aria-label="t('common.more') + ' · ' + r.name"
          />
          <template #overlay="{ close }">
            <div class="flex flex-col gap-2 min-w-128 p-6">
              <Button
                :disabled="r.disabled"
                :loading="r.updating"
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleUpdateRuleset(r)
                  }
                "
              >
                {{ t('common.update') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleAddRulesetToProfile(r.id)
                  }
                "
              >
                {{ t('rulesets.addToProfile') }}
              </Button>
              <Button
                v-if="r.format === RulesetFormat.Source"
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleEditRulesetList(r.id)
                  }
                "
              >
                {{ t('rulesets.editRuleset') }}
              </Button>
              <Button
                v-if="r.format === RulesetFormat.Source"
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleClearRuleset(r.id)
                  }
                "
              >
                {{ t('common.clear') }}
              </Button>
              <Divider size="small" />
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleDisableRuleset(r)
                  }
                "
              >
                {{ r.disabled ? t('common.enable') : t('common.disable') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleShowRulesetForm(r.id, true)
                  }
                "
              >
                {{ t('common.edit') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start text-danger"
                @click="
                  () => {
                    close()
                    handleDeleteRuleset(r)
                  }
                "
              >
                {{ t('common.delete') }}
              </Button>
            </div>
          </template>
        </Dropdown>
      </template>

      <template v-else #extra>
        <Button
          :disabled="r.disabled"
          :loading="r.updating"
          type="text"
          size="small"
          @click="handleUpdateRuleset(r)"
        >
          {{ t('common.update') }}
        </Button>
        <Button type="text" size="small" @click="handleAddRulesetToProfile(r.id)">
          {{ t('rulesets.addToProfile') }}
        </Button>
        <Button
          v-if="r.format === RulesetFormat.Source"
          type="text"
          size="small"
          @click="handleEditRulesetList(r.id)"
        >
          {{ t('rulesets.editRuleset') }}
        </Button>
        <Button type="text" size="small" @click="handleDisableRuleset(r)">
          {{ r.disabled ? t('common.enable') : t('common.disable') }}
        </Button>
        <Button type="text" size="small" @click="handleShowRulesetForm(r.id, true)">
          {{ t('common.edit') }}
        </Button>
        <Button type="text" size="small" class="text-danger" @click="handleDeleteRuleset(r)">
          {{ t('common.delete') }}
        </Button>
      </template>

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
    </Card>
  </div>
</template>
