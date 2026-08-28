const KEY = 'bbd-chrome'

export type ChromeView = 'write' | 'plot' | 'canon' | 'revision' | 'deliver' | 'provenance' | 'sync' | 'review' | 'sprint' | 'template' | 'visual'

export interface ChromeState {
  tree: boolean
  inspector: boolean
  treeWidth: number
  inspectorWidth: number
  view: ChromeView
}

export function readChrome(): ChromeState {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<ChromeState>
    return {
      tree: value.tree !== false,
      inspector: value.inspector !== false,
      treeWidth: clamp(value.treeWidth, 220, 360, 260),
      inspectorWidth: clamp(value.inspectorWidth, 280, 420, 336),
      view: isChromeView(value.view) ? value.view : 'write',
    }
  } catch {
    return { tree: true, inspector: true, treeWidth: 260, inspectorWidth: 336, view: 'write' }
  }
}

export function writeChrome(next: ChromeState) {
  localStorage.setItem(KEY, JSON.stringify(next))
}

function isChromeView(value: unknown): value is ChromeView {
  return typeof value === 'string' && ['write', 'plot', 'canon', 'revision', 'deliver', 'provenance', 'sync', 'review', 'sprint', 'template', 'visual'].includes(value)
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}
