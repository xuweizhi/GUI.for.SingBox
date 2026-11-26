<script setup lang="ts">
import { computed, h, inject, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { HttpGet } from '@/bridge'
import { DefaultRouteRule, DefaultRouteRuleset } from '@/constant/profile'
import { RulesetFormat, RulesetType, RuleType } from '@/enums/kernel'
import { useProfilesStore, useRulesetsStore } from '@/stores'
import { previewCode, deepClone, message, picker } from '@/utils'

import ResourceHubModal from '@/components/_common/ResourceHubModal.vue'
import Button from '@/components/Button/index.vue'
import Pagination from '@/components/Pagination/index.vue'

const pageSize = 27
const rulesetFormats = [RulesetFormat.Source, RulesetFormat.Binary]
const currentPage = ref(1)

const { t } = useI18n()
const rulesetsStore = useRulesetsStore()
const profilesStore = useProfilesStore()

const keywords = ref('')
const handleCancel = inject('cancel') as any

const category = ref('')
const installing = ref(new Set<string>())
watch([keywords, category], () => (currentPage.value = 1))

const filteredList = computed(() => {
  const q = keywords.value.trim().toLowerCase()
  return rulesetsStore.rulesetHub.list.filter(
    (ruleset) =>
      (!category.value || ruleset.type === category.value) &&
      (ruleset.name.toLowerCase().includes(q) || ruleset.type.toLowerCase().includes(q)),
  )
})

const currentList = computed(() => {
  return filteredList.value.slice(
    (currentPage.value - 1) * pageSize,
    (currentPage.value - 1) * pageSize + pageSize,
  )
})

const getRulesetUrlAndSuffix = (ruleset: App.RulesetHub['list'][number], format: RulesetFormat) => {
  const suffix = { [RulesetFormat.Binary]: '.srs', [RulesetFormat.Source]: '.json' }[format]
  const basrUrl = {
    geosite: rulesetsStore.rulesetHub.geosite,
    geoip: rulesetsStore.rulesetHub.geoip,
  }[ruleset.type]
  return [basrUrl + ruleset.name + suffix, suffix] as const
}

const handleAddRuleset = async (ruleset: App.RulesetHub['list'][number], format: RulesetFormat) => {
  const [url, suffix] = getRulesetUrlAndSuffix(ruleset, format)
  const id = ruleset.type + '_' + ruleset.name + '.' + format
  if (installing.value.has(id) || isAlreadyAdded(ruleset, format)) return
  installing.value.add(id)
  const file = ruleset.type + '_' + ruleset.name + suffix
  try {
    await rulesetsStore.addRuleset({
      id,
      name: `${ruleset.name}-${ruleset.type}${suffix}`,
      updateTime: 0,
      disabled: false,
      type: 'Http',
      format,
      path: 'data/rulesets/' + file,
      url,
      count: ruleset.count,
    })
    const { success } = message.info('rulesets.updating')
    await rulesetsStore.updateRuleset(id)
    success('common.success')
  } catch (error: any) {
    console.error(error)
    message.error(error.message || error)
  } finally {
    installing.value.delete(id)
  }
}

const handleAddRulesetToProfile = async (
  ruleset: App.RulesetHub['list'][number],
  format: RulesetFormat,
) => {
  const [url, suffix] = getRulesetUrlAndSuffix(ruleset, format)

  try {
    const selected = await picker
      .resource('profile', 'profiles.select', { min: 1, max: 1 })
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
      (item) => item.type === RulesetType.Remote && item.url === url,
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
        type: RulesetType.Remote,
        tag: `${ruleset.name}-${ruleset.type}${suffix}`,
        format,
        url,
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

const handlePreview = async (ruleset: App.RulesetHub['list'][number], format: RulesetFormat) => {
  const { destroy, error } = message.info('rulesets.fetching', 15_000)
  try {
    const { body } = await HttpGet(getRulesetUrlAndSuffix(ruleset, format)[0])
    destroy()
    previewCode(ruleset.name, typeof body === 'string' ? body : JSON.stringify(body, null, 2))
  } catch (err: any) {
    error(err.message || err)
    setTimeout(destroy, 2000)
  }
}

const handleUpdateHub = async () => {
  try {
    await rulesetsStore.updateRulesetHub()
    message.success('rulesets.updateSuccess')
  } catch (err: any) {
    message.error(err.message || err)
  }
}

const isAlreadyAdded = (ruleset: App.RulesetHub['list'][number], format: RulesetFormat) => {
  const id = ruleset.type + '_' + ruleset.name + '.' + format
  return rulesetsStore.getRulesetById(id)
}

if (rulesetsStore.rulesetHub.list.length === 0) {
  void handleUpdateHub()
}

const modalSlots = {
  action: () =>
    !rulesetsStore.rulesetHubLoading
      ? h(Pagination, {
          current: currentPage.value,
          'onUpdate:current': (current: number) => (currentPage.value = current),
          total: filteredList.value.length,
          pageSize: pageSize,
          size: 'small',
          class: 'mr-auto',
        })
      : null,
  cancel: () =>
    h(
      Button,
      {
        type: 'normal',
        onClick: handleCancel,
      },
      () => t('common.close'),
    ),
}

defineExpose({ modalSlots })
</script>

<template>
  <ResourceHubModal
    v-model:query="keywords"
    v-model:category="category"
    :categories="['geoip', 'geosite']"
    :loading="rulesetsStore.rulesetHubLoading"
    :count="filteredList.length"
    @refresh="handleUpdateHub"
  >
    <div class="responsive-card-grid text-12 mt-8 pb-16 pr-4">
      <Card v-for="ruleset in currentList" :key="ruleset.name + ruleset.type" :title="ruleset.name">
        <template #extra>
          <Tag
            v-if="rulesetFormats.some((format) => isAlreadyAdded(ruleset, format))"
            size="small"
            >{{ t('common.added') }}</Tag
          >
          <Tag size="small" color="cyan">{{ ruleset.type }}</Tag>
        </template>
        <div class="flex flex-col h-full">
          <div class="flex items-center justify-between">
            {{ t('rulesets.rulesetCount') }} : {{ ruleset.count }}
            <Button
              icon="preview"
              size="small"
              type="text"
              @click="handlePreview(ruleset, RulesetFormat.Source)"
            />
          </div>
          <div class="flex items-center justify-between">
            <Dropdown placement="bottom">
              <Button type="text" size="small" style="margin-left: -2px; padding-left: 2px">
                {{ t('common.more') }}
              </Button>
              <template #overlay="{ close }">
                <div class="flex flex-col gap-4 min-w-96 p-4">
                  <Button
                    v-for="format in rulesetFormats"
                    :key="format"
                    :loading="installing.has(ruleset.type + '_' + ruleset.name + '.' + format)"
                    :disabled="!!isAlreadyAdded(ruleset, format)"
                    type="text"
                    size="small"
                    @click="
                      () => {
                        close()
                        handleAddRuleset(ruleset, format)
                      }
                    "
                  >
                    <template v-if="isAlreadyAdded(ruleset, format)">
                      {{ t(`ruleset.format.${format}`) }} {{ t('common.added') }}
                    </template>
                    <template v-else>
                      {{ t('common.add') }} {{ t(`ruleset.format.${format}`) }}
                    </template>
                  </Button>
                </div>
              </template>
            </Dropdown>

            <Dropdown placement="bottom">
              <Button type="link" size="small">
                {{ t('rulesets.addToProfile') }}
              </Button>
              <template #overlay="{ close }">
                <div class="flex flex-col gap-4 min-w-96 p-4">
                  <Button
                    v-for="format in rulesetFormats"
                    :key="format"
                    type="text"
                    size="small"
                    @click="
                      () => {
                        close()
                        handleAddRulesetToProfile(ruleset, format)
                      }
                    "
                  >
                    {{ t(`ruleset.format.${format}`) }}
                  </Button>
                </div>
              </template>
            </Dropdown>
          </div>
        </div>
      </Card>
    </div>
  </ResourceHubModal>
</template>
