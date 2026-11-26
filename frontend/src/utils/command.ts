import {
  ColorOptions,
  FontPresetOptions,
  FontSizeOptions,
  NavLayoutOptions,
  ThemeOptions,
  UiDensityOptions,
  UiStyleOptions,
} from '@/constant/app'
import { ModeOptions } from '@/constant/kernel'
import { PluginTrigger, PluginTriggerEvent } from '@/enums/app'
import useI18n from '@/lang'
import router from '@/router'
import rawRoutes from '@/router/routes'
import {
  useAppSettingsStore,
  useAppStore,
  useKernelApiStore,
  usePluginsStore,
  useRulesetsStore,
  useSubscribesStore,
} from '@/stores'
import { handleChangeMode, message, reloadApp, restartApp } from '@/utils'

type Command = {
  label: string
  cmd: string
  desc?: string
  handler?: () => Promise<any> | any
  children?: Command[]
}

const processCommands = (commands: Command[], parentLabel = '', parentCmd = '') => {
  const { t } = useI18n.global

  const result: Command[] = []

  commands.forEach((item) => {
    const label = parentLabel ? `${t(parentLabel)}: ${t(item.label)}` : t(item.label)
    const cmd = parentCmd ? `${parentCmd}: ${item.cmd}` : item.cmd

    if (item.children) {
      result.push(...processCommands(item.children, label, cmd))
    } else {
      result.push({ label, cmd, handler: item.handler })
    }
  })

  return result
}

export const getCommands = () => {
  const kernelStore = useKernelApiStore()
  const appSettings = useAppSettingsStore()
  const appStore = useAppStore()
  const subscriptionsStore = useSubscribesStore()
  const rulesetsStore = useRulesetsStore()
  const pluginsStore = usePluginsStore()

  const rawCommands: Command[] = [
    {
      label: 'common.navigate',
      cmd: 'Go to',
      children: rawRoutes
        .filter((r) => !r.meta?.public && !r.meta?.hidden && r.meta?.name)
        .map((r) => ({
          label: r.meta!.name!,
          cmd: String(r.name || r.path),
          handler: () => router.push(r.path),
        })),
    },
    {
      label: 'commands.kernel',
      cmd: 'Core',
      children: [
        {
          label: 'commands.startKernel',
          cmd: 'Start Core',
          handler: kernelStore.startCore,
        },
        {
          label: 'commands.stopKernel',
          cmd: 'Stop Core',
          handler: kernelStore.stopCore,
        },
        {
          label: 'commands.restartKernel',
          cmd: 'Restart Core',
          handler: kernelStore.restartCore,
        },
        {
          label: 'commands.enableTunMode',
          cmd: 'Enable Tun',
          handler: () => kernelStore.updateConfig('tun', { enable: true }),
        },
        {
          label: 'commands.disableTunMode',
          cmd: 'Disable Tun',
          handler: () => kernelStore.updateConfig('tun', { enable: false }),
        },
        {
          label: 'kernel.allow-lan',
          cmd: 'Allow Lan',
          handler: () => kernelStore.updateConfig('allow-lan', true),
        },
        {
          label: 'kernel.disallow-lan',
          cmd: 'Disallow Lan',
          handler: () => kernelStore.updateConfig('allow-lan', false),
        },
        {
          label: 'kernel.mode',
          cmd: 'Core Mode',
          children: ModeOptions.map((mode) => ({
            label: mode.label,
            cmd: mode.value,
            handler: () => handleChangeMode(mode.value),
          })),
        },
      ],
    },
    {
      label: 'Service',
      cmd: 'Service',
      children: [
        {
          label: 'settings.lang.name',
          cmd: 'Language',
          children: [
            {
              label: 'settings.lang.load',
              cmd: 'Load language files',
              handler: async () => {
                await appStore.loadLocales()
                message.success('common.success')
              },
            },
            ...appStore.locales.map((v) => ({
              label: v.label,
              cmd: v.value,
              handler: () => (appSettings.app.lang = v.value),
            })),
          ],
        },
        {
          label: 'settings.theme.name',
          cmd: 'Theme',
          children: ThemeOptions.map((theme) => ({
            label: theme.label,
            cmd: theme.value,
            handler: () => (appSettings.app.theme = theme.value),
          })),
        },
        {
          label: 'settings.color.name',
          cmd: 'Color',
          children: ColorOptions.map((color) => ({
            label: color.label,
            cmd: color.value,
            handler: () => (appSettings.app.color = color.value),
          })),
        },
        {
          label: 'settings.appearance.style',
          cmd: 'Visual Style',
          children: UiStyleOptions.map((style) => ({
            label: style.label,
            cmd: style.value,
            handler: () => (appSettings.app.uiStyle = style.value),
          })),
        },
        {
          label: 'settings.appearance.layout',
          cmd: 'Navigation Layout',
          children: NavLayoutOptions.map((layout) => ({
            label: layout.label,
            cmd: layout.value,
            handler: () => (appSettings.app.navLayout = layout.value),
          })),
        },
        {
          label: 'settings.appearance.density',
          cmd: 'Interface Density',
          children: UiDensityOptions.map((density) => ({
            label: density.label,
            cmd: density.value,
            handler: () => (appSettings.app.uiDensity = density.value),
          })),
        },
        {
          label: 'settings.fontFamily',
          cmd: 'Font',
          children: [
            ...FontPresetOptions.map((font) => ({
              label: font.label,
              cmd: font.key,
              handler: () => (appSettings.app.fontFamily = font.value),
            })),
            ...(appSettings.app.customFontPresets ?? []).map((preset) => ({
              label: preset.label,
              cmd: preset.label,
              handler: () => (appSettings.app.fontFamily = preset.fontFamily),
            })),
          ],
        },
        {
          label: 'settings.fontSize.name',
          cmd: 'Font Size',
          children: FontSizeOptions.map((size) => ({
            label: size.label,
            cmd: `${size.value}px`,
            handler: () => (appSettings.app.fontSize = size.value),
          })),
        },
        {
          label: 'titlebar.reload',
          cmd: 'Refresh Page',
          handler: reloadApp,
        },
        {
          label: 'commands.restartApp',
          cmd: 'Restart Service',
          handler: restartApp,
        },
        {
          label: 'router.about',
          cmd: 'About Service',
          handler: () => (appStore.showAbout = true),
        },
      ],
    },
    {
      label: 'router.subscriptions',
      cmd: 'Subscriptions',
      children: [
        {
          label: 'common.updateAll',
          cmd: 'Update Subscriptions',
          handler: subscriptionsStore.updateSubscribes,
        },
      ],
    },
    {
      label: 'router.rulesets',
      cmd: 'Rulesets',
      children: [
        {
          label: 'common.updateAll',
          cmd: 'Update Rulesets',
          handler: rulesetsStore.updateRulesets,
        },
      ],
    },
    {
      label: 'router.plugins',
      cmd: 'Plugins',
      children: [
        {
          label: 'common.updateAll',
          cmd: 'Update Plugins',
          handler: pluginsStore.updatePlugins,
        },
      ],
    },
    {
      label: 'commands.plugins',
      cmd: 'Plugins',
      children: pluginsStore.plugins.flatMap((plugin) => {
        const hasTrigger = !!plugin.triggers.find((trigger) => trigger === PluginTrigger.OnManual)
        const hasMenus = !!Object.keys(plugin.menus).length
        if (!hasTrigger && !hasMenus) return []
        const children: Command[] = []
        if (hasTrigger) {
          children.push({
            label: 'common.run',
            cmd: PluginTrigger.OnManual,
            handler: async () => {
              plugin.running = true
              try {
                await pluginsStore.manualTrigger(plugin.id, PluginTriggerEvent.OnManual)
              } catch (error: any) {
                message.error(error)
              }
              plugin.running = false
            },
          })
        }
        if (hasMenus) {
          Object.entries(plugin.menus).forEach(([title, fnName]) => {
            children.push({
              label: title,
              cmd: fnName,
              handler: async () => {
                try {
                  plugin.running = true
                  await pluginsStore.manualTrigger(plugin.id, fnName as any)
                } catch (error: any) {
                  message.error(error.message || error)
                } finally {
                  plugin.running = false
                }
              },
            })
          })
        }
        return { label: plugin.name, cmd: plugin.id, children }
      }),
    },
  ]

  return processCommands(rawCommands)
}
