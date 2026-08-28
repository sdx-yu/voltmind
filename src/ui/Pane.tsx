import type { HTMLAttributes, ReactNode } from 'react'

export function Pane({ title, description, actions, children, side = 'main', className = '', ...props }: HTMLAttributes<HTMLElement> & { title?: string; description?: string; actions?: ReactNode; side?: 'left' | 'main' | 'right' }) {
  return <section className={`ui-pane ui-pane-${side} ${className}`.trim()} {...props}>
    {(title || actions) && <header className="ui-pane-header"><div>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div>{actions}</header>}
    <div className="ui-pane-body">{children}</div>
  </section>
}
