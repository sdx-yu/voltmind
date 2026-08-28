export const APP_COMMANDS = [
  'search',
  'replace',
  'settings',
  'help',
  'focus',
  'toggle-tree',
  'toggle-inspector',
  'read-aloud',
  'trash',
  'bookshelf',
  'command-palette',
  'view-write',
  'view-plot',
  'view-plan',
  'view-canon',
  'view-revision',
  'view-deliver',
  'view-provenance',
  'view-sync',
  'view-review',
  'view-sprint',
  'view-template',
  'view-visual',
] as const

export type AppCommand = (typeof APP_COMMANDS)[number]

export function isAppCommand(value: string): value is AppCommand {
  return (APP_COMMANDS as readonly string[]).includes(value)
}

export function dispatchCommand(command: AppCommand) {
  window.dispatchEvent(new CustomEvent('bbd:command', { detail: command }))
}

export function onCommand(handler: (command: AppCommand) => void) {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<string>).detail
    if (typeof detail === 'string' && isAppCommand(detail)) handler(detail)
  }
  window.addEventListener('bbd:command', listener)
  return () => window.removeEventListener('bbd:command', listener)
}

export function isComposingKey(event: KeyboardEvent) {
  return event.isComposing || event.key === 'Process'
}

export function isEditableTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null
  if (!element) return false
  return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'))
}

export function matchMod(event: KeyboardEvent) {
  return event.metaKey || event.ctrlKey
}
