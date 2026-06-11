import {
  emitRuntimeEvent,
  offAllRuntimeEvents,
  offRuntimeEvent,
  onRuntimeEvent,
} from '../shared/webui'

const noOp = () => 0

const requestFullscreen = () => document.documentElement.requestFullscreen?.().catch(noOp)
const exitFullscreen = () => document.exitFullscreen?.().catch(noOp)

export const LogPrint = console.log
export const LogTrace = console.trace
export const LogDebug = console.debug
export const LogInfo = console.info
export const LogWarning = console.warn
export const LogError = console.error
export const LogFatal = console.error

export function EventsOnMultiple(
  eventName: string,
  callback: (...data: any[]) => void,
  maxCallbacks = -1,
) {
  let count = 0
  const off = onRuntimeEvent(eventName, (...data) => {
    count += 1
    callback(...data)
    if (maxCallbacks > 0 && count >= maxCallbacks) {
      off()
    }
  })
  return off
}

export const EventsOn = (eventName: string, callback: (...data: any[]) => void) =>
  EventsOnMultiple(eventName, callback)

export function EventsOff(eventName: string, ...additionalEventNames: string[]) {
  ;[eventName, ...additionalEventNames].forEach((name) => offRuntimeEvent(name))
}

export function EventsOffAll() {
  offAllRuntimeEvents()
}

export function EventsEmit(eventName: string, ...data: any[]) {
  emitRuntimeEvent(eventName, ...data)
}

export function WindowReload() {
  window.location.reload()
}

export const WindowReloadApp = WindowReload
export const WindowSetAlwaysOnTop = noOp
export const WindowSetSystemDefaultTheme = noOp
export const WindowSetLightTheme = noOp
export const WindowSetDarkTheme = noOp
export const WindowCenter = noOp

export function WindowSetTitle(title: string) {
  document.title = title
}

export const WindowFullscreen = requestFullscreen
export const WindowMaximise = requestFullscreen
export const WindowToggleMaximise = () => {
  if (document.fullscreenElement) {
    exitFullscreen()
  } else {
    requestFullscreen()
  }
}
export const WindowUnfullscreen = exitFullscreen
export const WindowUnmaximise = exitFullscreen
export const WindowSetSize = noOp
export const WindowSetMaxSize = noOp
export const WindowSetMinSize = noOp
export const WindowSetPosition = noOp
export const WindowHide = noOp
export const WindowShow = noOp
export const WindowMinimise = noOp
export const WindowUnminimise = noOp
export const WindowSetBackgroundColour = noOp

export const WindowIsFullscreen = async () => Boolean(document.fullscreenElement)
export const WindowIsMaximised = WindowIsFullscreen
export const WindowIsMinimised = async () => false
export const WindowIsNormal = async () => !document.fullscreenElement
export const WindowGetSize = async () => ({ width: window.innerWidth, height: window.innerHeight })
export const WindowGetPosition = async () => ({ x: 0, y: 0 })
export const ScreenGetAll = async () => [
  { width: window.screen.width, height: window.screen.height, x: 0, y: 0 },
]

export function BrowserOpenURL(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export const Environment = async () => navigator.userAgent
export const Quit = () => window.close()
export const Hide = noOp
export const Show = noOp

export async function ClipboardGetText() {
  return navigator.clipboard.readText()
}

export async function ClipboardSetText(text: string) {
  await navigator.clipboard.writeText(text)
  return true
}

export const OnFileDrop = noOp
export const OnFileDropOff = noOp
export const CanResolveFilePaths = async () => false
export const ResolveFilePaths = async (files: string[]) => files

export const InitializeNotifications = async () => true
export const CleanupNotifications = async () => true
export const IsNotificationAvailable = async () => 'Notification' in window
export const CheckNotificationAuthorization = async () =>
  'Notification' in window && Notification.permission === 'granted'

export async function RequestNotificationAuthorization() {
  if (!('Notification' in window)) {
    return false
  }
  const permission = await Notification.requestPermission()
  return permission === 'granted'
}

export async function SendNotification(options: Record<string, any>) {
  if (!(await CheckNotificationAuthorization())) {
    throw new Error('Notification permission not granted')
  }
  new Notification(options.title ?? '', {
    body: options.body ?? '',
    icon: options.icon,
  })
}

export const SendNotificationWithActions = SendNotification
export const RegisterNotificationCategory = async () => true
export const RemoveNotificationCategory = async () => true
export const RemoveAllPendingNotifications = async () => true
export const RemovePendingNotification = async () => true
export const RemoveAllDeliveredNotifications = async () => true
export const RemoveDeliveredNotification = async () => true
export const RemoveNotification = async () => true
