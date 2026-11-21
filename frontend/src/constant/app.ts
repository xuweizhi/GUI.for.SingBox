import {
  Color,
  ControllerCloseMode,
  Lang,
  NavLayout,
  PluginTrigger,
  RequestMethod,
  RequestProxyMode,
  ScheduledTasksType,
  Theme,
  UiDensity,
  UiStyle,
  View,
} from '@/enums/app'
import { APP_TITLE } from '@/utils'

export const LocalesFilePath = 'data/locales'

export const UserFilePath = 'data/user.yaml'

export const ProfilesFilePath = 'data/profiles.yaml'

export const SubscribesFilePath = 'data/subscribes.yaml'

export const NodeGroupsFilePath = 'data/node-groups.yaml'

export const RulesetsFilePath = 'data/rulesets.yaml'

export const PluginsFilePath = 'data/plugins.yaml'

export const ScheduledTasksFilePath = 'data/scheduledtasks.yaml'

export const PluginHubFilePath = 'data/.cache/plugin-list.json'

export const RulesetHubFilePath = 'data/.cache/ruleset-list.json'

export const DefaultFontFamily =
  'system-ui, "Microsoft YaHei UI", "Source Han Sans CN", "Twemoji Mozilla", sans-serif'

export const DefaultFontSize = 14
export const MinFontSize = 12
export const MaxFontSize = 18
export const MaxCustomFontPresets = 20

export const FontSizeOptions = [
  { label: 'settings.fontSize.small', value: 12 },
  { label: 'settings.fontSize.default', value: 14 },
  { label: 'settings.fontSize.large', value: 16 },
  { label: 'settings.fontSize.xlarge', value: 18 },
] as const

export const FontPresetOptions = [
  {
    key: 'system',
    label: 'settings.font.system',
    value: DefaultFontFamily,
  },
  {
    key: 'modern',
    label: 'settings.font.modern',
    value:
      '"Inter", "SF Pro Text", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Noto Sans SC", "Segoe UI", sans-serif',
  },
  {
    key: 'rounded',
    label: 'settings.font.rounded',
    value:
      '"SF Pro Rounded", "Quicksand", "Hiragino Maru Gothic ProN", "YouYuan", "PingFang SC", "Noto Sans SC", ui-rounded, sans-serif',
  },
  {
    key: 'serif',
    label: 'settings.font.serif',
    value:
      '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", "SimSun", Georgia, "Times New Roman", serif',
  },
  {
    key: 'mono',
    label: 'settings.font.mono',
    value:
      '"JetBrains Mono", "Fira Code", "Cascadia Code", "Sarasa Mono SC", "SF Mono", Consolas, ui-monospace, monospace',
  },
] as const

export const Colors = {
  [Color.Default]: {
    primary: '#2563eb',
    secondary: '#1d4ed8',
  },
  [Color.Indigo]: {
    primary: '#6366f1',
    secondary: '#4f46e5',
  },
  [Color.Cyan]: {
    primary: '#0891b2',
    secondary: '#0e7490',
  },
  [Color.Green]: {
    primary: '#059669',
    secondary: '#047857',
  },
  [Color.Purple]: {
    primary: '#9333ea',
    secondary: '#7e22ce',
  },
  [Color.Rose]: {
    primary: '#e11d48',
    secondary: '#be123c',
  },
  [Color.Amber]: {
    primary: '#d97706',
    secondary: '#b45309',
  },
  [Color.Custom]: {
    primary: '#2563eb',
    secondary: '#1d4ed8',
  },
}

export const LanguageOptions = [
  { label: 'settings.lang.zh', value: Lang.ZH },
  { label: 'settings.lang.en', value: Lang.EN },
]

export const ViewOptions = [
  { label: 'common.grid', value: View.Grid },
  { label: 'common.list', value: View.List },
]

export const ControllerCloseModeOptions = [
  { label: 'home.controller.closeMode.all', value: ControllerCloseMode.All },
  { label: 'home.controller.closeMode.button', value: ControllerCloseMode.Button },
]

export const RequestMethodOptions = [
  { label: RequestMethod.Get, value: RequestMethod.Get },
  { label: RequestMethod.Post, value: RequestMethod.Post },
  { label: RequestMethod.Delete, value: RequestMethod.Delete },
  { label: RequestMethod.Put, value: RequestMethod.Put },
  { label: RequestMethod.Head, value: RequestMethod.Head },
  { label: RequestMethod.Patch, value: RequestMethod.Patch },
]

export const RequestProxyModeOptions = [
  { label: 'settings.requestProxy.none', value: RequestProxyMode.None },
  { label: 'settings.requestProxy.system', value: RequestProxyMode.System },
  { label: 'settings.requestProxy.kernel', value: RequestProxyMode.Kernel },
  { label: 'settings.requestProxy.custom', value: RequestProxyMode.Custom },
]

export const SubscriptionRequestProxyModeOptions = [
  { label: 'settings.requestProxy.global', value: RequestProxyMode.Global },
  ...RequestProxyModeOptions,
]

export const ThemeOptions = [
  {
    label: 'settings.theme.dark',
    value: Theme.Dark,
  },
  {
    label: 'settings.theme.light',
    value: Theme.Light,
  },
  {
    label: 'settings.theme.auto',
    value: Theme.Auto,
  },
]

export const ColorOptions = [
  {
    label: 'settings.color.default',
    value: Color.Default,
  },
  {
    label: 'settings.color.indigo',
    value: Color.Indigo,
  },
  {
    label: 'settings.color.cyan',
    value: Color.Cyan,
  },
  {
    label: 'settings.color.green',
    value: Color.Green,
  },
  {
    label: 'settings.color.purple',
    value: Color.Purple,
  },
  {
    label: 'settings.color.rose',
    value: Color.Rose,
  },
  {
    label: 'settings.color.amber',
    value: Color.Amber,
  },
  {
    label: 'settings.color.custom',
    value: Color.Custom,
  },
]

export const UiStyleOptions = [
  {
    label: 'settings.appearance.styles.modern.name',
    desc: 'settings.appearance.styles.modern.desc',
    value: UiStyle.Modern,
  },
  {
    label: 'settings.appearance.styles.glass.name',
    desc: 'settings.appearance.styles.glass.desc',
    value: UiStyle.Glass,
  },
  {
    label: 'settings.appearance.styles.minimal.name',
    desc: 'settings.appearance.styles.minimal.desc',
    value: UiStyle.Minimal,
  },
  {
    label: 'settings.appearance.styles.cyber.name',
    desc: 'settings.appearance.styles.cyber.desc',
    value: UiStyle.Cyber,
  },
]

export const NavLayoutOptions = [
  {
    label: 'settings.appearance.layouts.sidebar',
    value: NavLayout.Sidebar,
  },
  {
    label: 'settings.appearance.layouts.topnav',
    value: NavLayout.Topnav,
  },
]

export const UiDensityOptions = [
  {
    label: 'settings.appearance.densities.comfortable',
    value: UiDensity.Comfortable,
  },
  {
    label: 'settings.appearance.densities.compact',
    value: UiDensity.Compact,
  },
]

export const DefaultPluginHubSources = () => [
  {
    enable: true,
    name: 'General',
    url: 'https://raw.githubusercontent.com/GUI-for-Cores/Plugin-Hub/main/plugins/generic.json',
  },
  {
    enable: true,
    name: APP_TITLE,
    url: `https://raw.githubusercontent.com/GUI-for-Cores/Plugin-Hub/main/plugins/${
      {
        'GUI.for.Clash': 'gfc',
        'GUI.for.SingBox': 'gfs',
      }[APP_TITLE]
    }.json`,
  },
]

// vue-draggable-plus config
export const DraggableOptions = {
  animation: 150,
}

export const PluginsTriggerOptions = [
  { label: 'plugin.on::startup', value: PluginTrigger.OnStartup },
  { label: 'plugin.on::ready', value: PluginTrigger.OnReady },
  { label: 'plugin.on::reload', value: PluginTrigger.OnReload },
  { label: 'plugin.on::shutdown', value: PluginTrigger.OnShutdown },
  { label: 'plugin.on::manual', value: PluginTrigger.OnManual },
  { label: 'plugin.on::generate', value: PluginTrigger.OnGenerate },
  { label: 'plugin.on::subscribe', value: PluginTrigger.OnSubscribe },
  { label: 'plugin.on::before::core::start', value: PluginTrigger.OnBeforeCoreStart },
  { label: 'plugin.on::core::started', value: PluginTrigger.OnCoreStarted },
  { label: 'plugin.on::before::core::stop', value: PluginTrigger.OnBeforeCoreStop },
  { label: 'plugin.on::core::stopped', value: PluginTrigger.OnCoreStopped },
]

export const ScheduledTaskOptions = [
  { label: 'scheduledtask.update::subscription', value: ScheduledTasksType.UpdateSubscription },
  { label: 'scheduledtask.update::ruleset', value: ScheduledTasksType.UpdateRuleset },
  { label: 'scheduledtask.update::plugin', value: ScheduledTasksType.UpdatePlugin },
  { label: 'scheduledtask.run::plugin', value: ScheduledTasksType.RunPlugin },
  { label: 'scheduledtask.run::script', value: ScheduledTasksType.RunScript },
  {
    label: 'scheduledtask.update::all::subscription',
    value: ScheduledTasksType.UpdateAllSubscription,
  },
  {
    label: 'scheduledtask.update::all::subscription::sync-outbound-refs',
    value: ScheduledTasksType.UpdateAllSubscriptionAndSyncOutboundRefs,
  },
  { label: 'scheduledtask.update::all::ruleset', value: ScheduledTasksType.UpdateAllRuleset },
  { label: 'scheduledtask.update::all::plugin', value: ScheduledTasksType.UpdateAllPlugin },
]

export const DefaultSubscribeScript = `const onSubscribe = async (proxies, subscription) => {\n  return { proxies, subscription }\n}`

export const DefaultTestURL = 'https://www.gstatic.com/generate_204'

export const DefaultTestTimeout = 5000

// Keep batch latency tests below the point where the browser/core connection pool
// starts measuring its own queueing delay instead of the proxy latency.
export const DefaultConcurrencyLimit = 6

export const MaxConcurrencyLimit = 8

export const DefaultCardColumns = 5

export const DefaultControllerSensitivity = 2
