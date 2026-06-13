import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createCipheriv, createHash, webcrypto } from 'node:crypto'

import {
  decryptEncryptedSubscription,
  getHeaderValue,
  isEncryptedSubscription,
  isSubscriptionShareLinkList,
  SubscriptionEncryptionHeader,
} from '@/utils/subscriptionEncryption'

const encryptSubscription = (password: string, plaintext: string) => {
  const key = createHash('md5').update(password).digest()
  const iv = Buffer.from('0123456789abcdef')
  const cipher = createCipheriv('aes-128-cbc', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return Buffer.concat([iv, encrypted]).toString('base64')
}

describe('subscription encryption', () => {
  beforeAll(() => {
    vi.stubGlobal('crypto', webcrypto)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('detects the encrypted subscription header case-insensitively', () => {
    const value = getHeaderValue({ 'subscription-encryption': ' true ' }, SubscriptionEncryptionHeader)

    expect(isEncryptedSubscription(value)).toBe(true)
    expect(isEncryptedSubscription('false')).toBe(false)
  })

  it('decrypts karing-compatible encrypted subscriptions', async () => {
    const password = 'hunter2'
    const plaintext = 'proxies:\n  - name: test\n    type: ss'
    const encrypted = encryptSubscription(password, plaintext)

    await expect(decryptEncryptedSubscription(password, encrypted)).resolves.toBe(plaintext)
  })

  it('returns null for malformed payloads or wrong passwords', async () => {
    const encrypted = encryptSubscription('correct-password', '{"outbounds":[]}')

    await expect(decryptEncryptedSubscription('wrong-password', encrypted)).resolves.toBeNull()
    await expect(decryptEncryptedSubscription('correct-password', 'not-base64')).resolves.toBeNull()
  })

  it('falls back to pure-js decryption when Web Crypto is unavailable', async () => {
    vi.stubGlobal('crypto', undefined)

    const password = 'fallback-password'
    const plaintext = 'vmess://example'
    const encrypted = encryptSubscription(password, plaintext)

    await expect(decryptEncryptedSubscription(password, encrypted)).resolves.toBe(plaintext)

    vi.stubGlobal('crypto', webcrypto)
  })

  it('detects decrypted line-based share-link subscriptions', async () => {
    const plaintext = [
      'vless://uuid@example.com:443?security=tls&type=ws#node-a',
      '',
      'trojan://password@example.com:443?security=tls#node-b',
      'anytls://password@example.com:443?security=tls#node-c',
    ].join('\n')
    const encrypted = encryptSubscription('share-link-password', plaintext)
    const decrypted = await decryptEncryptedSubscription('share-link-password', encrypted)

    expect(decrypted).toBe(plaintext)
    expect(isSubscriptionShareLinkList(decrypted!)).toBe(true)
    expect(isSubscriptionShareLinkList('proxies:\n  - name: node')).toBe(false)
  })
})
