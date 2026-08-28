import { Search } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ModalDialog } from './Overlay'

export interface CommandItem {
  id: string
  title: string
  description?: string
  section: string
  keywords?: string[]
  shortcut?: string
  icon?: ReactNode
  disabled?: boolean
  onSelect: () => void
}

export function CommandPalette({ open, onOpenChange, items, title = '命令面板', placeholder = '搜索功能或项目…' }: { open: boolean; onOpenChange: (open: boolean) => void; items: CommandItem[]; title?: string; placeholder?: string }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const visible = useMemo(() => {
    const needle = normalize(query)
    if (!needle) return items
    return items.filter((item) => normalize([item.title, item.description, item.section, ...(item.keywords ?? [])].filter(Boolean).join(' ')).includes(needle))
  }, [items, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
  }, [open])
  useEffect(() => setActive((value) => Math.min(value, Math.max(0, visible.length - 1))), [visible.length])

  function choose(item: CommandItem | undefined) {
    if (!item || item.disabled) return
    onOpenChange(false)
    item.onSelect()
  }

  return <ModalDialog title={title} description="输入名称筛选，使用上下方向键选择，按回车执行。" open={open} onOpenChange={onOpenChange} wide>
    <div className="ui-command-palette" onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => visible.length ? (value + 1) % visible.length : 0) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => visible.length ? (value - 1 + visible.length) % visible.length : 0) }
      if (event.key === 'Enter') { event.preventDefault(); choose(visible[active]) }
    }}>
      <label className="ui-command-search"><Search size={18} aria-hidden="true" /><span className="ui-sr-only">搜索命令</span><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setActive(0) }} placeholder={placeholder} role="combobox" aria-expanded="true" aria-controls="ui-command-results" aria-activedescendant={visible[active] ? `ui-command-${visible[active].id}` : undefined} /></label>
      <div className="ui-command-results" id="ui-command-results" role="listbox" aria-label="可用命令">
        {visible.map((item, index) => <button
          key={item.id}
          id={`ui-command-${item.id}`}
          type="button"
          role="option"
          aria-selected={active === index}
          disabled={item.disabled}
          onMouseMove={() => setActive(index)}
          onClick={() => choose(item)}
        >
          <span className="ui-command-icon" aria-hidden="true">{item.icon}</span>
          <span className="ui-command-copy"><strong>{item.title}</strong>{item.description && <small>{item.description}</small>}</span>
          <span className="ui-command-meta">{item.shortcut && <kbd>{item.shortcut}</kbd>}<small>{item.section}</small></span>
        </button>)}
        {!visible.length && <div className="ui-command-empty"><strong>没有匹配的命令</strong><span>换一个名称或任务词试试。</span></div>}
      </div>
    </div>
  </ModalDialog>
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, '')
}
