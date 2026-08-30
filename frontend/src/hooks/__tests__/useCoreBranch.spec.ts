import { describe, expect, it } from 'vitest'

import { parseCoreVersionOutput, parseReleaseSha256 } from '@/hooks/useCoreBranch'

describe('core release validation helpers', () => {
  it('parses official SHA-256 release digests', () => {
    const digest = 'A'.repeat(64)
    expect(parseReleaseSha256(`sha256:${digest}`)).toBe(digest.toLowerCase())
  })

  it('rejects missing or malformed release digests', () => {
    expect(() => parseReleaseSha256(undefined)).toThrow('valid SHA-256')
    expect(() => parseReleaseSha256('sha256:1234')).toThrow('valid SHA-256')
  })

  it('parses stable and prerelease core version output', () => {
    expect(parseCoreVersionOutput('sing-box version 1.13.0\nEnvironment: go1.25')).toBe('1.13.0')
    expect(parseCoreVersionOutput('sing-box version v1.14.0-alpha.7')).toBe('1.14.0-alpha.7')
  })
})
