export enum OS {
  Windows = 'windows',
  Linux = 'linux',
  Darwin = 'darwin',
}

export enum Theme {
  Auto = 'auto',
  Light = 'light',
  Dark = 'dark',
}

export enum Lang {
  EN = 'en',
  ZH = 'zh',
}

export enum View {
  Grid = 'grid',
  List = 'list',
}

export enum ControllerCloseMode {
  All = 'all',
  Button = 'button',
}

export enum Color {
  Default = 'default',
  Indigo = 'indigo',
  Cyan = 'cyan',
  Green = 'green',
  Purple = 'purple',
  Rose = 'rose',
  Amber = 'amber',
  Custom = 'custom',
}

export enum UiStyle {
  Modern = 'modern',
  Glass = 'glass',
  Minimal = 'minimal',
  Cyber = 'cyber',
}

export enum NavLayout {
  Sidebar = 'sidebar',
  Topnav = 'topnav',
}

export enum UiDensity {
  Comfortable = 'comfortable',
  Compact = 'compact',
}

export enum Branch {
  Main = 'main',
  Alpha = 'alpha',
}

export enum RequestProxyMode {
  Global = 'global',
  None = 'none',
  System = 'system',
  Kernel = 'kernel',
  Custom = 'custom',
}

export enum ScheduledTasksType {
  UpdateSubscription = 'update::subscription',
  UpdateRuleset = 'update::ruleset',
  UpdatePlugin = 'update::plugin',
  UpdateAllSubscription = 'update::all::subscription',
  UpdateAllSubscriptionAndSyncOutboundRefs = 'update::all::subscription::sync-outbound-refs',
  UpdateAllRuleset = 'update::all::ruleset',
  UpdateAllPlugin = 'update::all::plugin',
  RunPlugin = 'run::plugin',
  RunScript = 'run::script',
}

export enum PluginTrigger {
  OnEnabled = 'on::enabled',
  OnDisabled = 'on::disabled',
  OnManual = 'on::manual',
  OnSubscribe = 'on::subscribe',
  OnGenerate = 'on::generate',
  OnStartup = 'on::startup',
  OnShutdown = 'on::shutdown',
  OnReady = 'on::ready',
  OnReload = 'on::reload',
  OnCoreStarted = 'on::core::started',
  OnCoreStopped = 'on::core::stopped',
  OnBeforeCoreStart = 'on::before::core::start',
  OnBeforeCoreStop = 'on::before::core::stop',
}

export enum PluginTriggerEvent {
  OnEnabled = 'onEnabled',
  OnDisabled = 'onDisabled',
  OnDispose = 'onDispose',
  OnInstall = 'onInstall',
  OnUninstall = 'onUninstall',
  OnManual = 'onRun',
  OnSubscribe = 'onSubscribe',
  OnGenerate = 'onGenerate',
  OnStartup = 'onStartup',
  OnShutdown = 'onShutdown',
  OnReady = 'onReady',
  OnReload = 'onReload',
  OnTask = 'onTask',
  OnConfigure = 'onConfigure',
  OnCoreStarted = 'onCoreStarted',
  OnCoreStopped = 'onCoreStopped',
  OnBeforeCoreStart = 'onBeforeCoreStart',
  OnBeforeCoreStop = 'onBeforeCoreStop',
}

export enum RequestMethod {
  Get = 'GET',
  Post = 'POST',
  Delete = 'DELETE',
  Put = 'PUT',
  Head = 'HEAD',
  Patch = 'PATCH',
}
