const KEY = 'bbd-chrome'

export interface ChromeState {
  tree: boolean
  inspector: boolean
}

export function readChrome(): ChromeState {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<ChromeState>
    return { tree: value.tree !== false, inspector: value.inspector !== false }
  } catch {
    return { tree: true, inspector: true }
  }
}

export function writeChrome(next: ChromeState) {
  localStorage.setItem(KEY, JSON.stringify(next))
}
