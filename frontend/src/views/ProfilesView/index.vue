<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n, I18nT } from 'vue-i18n'

import { ClipboardSetText } from '@/bridge'
import { DraggableOptions, ViewOptions } from '@/constant/app'
import { View } from '@/enums/app'
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
  modal,
} from '@/utils'

import ProfileEditor from './components/ProfileEditor.vue'
import ProfileForm from './components/ProfileForm.vue'

const { t } = useI18n()
const appStore = useAppStore()
const profilesStore = useProfilesStore()
const subscribesStore = useSubscribesStore()
const appSettingsStore = useAppSettingsStore()
const kernelApiStore = useKernelApiStore()
const pluginsStore = usePluginsStore()
const keywords = ref('')
const switchingProfileId = ref('')

const filteredProfiles = computed(() => {
  const q = keywords.value.trim().toLowerCase()
  if (!q) return profilesStore.profiles
  return profilesStore.profiles.filter((p) => p.name.toLowerCase().includes(q))
})

const handleStartWithProfile = async (id: string) => {
  appSettingsStore.app.kernel.profile = id
  switchingProfileId.value = id
  try {
    const e = await kernelApiStore.stopCore().catch((e) => e)
    if (e && e !== 'The core is not running') {
      throw e
    }
    await kernelApiStore.startCore()
    message.success('common.success')
  } catch (error: any) {
    message.error(error)
    console.error(error)
  } finally {
    switchingProfileId.value = ''
  }
}

const handleDuplicateProfile = (id: string) => {
  const p = deepClone(profilesStore.getProfileById(id)!)
  p.id = sampleID()
  p.name = p.name + '(Copy)'
  profilesStore.addProfile(p)
  message.success('common.success')
}

const handleCopyGeneratedConfig = async (id: string) => {
  const p = profilesStore.getProfileById(id)!
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
  const p = profilesStore.getProfileById(id)!
  try {
    const config = await generateConfig(p)
    alert(p.name, JSON.stringify(config, null, 2))
  } catch (error: any) {
    message.error(error.message || error)
  }
}

const handleEditProfileSource = (id: string) => {
  const profile = profilesStore.getProfileById(id)!
  const m = modal({ title: profile.name, width: '90', height: '90' })
  m.setContent(ProfileEditor, { profile }).open()
}

const menuList: App.Menu[] = [
  'profile.step.name',
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
      p && handleShowProfileForm(p.id, i)
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

  return builtInMenus
}

const handleShowProfileForm = (id?: string, step = 0) => {
  const m = modal({ title: id ? 'common.edit' : 'common.add', minWidth: '72' })
  m.setContent(ProfileForm, { id, step }).open()
}

const handleDeleteProfile = async (p: App.Profile) => {
  const { profile } = appSettingsStore.app.kernel
  if (profile === p.id && kernelApiStore.running) {
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
    message.success('common.success')
  } catch (error: any) {
    console.error('deleteProfile: ', error)
    message.error(error)
  }
}

const handleUseProfile = async (p: App.Profile) => {
  if (appSettingsStore.app.kernel.profile === p.id) return

  appSettingsStore.app.kernel.profile = p.id
  if (!kernelApiStore.running) {
    message.success('common.success')
    return
  }

  switchingProfileId.value = p.id
  try {
    await kernelApiStore.restartCore()
    message.success('common.success')
  } catch (error: any) {
    console.error('handleUseProfile: ', error)
    message.error(error.message || error)
  } finally {
    switchingProfileId.value = ''
  }
}

const isCreatedBySubscription = (id: string) => {
  return !!subscribesStore.getSubscribeById(id)
}

const showAuto = () => alert(t('common.warning'), 'profile.auto')

const onSortUpdate = debounce(profilesStore.saveProfiles, 1000)
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

  <div v-else class="grid-list-header">
    <Radio v-model="appSettingsStore.app.profilesView" :options="ViewOptions" />
    <span class="resource-count-badge">
      {{
        keywords.trim()
          ? `${filteredProfiles.length} / ${profilesStore.profiles.length}`
          : profilesStore.profiles.length
      }}
    </span>
    <Input
      v-model="keywords"
      size="small"
      clearable
      auto-size
      :placeholder="t('common.search')"
      class="resource-search mr-auto"
    />
    <CustomAction :actions="appStore.customActions.profiles_header" />
    <Button type="primary" icon="add" @click="handleShowProfileForm()">
      {{ t('common.add') }}
    </Button>
  </div>

  <Empty v-if="profilesStore.profiles.length > 0 && filteredProfiles.length === 0" />

  <div
    v-else-if="profilesStore.profiles.length > 0"
    v-draggable="[
      profilesStore.profiles,
      { ...DraggableOptions, disabled: Boolean(keywords.trim()), onUpdate: onSortUpdate },
    ]"
    :class="'grid-list-' + appSettingsStore.app.profilesView"
  >
    <Card
      v-for="p in filteredProfiles"
      :key="p.id"
      v-menu="generateMenus(p)"
      :title="p.name"
      :selected="appSettingsStore.app.kernel.profile === p.id"
      class="grid-list-item"
      @dblclick="handleUseProfile(p)"
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

      <template v-if="appSettingsStore.app.profilesView === View.Grid" #extra>
        <Dropdown>
          <Button
            type="text"
            size="small"
            icon="more"
            :loading="switchingProfileId === p.id"
            :aria-label="t('common.more') + ' · ' + p.name"
          />
          <template #overlay="{ close }">
            <div class="flex flex-col gap-2 min-w-160 p-6">
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleUseProfile(p)
                  }
                "
              >
                {{ t('common.use') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleStartWithProfile(p.id)
                  }
                "
              >
                {{ t('profiles.start') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleShowProfileForm(p.id)
                  }
                "
              >
                {{ t('common.edit') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleDuplicateProfile(p.id)
                  }
                "
              >
                {{ t('profiles.copy') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handlePreviewGeneratedConfig(p.id)
                  }
                "
              >
                {{ t('profiles.generateAndView') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleCopyGeneratedConfig(p.id)
                  }
                "
              >
                {{ t('profiles.copytoClipboard') }}
              </Button>
              <Button
                type="text"
                size="small"
                class="justify-start"
                @click="
                  () => {
                    close()
                    handleEditProfileSource(p.id)
                  }
                "
              >
                {{ t('profiles.editSourceFile') }}
              </Button>
              <Divider size="small" />
              <Button
                type="text"
                size="small"
                class="justify-start text-danger"
                @click="
                  () => {
                    close()
                    handleDeleteProfile(p)
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
          type="text"
          size="small"
          :loading="switchingProfileId === p.id"
          @click="handleUseProfile(p)"
        >
          {{ t('common.use') }}
        </Button>
        <Button type="text" size="small" @click="handleShowProfileForm(p.id)">
          {{ t('common.edit') }}
        </Button>
        <Button type="text" size="small" @click="handlePreviewGeneratedConfig(p.id)">
          {{ t('common.preview') }}
        </Button>
        <Button type="text" size="small" class="text-danger" @click="handleDeleteProfile(p)">
          {{ t('common.delete') }}
        </Button>
      </template>

      <div class="resource-meta-list">
        <div class="resource-meta-row">
          <span>{{ t('profiles.inbounds') }} / {{ t('profiles.outbounds') }}</span>
          <span class="resource-meta-value">{{ p.inbounds.length }} / {{ p.outbounds.length }}</span>
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

      <div
        v-if="appSettingsStore.app.profilesView === View.Grid"
        class="resource-card-footer"
        @dblclick.stop
      >
        <Button
          :type="appSettingsStore.app.kernel.profile === p.id ? 'text' : 'normal'"
          size="small"
          :disabled="appSettingsStore.app.kernel.profile === p.id"
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
  </div>
</template>
