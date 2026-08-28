import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function ListRow({ title, description, meta, icon, selected = false, trailing, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { title: string; description?: string; meta?: string; icon?: ReactNode; selected?: boolean; trailing?: ReactNode }) {
  return <button type="button" className={`ui-list-row${selected ? ' is-selected' : ''} ${className}`.trim()} aria-current={selected ? 'true' : undefined} {...props}>
    {icon && <span className="ui-list-row-icon" aria-hidden="true">{icon}</span>}
    <span className="ui-list-row-copy"><strong>{title}</strong>{description && <small>{description}</small>}</span>
    {meta && <span className="ui-list-row-meta">{meta}</span>}
    {trailing}
  </button>
}

export function TreeRow(props: Parameters<typeof ListRow>[0] & { level?: number; expanded?: boolean }) {
  const { level = 1, expanded, style, ...rest } = props
  return <ListRow role="treeitem" aria-level={level} aria-expanded={expanded} style={{ ...style, paddingInlineStart: `calc(var(--space-3) + ${(level - 1) * 16}px)` }} {...rest} />
}
