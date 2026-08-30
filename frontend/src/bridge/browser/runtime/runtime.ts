import {
  emitRuntimeEvent,
  offAllRuntimeEvents,
  offRuntimeEvent,
  onRuntimeEvent,
} from '../shared/webui'

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

export function WindowReloadApp() {
  window.location.reload()
}

export function BrowserOpenURL(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export async function ClipboardGetText() {
  return navigator.clipboard.readText()
}

export async function ClipboardSetText(text: string) {
  await navigator.clipboard.writeText(text)
  return true
}

export const IsNotificationAvailable = async () => 'Notification' in window

export async function RequestNotificationAuthorization() {
  if (!('Notification' in window)) {
    return false
  }
  const permission = await Notification.requestPermission()
  return permission === 'granted'
}

export async function SendNotification(options: Record<string, any>) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    throw new Error('Notification permission not granted')
  }
  new Notification(options.title ?? '', {
    body: options.body ?? '',
    icon: options.icon,
  })
}
