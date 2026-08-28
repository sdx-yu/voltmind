import { afterEach, describe, expect, it } from 'vitest'
import { applyDisplay, DEFAULT_DISPLAY, readDisplay, saveDisplay } from './display'

describe('display foundations', () => {
  afterEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.density
    document.documentElement.removeAttribute('style')
  })

  it('migrates old settings to a comfortable density', () => {
    localStorage.setItem('bbd-display', JSON.stringify({ fontSize: 19, paperWidth: 700, lineHeight: 1.9, theme: 'night' }))
    expect(readDisplay()).toEqual({ fontSize: 19, paperWidth: 700, lineHeight: 1.9, theme: 'night', density: 'comfortable' })
  })

  it('falls back from unknown theme and density values', () => {
    localStorage.setItem('bbd-display', JSON.stringify({ theme: 'neon', density: 'tiny' }))
    expect(readDisplay()).toEqual(DEFAULT_DISPLAY)
  })

  it('applies and persists high contrast with touch density', () => {
    const settings = { fontSize: 20, paperWidth: 760, lineHeight: 2.1, theme: 'high-contrast' as const, density: 'touch' as const }
    saveDisplay(settings)
    expect(readDisplay()).toEqual(settings)
    expect(document.documentElement.dataset.theme).toBe('high-contrast')
    expect(document.documentElement.dataset.density).toBe('touch')
    expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe('20px')
  })

  it('clamps imported numeric display settings', () => {
    applyDisplay(DEFAULT_DISPLAY)
    localStorage.setItem('bbd-display', JSON.stringify({ fontSize: 99, paperWidth: 200, lineHeight: 9, theme: 'paper', density: 'compact' }))
    expect(readDisplay()).toMatchObject({ fontSize: 24, paperWidth: 600, lineHeight: 2.4, density: 'compact' })
  })
})
