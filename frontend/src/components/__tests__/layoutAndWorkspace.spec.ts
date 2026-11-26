import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

const routeState = reactive({
  path: '/',
  name: 'Overview',
  fullPath: '/',
  query: {} as Record<string, string>,
  meta: { name: 'router.overview' },
})
const routerReplace = vi.fn((target: { query?: Record<string, string> }) => {
  routeState.query = { ...target.query }
  return Promise.resolve()
})
const routerPush = vi.fn()

const mocks = vi.hoisted(() => ({
  kernelStore: undefined as any,
  profilesStore: undefined as any,
  appSettingsStore: undefined as any,
  appStore: undefined as any,
  rulesetsStore: undefined as any,
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  confirm: vi.fn().mockResolvedValue(true),
  modal: vi.fn(() => ({ setContent: vi.fn(() => ({ open: vi.fn() })) })),
}))

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  useRouter: () => ({ replace: routerReplace, push: routerPush }),
  RouterLink: {
    props: ['to'],
    template: '<a :href="to" v-bind="$attrs"><slot /></a>',
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
  createI18n: () => ({ global: { t: (key: string) => key } }),
}))

vi.mock('@/lang', () => ({
  default: { global: { t: (key: string) => key } },
}))

vi.mock('@/router/routes', () => ({
  default: [
    {
      path: '/',
      name: 'Overview',
      meta: { name: 'router.overview', icon: 'overview', group: 'control' },
    },
    {
      path: '/netcheck',
      name: 'NetCheck',
      meta: { name: 'router.netcheck', icon: 'speedTest', group: 'control' },
    },
    {
      path: '/profiles',
      name: 'Profiles',
      meta: { name: 'router.profiles', icon: 'profiles', group: 'config' },
    },
    {
      path: '/settings',
      name: 'Settings',
      meta: { name: 'router.settings', icon: 'settings2', group: 'system', hidden: false },
    },
  ],
}))

vi.mock('@/stores', () => {
  mocks.kernelStore ||= reactive({
    running: true,
    starting: false,
    stopping: false,
    restarting: false,
    needRestart: false,
    coreStateLoading: false,
    config: {
      port: 7890,
      'socks-port': 7891,
      'mixed-port': 7892,
      'allow-lan': false,
      'interface-name': '',
      tun: { enable: false, stack: 'mixed', device: 'utun' },
    },
    startCore: vi.fn(),
    stopCore: vi.fn(),
    restartCore: vi.fn(),
    updateConfig: vi.fn().mockResolvedValue(undefined),
    refreshConfig: vi.fn().mockResolvedValue(undefined),
    refreshProviderProxies: vi.fn().mockResolvedValue(undefined),
  })
  mocks.profilesStore ||= reactive({
    profiles: [{ id: 'p1', name: 'Default Profile' }],
    currentProfile: { id: 'p1', name: 'Default Profile' },
  })
  mocks.appSettingsStore ||= reactive({
    themeMode: 'light',
    app: {
      theme: 'light',
      uiStyle: 'modern',
      navLayout: 'sidebar',
      uiDensity: 'comfortable',
      color: 'default',
      primaryColor: '#2563eb',
      secondaryColor: '#1d4ed8',
      fontFamily:
        'system-ui, "Microsoft YaHei UI", "Source Han Sans CN", "Twemoji Mozilla", sans-serif',
      fontSize: 14,
      customFontPresets: [] as App.CustomFontPreset[],
      pages: [
        'Overview',
        'NetCheck',
        'Profiles',
        'Subscriptions',
        'Rulesets',
        'Plugins',
        'ScheduledTasks',
      ],
      kernel: { profile: 'p1' },
    },
  })
  mocks.appStore ||= reactive({
    customActions: { core_state: [] },
  })
  mocks.rulesetsStore ||= reactive({
    addRuleset: vi.fn(),
    editRuleset: vi.fn(),
    getRulesetById: vi.fn(),
  })
  return {
    useKernelApiStore: () => mocks.kernelStore,
    useProfilesStore: () => mocks.profilesStore,
    useAppSettingsStore: () => mocks.appSettingsStore,
    useAppStore: () => mocks.appStore,
    useRulesetsStore: () => mocks.rulesetsStore,
    useWebuiAuthStore: () => ({ logout: vi.fn() }),
  }
})

vi.mock('@/utils', () => ({
  APP_TITLE: 'GUI.for.SingBox',
  confirm: mocks.confirm,
  deepClone: <T>(v: T): T => structuredClone(v),
  message: { error: mocks.messageError, success: mocks.messageSuccess },
  modal: mocks.modal,
  sampleID: () => 'sample-id',
}))

vi.mock('@/views/HomeView/components/OverView.vue', () => ({
  default: { template: '<div class="overview-stub" />' },
}))
vi.mock('@/views/HomeView/components/GroupsController.vue', () => ({
  default: { template: '<div class="groups-stub" />' },
}))
vi.mock('@/views/HomeView/components/ConnectionsController.vue', () => ({
  default: { template: '<div class="connections-stub" />' },
}))
vi.mock('@/views/HomeView/components/LogsController.vue', () => ({
  default: { template: '<div class="api-logs-stub" />' },
}))
vi.mock('@/views/HomeView/components/KernelLogs.vue', () => ({
  default: { template: '<div class="core-logs-stub" />' },
}))
vi.mock('@/views/HomeView/components/QuickStart.vue', () => ({
  default: { template: '<div class="quickstart-stub" />' },
}))

import CommonController from '@/views/HomeView/components/CommonController.vue'
import HomeView from '@/views/HomeView/index.vue'
import RulesetForm from '@/views/RulesetsView/components/RulesetForm.vue'

import AppearanceControls from '@/components/_common/AppearanceControls.vue'
import AppearancePopover from '@/components/_common/AppearancePopover.vue'
import AppShell from '@/components/_common/AppShell.vue'
import FontPresetSelector from '@/components/_common/FontPresetSelector.vue'
import NavigationBar from '@/components/_common/NavigationBar.vue'

const fontSelectStub = {
  props: ['modelValue', 'options'],
  template:
    '<select :value="modelValue" @change="$emit(\'change\', $event.target.value)"><option v-for="opt in options" :value="opt.value">{{ opt.label }}</option></select>',
}
const fontButtonStub = {
  props: ['disabled'],
  template: '<button :disabled="disabled"><slot /></button>',
}
describe('layout and workspace interactions', () => {
  beforeEach(() => {
    routeState.query = {}
    routerReplace.mockClear()
    routerPush.mockClear()
    mocks.kernelStore.running = true
    mocks.appSettingsStore.app.uiStyle = 'modern'
    mocks.appSettingsStore.app.navLayout = 'sidebar'
    mocks.appSettingsStore.app.uiDensity = 'comfortable'
    mocks.appSettingsStore.app.color = 'default'
    mocks.appSettingsStore.app.fontFamily =
      'system-ui, "Microsoft YaHei UI", "Source Han Sans CN", "Twemoji Mozilla", sans-serif'
    mocks.appSettingsStore.app.fontSize = 14
    mocks.appSettingsStore.app.customFontPresets = []
    mocks.rulesetsStore.addRuleset.mockReset()
    mocks.messageError.mockReset()
  })

  it('groups routes in NavigationBar and toggles collapsed state', async () => {
    const wrapper = mount(NavigationBar, {
      props: { collapsed: false, mobileOpen: false },
      global: {
        stubs: {
          Icon: true,
          RouterLink: {
            props: ['to'],
            template: '<a :href="to"><slot /></a>',
          },
        },
      },
    })

    const groupLabels = wrapper.findAll('.sidebar-group__label').map((el) => el.text())
    expect(groupLabels).toEqual([
      'navigation.groups.control',
      'navigation.groups.config',
      'navigation.groups.system',
    ])

    await wrapper.get('.sidebar-collapse-btn').trigger('click')
    expect(wrapper.emitted('update:collapsed')?.[0]).toEqual([true])
  })

  it('retains the group workspace across console tabs', async () => {
    const wrapper = mount(HomeView, {
      global: {
        stubs: {
          Button: {
            template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
          },
          Card: { template: '<div><slot /></div>' },
          Dropdown: { template: '<div><slot /></div>' },
          Switch: true,
          CustomAction: true,
          Icon: true,
          Divider: true,
          Radio: {
            props: ['modelValue'],
            template:
              '<button class="log-source-toggle" @click="$emit(\'update:modelValue\', \'core\')">toggle</button>',
          },
        },
        directives: { tips: {} },
      },
    })

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs).toHaveLength(4)
    expect(wrapper.find('.overview-stub').isVisible()).toBe(true)

    await tabs[1]!.trigger('click')
    const groups = wrapper.get('.groups-stub').element
    expect(wrapper.find('.groups-stub').exists()).toBe(true)

    await tabs[2]!.trigger('click')
    expect(wrapper.find('.connections-stub').exists()).toBe(true)

    await tabs[3]!.trigger('click')
    expect(wrapper.find('.api-logs-stub').exists()).toBe(true)

    await tabs[1]!.trigger('click')
    expect(wrapper.get('.groups-stub').element).toBe(groups)
  })

  it('renders only real settings cards in CommonController without a dummy empty card', () => {
    const wrapper = mount(CommonController, {
      global: {
        stubs: {
          Card: {
            props: ['title'],
            template: '<div class="setting-card">{{ title }}<slot /></div>',
          },
          Input: true,
          Switch: true,
          Select: true,
          InterfaceSelect: true,
        },
      },
    })

    const titles = wrapper.findAll('.setting-card').map((card) => card.text().trim())
    expect(titles).toHaveLength(7)
    expect(titles).not.toContain('common.none')
  })

  it('resets RulesetForm loading state after a failed save so users can retry or cancel', async () => {
    mocks.rulesetsStore.getRulesetById.mockReturnValueOnce({
      id: 'r',
      name: 'Rules',
      type: 'Manual',
      path: 'rules.json',
      format: 'source',
    })
    mocks.rulesetsStore.editRuleset.mockRejectedValueOnce(new Error('save failed'))
    const cancel = vi.fn()
    const wrapper = mount(RulesetForm, {
      props: { id: 'r', isUpdate: true },
      global: {
        provide: { cancel },
        stubs: {
          Radio: true,
          Input: true,
        },
      },
    })

    const submitVnode = (wrapper.vm as any).modalSlots.submit()
    await submitVnode.props.onClick()
    await flushPromises()

    expect(mocks.messageError).toHaveBeenCalled()
    expect((wrapper.vm as any).modalSlots.submit().props.loading).toBe(false)
    expect((wrapper.vm as any).modalSlots.cancel().props.disabled).toBe(false)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('switches visual style, accent color, and navigation layout in appearance settings', async () => {
    const wrapper = mount(AppearanceControls, {
      global: {
        stubs: {
          Icon: true,
          Radio: true,
          ColorPicker: true,
          Button: fontButtonStub,
          Select: fontSelectStub,
          Input: {
            props: ['modelValue'],
            emits: ['update:modelValue'],
            template:
              '<input class="custom-font-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
          Dropdown: {
            template: '<div><slot :show="true" /><slot name="overlay" /></div>',
          },
        },
      },
    })

    const styleButtons = wrapper.findAll('.style-option')
    expect(styleButtons).toHaveLength(4)
    await styleButtons[1]!.trigger('click')
    expect(mocks.appSettingsStore.app.uiStyle).toBe('glass')

    const swatchButtons = wrapper.findAll('.swatch-btn')
    expect(swatchButtons).toHaveLength(8)
    await swatchButtons[4]!.trigger('click')
    expect(mocks.appSettingsStore.app.color).toBe('purple')

    const layoutButtons = wrapper.findAll('.layout-option')
    expect(layoutButtons).toHaveLength(2)
    await layoutButtons[1]!.trigger('click')
    expect(mocks.appSettingsStore.app.navLayout).toBe('topnav')

    const fontSelect = wrapper.get('.font-select')
    await fontSelect.setValue('mono')
    expect(mocks.appSettingsStore.app.fontFamily).toContain('JetBrains Mono')
    await fontSelect.setValue('custom')
    expect(wrapper.find('.custom-font-input').exists()).toBe(true)

    const sizePresetButtons = wrapper.findAll('.size-preset-btn')
    expect(sizePresetButtons).toHaveLength(4)
    await sizePresetButtons[2]!.trigger('click')
    expect(mocks.appSettingsStore.app.fontSize).toBe(16)

    const stepButtons = wrapper.findAll('.size-step-btn')
    await stepButtons[1]!.trigger('click')
    expect(mocks.appSettingsStore.app.fontSize).toBe(17)
    await stepButtons[0]!.trigger('click')
    expect(mocks.appSettingsStore.app.fontSize).toBe(16)
  })

  it('adds, validates, saves from custom input, switches, and removes custom font presets', async () => {
    const wrapper = mount(AppearancePopover, {
      global: {
        stubs: {
          Icon: true,
          Radio: true,
          ColorPicker: true,
          Button: fontButtonStub,
          Select: fontSelectStub,
          Input: {
            props: ['modelValue'],
            emits: ['update:modelValue'],
            template:
              '<input class="custom-font-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
          },
          Dropdown: {
            template: '<div><slot :show="true" /><slot name="overlay" /></div>',
          },
        },
      },
    })

    // Open preset creator and verify empty-name and invalid-URL validation
    await wrapper.get('.font-add').trigger('click')
    const form = wrapper.get('form.font-preset-creator')
    await form.trigger('submit')
    expect(wrapper.get('.font-preset-error').text()).toBe('settings.font.errorEmptyName')

    const inputs = form.findAll('input.font-creator-input')
    await inputs[0]!.setValue('霞鹜文楷')
    await inputs[1]!.setValue('"LXGW WenKai", serif')
    await inputs[2]!.setValue('javascript:alert(1)')
    await form.trigger('submit')
    expect(wrapper.get('.font-preset-error').text()).toBe('settings.font.errorInvalidUrl')

    // Save valid preset with stylesheet URL and verify live preview & activation
    await inputs[2]!.setValue('/fonts/lxgw.css')
    expect(wrapper.get('.font-preset-preview').attributes('style')).toContain('LXGW WenKai')
    await form.trigger('submit')

    expect(mocks.appSettingsStore.app.customFontPresets).toEqual([
      {
        id: 'custom-font-1',
        label: '霞鹜文楷',
        fontFamily: '"LXGW WenKai", serif',
        stylesheetUrl: '/fonts/lxgw.css',
      },
    ])
    expect(mocks.appSettingsStore.app.fontFamily).toBe('"LXGW WenKai", serif')
    expect(wrapper.text().includes('settings.font.webFont')).toBe(true)

    // Save another preset from ad-hoc custom font input
    await wrapper.get('.font-select').setValue('custom')
    await wrapper.get('.custom-font-input').setValue('"Maple Mono", monospace')
    await wrapper.get('.font-save-preset-btn').trigger('click')

    const prefilledInputs = wrapper
      .get('form.font-preset-creator')
      .findAll('input.font-creator-input')
    expect((prefilledInputs[0]!.element as HTMLInputElement).value).toBe('Maple Mono')
    expect((prefilledInputs[1]!.element as HTMLInputElement).value).toBe('"Maple Mono", monospace')
    await wrapper.get('form.font-preset-creator').trigger('submit')

    expect(mocks.appSettingsStore.app.customFontPresets).toHaveLength(2)
    expect(mocks.appSettingsStore.app.fontFamily).toBe('"Maple Mono", monospace')

    // Deleting an inactive preset keeps current fontFamily intact
    const removeButtons = wrapper.findAll('.font-remove')
    expect(removeButtons).toHaveLength(2)
    await removeButtons[0]!.trigger('click')
    expect(mocks.appSettingsStore.app.customFontPresets).toHaveLength(1)
    expect(mocks.appSettingsStore.app.fontFamily).toBe('"Maple Mono", monospace')

    // Deleting the active preset falls back to default font family
    await wrapper.get('.font-remove').trigger('click')
    expect(mocks.appSettingsStore.app.customFontPresets).toHaveLength(0)
    expect(mocks.appSettingsStore.app.fontFamily).toContain('system-ui')
  })

  it('syncs custom presets between settings and popover selectors, blocks duplicates, and enforces limit', async () => {
    const stubs = {
      Icon: true,
      Button: fontButtonStub,
      Select: fontSelectStub,
      Input: {
        props: ['modelValue'],
        emits: ['update:modelValue'],
        template:
          '<input class="custom-font-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
      },
    }
    const settingsSelector = mount(FontPresetSelector, {
      props: { variant: 'settings' },
      global: { stubs },
    })
    const popoverSelector = mount(FontPresetSelector, {
      props: { variant: 'popover' },
      global: { stubs },
    })

    // Enter an ad-hoc custom font in settings, then save it as a preset from popover
    await settingsSelector.get('.font-select').setValue('custom')
    await settingsSelector.get('.custom-font-input').setValue('"LXGW WenKai", serif')
    expect(settingsSelector.find('.custom-font-input').exists()).toBe(true)

    await popoverSelector.get('.font-save-preset-btn').trigger('click')
    await popoverSelector.get('form.font-preset-creator').trigger('submit')

    // Settings selector exits custom mode and highlights the synced custom preset with Aa badge
    expect(settingsSelector.find('.custom-font-input').exists()).toBe(false)
    expect((settingsSelector.get('.font-select').element as HTMLSelectElement).value).toBe(
      'preset:custom-font-1',
    )

    // Duplicate fontFamily is rejected
    await settingsSelector.get('.font-add').trigger('click')
    const dupInputs = settingsSelector
      .get('form.font-preset-creator')
      .findAll('input.font-creator-input')
    await dupInputs[0]!.setValue('Another Name')
    await dupInputs[1]!.setValue('"LXGW WenKai", serif')
    await settingsSelector.get('form.font-preset-creator').trigger('submit')
    expect(settingsSelector.get('.font-preset-error').text()).toBe('settings.font.errorDuplicate')

    // At 20 presets, add button is disabled
    mocks.appSettingsStore.app.customFontPresets = Array.from({ length: 20 }, (_, i) => ({
      id: `custom-font-${i + 1}`,
      label: `Font ${i + 1}`,
      fontFamily: `"Font ${i + 1}", sans-serif`,
    }))
    await flushPromises()
    await settingsSelector.get('.font-cancel').trigger('click')
    expect((settingsSelector.get('.font-add').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders horizontal topnav links in AppShell when navLayout is topnav', async () => {
    mocks.appSettingsStore.app.navLayout = 'topnav'
    const wrapper = mount(AppShell, {
      global: {
        stubs: {
          Icon: true,
          AppearancePopover: true,
          RouterView: true,
          RouterLink: {
            props: ['to'],
            template: '<a :href="to" v-bind="$attrs"><slot /></a>',
          },
        },
      },
    })

    expect(wrapper.find('.app-shell.is-topnav').exists()).toBe(true)
    expect(wrapper.find('.app-sidebar.is-topnav-mode').exists()).toBe(true)
    expect(wrapper.findAll('.topbar-nav__link')).toHaveLength(4)
  })
})
