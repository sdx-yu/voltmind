import type { ReactNode } from 'react'

export type PageHeaderTone = 'utility' | 'editorial'

export function PageHeader({ eyebrow, title, description, actions, backAction, tone = 'utility' }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode; backAction?: ReactNode; tone?: PageHeaderTone }) {
  return <header className={`ui-page-header ui-page-header-${tone}`}>
    <div className="ui-page-header-copy">
      {backAction}
      {eyebrow && <span className="ui-eyebrow">{eyebrow}</span>}
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
    {actions && <div className="ui-page-header-actions">{actions}</div>}
  </header>
}
