<script setup lang="ts">
import { computed, ref } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { useI18n, I18nT } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { ClipboardSetText } from '@/bridge'
import { DraggableOptions } from '@/constant/app'
import {
  useProfilesStore,
  useAppSettingsStore,
  useKernelApiStore,
  useSubscribesStore,
  usePluginsStore,
  useAppStore,
} from '@/stores'
import {
  confirm,
  debounce,
  deepClone,
  generateConfig,
  message,
  sampleID,
  alert,
  previewCode,
  modal,
} from '@/utils'

import ResourceActions from '@/components/_common/ResourceActions.vue'
import ResourcePageShell from '@/components/_common/ResourcePageShell.vue'

import ProfileEditor from './components/ProfileEditor.vue'
const router = useRouter()

const { t } = useI18n()
const appStore = useAppStore()
const profilesStore = useProfilesStore()
const subscribesStore = useSubscribesStore()
const appSettingsStore = useAppSettingsStore()
const kernelApiStore = useKernelApiStore()
const pluginsStore = usePluginsStore()
const keywords = ref('')
const switchingProfileId = ref('')

const matches = computed(() => {
  const q = keywords.value.trim().toLowerCase()
  if (!q) return profilesStore.profiles
  return profilesStore.profiles.filter((p) => p.name.toLowerCase().includes(q))
})
const filter = ref('')
const sort = ref('manual')
const filters = [
  { label: 'home.overview.currentProfile', value: 'active' },
  { label: 'common.auto', value: 'auto' },
]
const filteredProfiles = computed(() => {
  const records = matches.value.filter(
    (item) =>
      !filter.value ||
      (filter.value === 'active'
        ? item.id === appSettingsStore.app.kernel.profile
        : isCreatedBySubscription(item.id)),
  )
  return sort.value === 'name' ? records.sort((a, b) => a.name.localeCompare(b.name)) : records
})

const coreBusy = computed(
  () =>
    Boolean(switchingProfileId.value) ||
    kernelApiStore.starting ||
    kernelApiStore.stopping ||
    kernelApiStore.restarting,
)

const selectProfile = async (id: string, start = false) => {
  const previous = appSettingsStore.app.kernel.profile
  const wasRunning = kernelApiStore.running
  if (coreBusy.value || (id === previous && (wasRunning || !start))) return

  switchingProfileId.value = id
  appSettingsStore.app.kernel.profile = id
  try {
    if (wasRunning) await kernelApiStore.restartCore()
    else if (start) await kernelApiStore.startCore()
    message.success('common.success')
  } catch (error) {
    appSettingsStore.app.kernel.profile = previous
    message.error(error)
    if (wasRunning && previous && !kernelApiStore.running) {
      await kernelApiStore.startCore().catch((restoreError) => message.error(restoreError))
    }
  } finally {
    switchingProfileId.value = ''
  }
}

const handleStartWithProfile = (id: string) => selectProfile(id, true)
const handleUseProfile = (profile: App.Profile) => selectProfile(profile.id)

const handleDuplicateProfile = async (id: string) => {
  const source = profilesStore.getProfileById(id)
  if (!source) return
  const p = deepClone(source)
  p.id = sampleID()
  p.name = p.name + '(Copy)'
  if (p.experimental?.cache_file?.cache_id) {
    p.experimental.cache_file.cache_id = sampleID()
  }
  try {
    await profilesStore.addProfile(p)
    message.success('common.success')
  } catch (error) {
    message.error(error)
  }
}

const handleCopyGeneratedConfig = async (id: string) => {
  const p = profilesStore.getProfileById(id)
  if (!p) return
  try {
    const config = await generateConfig(p)
    const str = JSON.stringify(config, null, 2)
    const ok = await ClipboardSetText(str)
    if (!ok) throw 'ClipboardSetText Error'
    message.success('common.copied')
  } catch (error: any) {
    message.error(error.message || error)
  }
}

const handlePreviewGeneratedConfig = async (id: string) => {
  const p = profilesStore.getProfileById(id)
  if (!p) return
  try {
    const config = await generateConfig(p)
    previewCode(p.name, JSON.stringify(config, null, 2))
  } catch (error: any) {
    message.error(error.message || error)
  }
}

const handleEditProfileSource = (id: string) => {
  const profile = profilesStore.getProfileById(id)
  if (!profile) return
  const m = modal({ title: profile.name, width: '90', height: '90' })
  m.setContent(ProfileEditor, { profile }).open()
}

const menuList: App.Menu[] = [
  'profile.step.general',
  'profile.step.inbounds',
  'profile.step.outbounds',
  'profile.step.route',
  'profile.step.dns',
  'profile.step.mixin-script',
].map((v, i) => {
  return {
    label: v,
    handler: (id: string) => {
      const p = profilesStore.getProfileById(id)
      p && handleShowProfileForm(p.id, i + 1)
    },
  }
})

const secondaryMenusList: App.Menu[] = [
  {
    label: 'profiles.start',
    handler: handleStartWithProfile,
  },
  {
    label: 'profiles.copy',
    handler: handleDuplicateProfile,
  },
  {
    label: 'profiles.copytoClipboard',
    handler: handleCopyGeneratedConfig,
  },
  {
    label: 'profiles.generateAndView',
    handler: handlePreviewGeneratedConfig,
  },
  {
    label: 'profiles.editSourceFile',
    handler: handleEditProfileSource,
  },
]

const generateMenus = (profile: App.Profile) => {
  const moreMenus: App.Menu[] = secondaryMenusList.map((v) => ({
    ...v,
    disabled: v.label === 'profiles.start' ? coreBusy.value : v.disabled,
    handler: () => v.handler?.(profile.id),
  }))
  const builtInMenus: App.Menu[] = [
    ...menuList.map((v) => ({ ...v, handler: () => v.handler?.(profile.id) })),
    {
      label: '',
      separator: true,
    },
    {
      label: 'common.more',
      children: moreMenus,
    },
  ]

  const contextMenus = pluginsStore.plugins.filter(
    (plugin) => Object.keys(plugin.context.profiles).length !== 0,
  )

  if (contextMenus.length !== 0) {
    moreMenus.push(
      {
        label: '',
        separator: true,
      },
      ...contextMenus.reduce((prev, plugin) => {
        const menus = Object.entries(plugin.context.profiles)
        return prev.concat(
          menus.map(([title, fn]) => {
            return {
              label: title,
              handler: async () => {
                try {
                  plugin.running = true
                  await pluginsStore.manualTrigger(plugin.id, fn as any, profile)
                } catch (error: any) {
                  message.error(error)
                } finally {
                  plugin.running = false
                }
              },
            }
          }),
        )
      }, [] as App.Menu[]),
    )
  }

  return [
    {
      label: 'common.use',
      disabled: appSettingsStore.app.kernel.profile === profile.id || coreBusy.value,
      handler: () => handleUseProfile(profile),
    },
    ...builtInMenus,
    { label: 'common.delete', handler: () => handleDeleteProfile(profile) },
  ]
}

const handleShowProfileForm = (id?: string, step = 1) =>
  router.push(
    id
      ? { name: 'EditProfile', params: { id }, query: { step: Math.max(step, 1) } }
      : { name: 'NewProfile' },
  )

const handleDeleteProfile = async (p: App.Profile) => {
  const { profile } = appSettingsStore.app.kernel
  if (
    (profile === p.id &&
      (kernelApiStore.running || kernelApiStore.starting || kernelApiStore.restarting)) ||
    switchingProfileId.value === p.id
  ) {
    message.warn('profiles.shouldStop')
    return
  }

  try {
    await confirm(t('common.delete'), t('common.confirmDelete', [p.name]), {
      type: 'text',
      okText: 'common.delete',
      danger: true,
    })
  } catch {
    return
  }

  try {
    await profilesStore.deleteProfile(p.id)
    if (appSettingsStore.app.kernel.profile === p.id) {
      appSettingsStore.app.kernel.profile = ''
    }
    message.success('common.success')
  } catch (error: any) {
    console.error('deleteProfile: ', error)
    message.error(error)
  }
}

const isCreatedBySubscription = (id: string) => {
  return !!subscribesStore.getSubscribeById(id)
}

const showAuto = () => alert(t('common.warning'), 'profile.auto')

const onSortUpdate = debounce(
  () => profilesStore.saveProfiles().catch((error) => message.error(error)),
  1000,
)
</script>

<template>
  <div v-if="profilesStore.profiles.length === 0" class="grid-list-empty">
    <Empty>
      <template #description>
        <I18nT keypath="profiles.empty" tag="div" scope="global" class="flex items-center mt-12">
          <template #action>
            <Button type="link" @click="handleShowProfileForm()">{{ t('common.add') }}</Button>
          </template>
        </I18nT>
        <div class="flex items-center">
          <CustomAction :actions="appStore.customActions.profiles_header" />
        </div>
      </template>
    </Empty>
  </div>

  <ResourcePageShell
    v-else
    v-model:query="keywords"
    v-model:view="appSettingsStore.app.profilesView"
    v-model:sort="sort"
    v-model:filter="filter"
    :filters="filters"
    :total="profilesStore.profiles.length"
    :count="filteredProfiles.length"
  >
    <CustomAction :actions="appStore.customActions.profiles_header" />
    <Button type="primary" icon="add" @click="handleShowProfileForm()">
      {{ t('common.add') }}
    </Button>
  </ResourcePageShell>

  <VueDraggable
    v-if="filteredProfiles.length"
    v-model="profilesStore.profiles"
    v-bind="DraggableOptions"
    :disabled="Boolean(keywords.trim() || filter || sort !== 'manual')"
    :class="'grid-list-' + appSettingsStore.app.profilesView"
    @update="onSortUpdate"
  >
    <Card
      v-for="p in filteredProfiles"
      :key="p.id"
      v-menu="generateMenus(p)"
      :title="p.name"
      :selected="appSettingsStore.app.kernel.profile === p.id"
      class="grid-list-item"
      @dblclick="handleShowProfileForm(p.id)"
    >
      <template #title-prefix>
        <Tag
          v-if="isCreatedBySubscription(p.id)"
          color="primary"
          size="small"
          style="margin-left: 0"
          class="cursor-pointer"
          @click.stop="showAuto"
        >
          {{ t('common.auto') }}
        </Tag>
      </template>

      <template #extra><ResourceActions :items="generateMenus(p)" :name="p.name" /></template>

      <div class="resource-meta-list">
        <div class="resource-meta-row">
          <span>{{ t('profiles.inbounds') }} / {{ t('profiles.outbounds') }}</span>
          <span class="resource-meta-value"
            >{{ p.inbounds.length }} / {{ p.outbounds.length }}</span
          >
        </div>
        <div class="resource-meta-row">
          <span>{{ t('kernel.route.tab.rule_set') }} / {{ t('kernel.route.tab.rules') }}</span>
          <span class="resource-meta-value">
            {{ p.route.rule_set.length }} / {{ p.route.rules.length }}
          </span>
        </div>
        <div class="resource-meta-row">
          <span>{{ t('profiles.dnsServers') }} / {{ t('profiles.dnsRules') }}</span>
          <span class="resource-meta-value">
            {{ p.dns.servers.length }} / {{ p.dns.rules.length }}
          </span>
        </div>
      </div>

      <div class="resource-card-footer" @dblclick.stop>
        <Button
          :type="appSettingsStore.app.kernel.profile === p.id ? 'text' : 'normal'"
          size="small"
          :disabled="appSettingsStore.app.kernel.profile === p.id || coreBusy"
          :loading="switchingProfileId === p.id"
          @click="handleUseProfile(p)"
        >
          {{
            appSettingsStore.app.kernel.profile === p.id
              ? t('home.overview.currentProfile')
              : t('common.use')
          }}
        </Button>
        <Button type="text" size="small" icon="edit" @click="handleShowProfileForm(p.id)">
          {{ t('common.edit') }}
        </Button>
      </div>
    </Card>
  </VueDraggable>
</template>
