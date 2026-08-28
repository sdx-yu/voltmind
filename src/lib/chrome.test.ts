import { afterEach, describe, expect, it } from 'vitest'
import { readChrome, writeChrome } from './chrome'

describe('workspace chrome persistence', () => {
  afterEach(() => localStorage.clear())

  it('migrates the old boolean-only state', () => {
    localStorage.setItem('bbd-chrome', JSON.stringify({ tree: false, inspector: true }))
    expect(readChrome()).toEqual({ tree: false, inspector: true, treeWidth: 260, inspectorWidth: 336, view: 'write' })
  })

  it('clamps pane widths and rejects unknown views', () => {
    localStorage.setItem('bbd-chrome', JSON.stringify({ treeWidth: 999, inspectorWidth: 10, view: 'debug' }))
    expect(readChrome()).toMatchObject({ treeWidth: 360, inspectorWidth: 280, view: 'write' })
  })

  it('round-trips a complete UI-B shell state', () => {
    const state = { tree: true, inspector: false, treeWidth: 304, inspectorWidth: 380, view: 'revision' as const }
    writeChrome(state)
    expect(readChrome()).toEqual(state)
  })
})
