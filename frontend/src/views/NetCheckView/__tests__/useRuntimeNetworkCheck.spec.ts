import { describe, expect, it } from 'vitest'

import fs from 'node:fs'
import path from 'node:path'

describe('useRuntimeNetworkCheck source', () => {
  it('does not statically import the desktop-only wailsjs bridge path directly', () => {
    const source = fs.readFileSync(
      path.resolve('src/views/NetCheckView/useRuntimeNetworkCheck.ts'),
      'utf8',
    )

    expect(source).not.toContain("import * as Bridge from '@/bridge/wailsjs/go/bridge/App'")
    expect(source).toContain("import('@/bridge/browser/go/bridge/App')")
    expect(source).toContain("import('@/bridge/wailsjs/go/bridge/App')")
  })
})
