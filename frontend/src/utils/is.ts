import { Cron } from 'croner'
import { parse } from 'yaml'

import { normalizeBase64 } from './others'

export const isValidBase64 = (str: string) => {
  if (typeof str !== 'string') return false
  if (str === '' || str.trim() === '') {
    return false
  }

  // Accept URL-safe base64 and ignore line breaks/spaces in subscription responses.
  const normalized = normalizeBase64(str)
  try {
    atob(normalized)
    return true
  } catch {
    return false
  }
}

const hasSubscriptionNodes = (value: any) =>
  Array.isArray(value) ||
  Array.isArray(value?.outbounds) ||
  Array.isArray(value?.endpoints) ||
  Array.isArray(value?.proxies)

export const isValidSubYAML = (str: string) => {
  if (typeof str !== 'string') return false
  try {
    return hasSubscriptionNodes(parse(str))
  } catch {
    return false
  }
}

export const isValidSubJson = (str: string) => {
  if (typeof str !== 'string') return false
  try {
    return hasSubscriptionNodes(JSON.parse(str))
  } catch {
    return false
  }
}

export const isValidPaylodYAML = (str: string) => {
  try {
    const { payload } = parse(str)
    return !!payload
  } catch {
    return false
  }
}

export const isValidRulesJson = (str: string) => {
  try {
    const { rules } = JSON.parse(str)
    return !!rules
  } catch {
    return false
  }
}

export const isValidIPv4 = (ip: string) =>
  /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/.test(ip)

export const isValidIPv6 = (ip: string) => {
  // Restrict input to a bare literal before invoking the browser's IPv6 parser.
  if (typeof ip !== 'string' || !ip.includes(':') || /[^a-fA-F0-9:.]/.test(ip)) return false
  try {
    return Boolean(new URL(`http://[${ip}]/`).hostname)
  } catch {
    return false
  }
}

export const isValidJson = (str: string) => {
  try {
    return !!JSON.parse(str)
  } catch {
    return false
  }
}

export const isNumber = (v: any) => typeof v === 'number'

export const isValidCron = (pattern: string) => {
  try {
    const instance = new Cron(pattern, { paused: true })
    return { ok: true, reason: null, instance: instance }
  } catch (error: any) {
    return { ok: false, reason: error.message || error, instance: null }
  }
}
