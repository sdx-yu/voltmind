export type DisplayTheme = 'paper' | 'night'

export interface DisplaySettings {
  fontSize: number
  paperWidth: number
  lineHeight: number
  theme: DisplayTheme
}

export const DEFAULT_DISPLAY: DisplaySettings = {
  fontSize: 18,
  paperWidth: 680,
  lineHeight: 2,
  theme: 'paper',
}

export function readDisplay(): DisplaySettings {
  try {
    const value = JSON.parse(localStorage.getItem('bbd-display') || '{}') as Partial<DisplaySettings>
    return {
      fontSize: clamp(value.fontSize ?? DEFAULT_DISPLAY.fontSize, 15, 24),
      paperWidth: clamp(value.paperWidth ?? DEFAULT_DISPLAY.paperWidth, 600, 980),
      lineHeight: clamp(value.lineHeight ?? DEFAULT_DISPLAY.lineHeight, 1.6, 2.4),
      theme: value.theme === 'night' ? 'night' : 'paper',
    }
  } catch {
    return { ...DEFAULT_DISPLAY }
  }
}

export function applyStoredDisplay() {
  applyDisplay(readDisplay())
}

export function applyDisplay(settings: DisplaySettings) {
  const root = document.documentElement
  root.style.setProperty('--editor-font-size', `${settings.fontSize}px`)
  root.style.setProperty('--paper-width', `${settings.paperWidth}px`)
  root.style.setProperty('--editor-line-height', String(settings.lineHeight))
  root.dataset.theme = settings.theme
}

export function saveDisplay(settings: DisplaySettings) {
  localStorage.setItem('bbd-display', JSON.stringify(settings))
  applyDisplay(settings)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
