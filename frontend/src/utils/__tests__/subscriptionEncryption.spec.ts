import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createCipheriv, createHash, webcrypto } from 'node:crypto'

import {
  decryptEncryptedSubscription,
  getHeaderValue,
  isEncryptedSubscription,
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
})
