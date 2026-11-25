import { describe, expect, it } from 'vitest'

import {
  WEBUI_TOKEN_STORAGE_KEY,
  buildLoginRedirect,
  resolveRedirectTarget,
  isUnauthorizedStatus,
} from '@/utils/webuiAuth'

describe('webuiAuth utils', () => {
  it('builds a login redirect with encoded target', () => {
    expect(buildLoginRedirect('/profiles?tab=1')).toBe('/login?redirect=%2Fprofiles%3Ftab%3D1')
  })

  it('falls back to root for empty redirect targets', () => {
    expect(resolveRedirectTarget('')).toBe('/')
    expect(resolveRedirectTarget(undefined)).toBe('/')
  })

  it('resolves an encoded redirect target', () => {
    expect(resolveRedirectTarget('%2Fsettings')).toBe('/settings')
  })

  it('preserves decoded route queries and rejects recursive or external redirects', () => {
    expect(resolveRedirectTarget('/profiles?q=50%25')).toBe('/profiles?q=50%25')
    expect(resolveRedirectTarget('/login?redirect=/profiles')).toBe('/')
    expect(resolveRedirectTarget('//other.test/')).toBe('/')
  })

  it('detects unauthorized status codes', () => {
    expect(isUnauthorizedStatus(401)).toBe(true)
    expect(isUnauthorizedStatus(503)).toBe(false)
  })

  it('uses a stable storage key', () => {
    expect(WEBUI_TOKEN_STORAGE_KEY).toBe('gfs.webui.token')
  })
})
