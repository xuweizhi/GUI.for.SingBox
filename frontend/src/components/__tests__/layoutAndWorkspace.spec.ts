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
    { path: '/', name: 'Overview', meta: { name: 'router.overview', icon: 'overview', group: 'control' } },
    { path: '/netcheck', name: 'NetCheck', meta: { name: 'router.netcheck', icon: 'speedTest', group: 'control' } },
    { path: '/profiles', name: 'Profiles', meta: { name: 'router.profiles', icon: 'profiles', group: 'config' } },
    { path: '/settings', name: 'Settings', meta: { name: 'router.settings', icon: 'settings2', group: 'system', hidden: false } },
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

import AppearancePopover from '@/components/_common/AppearancePopover.vue'
import AppShell from '@/components/_common/AppShell.vue'
import NavigationBar from '@/components/_common/NavigationBar.vue'
import CommonController from '@/views/HomeView/components/CommonController.vue'
import HomeView from '@/views/HomeView/index.vue'
import RulesetForm from '@/views/RulesetsView/components/RulesetForm.vue'

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

  it('switches inline HomeView console tabs and toggles live vs core logs', async () => {
    const wrapper = mount(HomeView, {
      global: {
        stubs: {
          Button: { template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>' },
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
    expect(wrapper.find('.groups-stub').exists()).toBe(true)
    expect(mocks.kernelStore.refreshProviderProxies).toHaveBeenCalled()

    await tabs[2]!.trigger('click')
    expect(wrapper.find('.connections-stub').exists()).toBe(true)

    await tabs[3]!.trigger('click')
    expect(wrapper.find('.api-logs-stub').exists()).toBe(true)

    await wrapper.get('.log-source-toggle').trigger('click')
    expect(wrapper.find('.core-logs-stub').exists()).toBe(true)
  })

  it('renders only real settings cards in CommonController without a dummy empty card', () => {
    const wrapper = mount(CommonController, {
      global: {
        stubs: {
          Card: { props: ['title'], template: '<div class="setting-card">{{ title }}<slot /></div>' },
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
    mocks.rulesetsStore.addRuleset.mockRejectedValueOnce(new Error('save failed'))
    const cancel = vi.fn()
    const wrapper = mount(RulesetForm, {
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

  it('switches visual style, accent color, and navigation layout via AppearancePopover', async () => {
    const wrapper = mount(AppearancePopover, {
      global: {
        stubs: {
          Icon: true,
          Radio: true,
          ColorPicker: true,
          Button: true,
          Input: {
            props: ['modelValue'],
            template: '<input class="custom-font-input" :value="modelValue" />',
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

    const fontButtons = wrapper.findAll('.font-chip')
    expect(fontButtons).toHaveLength(6)
    await fontButtons[4]!.trigger('click')
    expect(mocks.appSettingsStore.app.fontFamily).toContain('JetBrains Mono')
    expect(wrapper.find('.custom-font-input').exists()).toBe(false)

    await fontButtons[5]!.trigger('click')
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
