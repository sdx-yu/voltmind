import type { KeyboardEvent } from 'react'

export interface TabItem {
  id: string
  label: string
  disabled?: boolean
}

interface TabsProps {
  items: TabItem[]
  value: string
  onChange: (value: string) => void
  label: string
  variant?: 'tabs' | 'segmented'
}

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')]
  const current = tabs.indexOf(document.activeElement as HTMLButtonElement)
  if (current < 0 || !tabs.length) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  tabs[next]?.focus()
}

export function Tabs({ items, value, onChange, label, variant = 'tabs' }: TabsProps) {
  return <div className={`ui-tabs ui-tabs-${variant}`} role="tablist" aria-label={label} onKeyDown={moveFocus}>
    {items.map((item) => <button
      key={item.id}
      type="button"
      role="tab"
      aria-selected={value === item.id}
      tabIndex={value === item.id ? 0 : -1}
      disabled={item.disabled}
      onClick={() => onChange(item.id)}
    >{item.label}</button>)}
  </div>
}

export function SegmentedControl(props: Omit<TabsProps, 'variant'>) {
  return <Tabs {...props} variant="segmented" />
}
