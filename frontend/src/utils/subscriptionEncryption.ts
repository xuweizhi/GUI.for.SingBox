import CryptoJS from 'crypto-js'
import { md5 } from 'js-md5'

export const SubscriptionEncryptionHeader = 'Subscription-Encryption'
export const SubscriptionEncryptionValue = 'true'
export const SubscriptionShareLinkPattern =
  /^(?:ss|ssr|vmess|vless|trojan|hysteria2?|hy2|tuic|wireguard|anytls):\/\//i

const normalizeEncryptedSubscriptionBase64 = (value: string) => {
  const normalized = value.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const padding = (4 - (normalized.length % 4)) % 4

  return normalized + '='.repeat(padding)
}

const decodeHex = (value: string) => {
  if (value.length % 2 !== 0) {
    throw new Error('Invalid hex string')
  }

  const bytes = new Uint8Array(value.length / 2)
  for (let i = 0; i < value.length; i += 2) {
    bytes[i / 2] = Number.parseInt(value.slice(i, i + 2), 16)
  }
  return bytes
}

const decodeBase64 = (value: string) => {
  const binary = atob(normalizeEncryptedSubscriptionBase64(value))
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

const encodeUtf8 = (value: Uint8Array) => {
  return new TextDecoder().decode(value)
}

const bytesToWordArray = (value: Uint8Array) => {
  const words: number[] = []

  for (let i = 0; i < value.length; i++) {
    words[i >>> 2] = (words[i >>> 2] ?? 0) | (value[i]! << (24 - (i % 4) * 8))
  }

  return CryptoJS.lib.WordArray.create(words, value.length)
}

const decryptSubscriptionWithCryptoJS = (keyBytes: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array) => {
  const decrypted = CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({
      ciphertext: bytesToWordArray(ciphertext),
    }),
    bytesToWordArray(keyBytes),
    {
      iv: bytesToWordArray(iv),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    },
  )

  const hex = decrypted.toString(CryptoJS.enc.Hex)
  if (!hex) {
    return null
  }

  return encodeUtf8(decodeHex(hex))
}

export const getHeaderValue = (headers: Record<string, unknown>, name: string) => {
  const normalizedName = name.toLowerCase()

  return Object.entries(headers).find(([key]) => key.toLowerCase() === normalizedName)?.[1]
}

export const isEncryptedSubscription = (headerValue: unknown) => {
  const values = Array.isArray(headerValue) ? headerValue : [headerValue]

  return values.some(
    (value) => typeof value === 'string' && value.trim().toLowerCase() === SubscriptionEncryptionValue,
  )
}

export const isSubscriptionShareLinkList = (content: string) => {
  if (typeof content !== 'string') return false

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  return lines.length > 0 && lines.every((line) => SubscriptionShareLinkPattern.test(line))
}

export const decryptEncryptedSubscription = async (password: string, base64Data: string) => {
  if (!password || !base64Data.trim()) {
    return null
  }

  let raw: Uint8Array
  try {
    raw = decodeBase64(base64Data)
  } catch {
    return null
  }

  if (raw.length <= 16) {
    return null
  }

  const keyBytes = decodeHex(md5(password))
  const iv = raw.slice(0, 16)
  const ciphertext = raw.slice(16)
  const subtle = globalThis.crypto?.subtle

  try {
    if (subtle) {
      const key = await subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt'])
      const decrypted = await subtle.decrypt({ name: 'AES-CBC', iv }, key, ciphertext)
      const text = encodeUtf8(new Uint8Array(decrypted))

      return text || null
    }

    return decryptSubscriptionWithCryptoJS(keyBytes, iv, ciphertext)
  } catch {
    try {
      return decryptSubscriptionWithCryptoJS(keyBytes, iv, ciphertext)
    } catch {
      return null
    }
  }
}
