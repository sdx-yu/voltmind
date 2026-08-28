import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

export type CardVariant = 'plain' | 'selectable' | 'metric' | 'status'

export function Card({ variant = 'plain', selected = false, title, description, actions, children, className = '', ...props }: HTMLAttributes<HTMLElement> & { variant?: CardVariant; selected?: boolean; title?: string; description?: string; actions?: ReactNode }) {
  return <article className={`ui-card ui-card-${variant}${selected ? ' is-selected' : ''} ${className}`.trim()} {...props}>
    {(title || actions) && <header><div>{title && <h3>{title}</h3>}{description && <p>{description}</p>}</div>{actions}</header>}
    {children}
  </article>
}

export function SelectableCard({ selected = false, title, description, children, className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; title: string; description?: string }) {
  return <button type={type} className={`ui-card ui-card-selectable ui-selectable-card${selected ? ' is-selected' : ''} ${className}`.trim()} aria-pressed={selected || undefined} {...props}>
    <strong>{title}</strong>
    {description && <p>{description}</p>}
    {children}
  </button>
}
