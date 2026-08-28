import type { HTMLAttributes, ReactNode } from 'react'

type TemplateProps = HTMLAttributes<HTMLElement> & { children: ReactNode }

export function EditorTemplate({ navigation, navigationResizer, content, details, detailsResizer, className = '', ...props }: Omit<HTMLAttributes<HTMLDivElement>, 'content'> & {
  navigation?: ReactNode
  navigationResizer?: ReactNode
  content: ReactNode
  details?: ReactNode
  detailsResizer?: ReactNode
}) {
  const columns = navigation && details ? 'three' : navigation ? 'navigation' : details ? 'details' : 'single'
  return <div data-ui-template="editor" className={`ui-template ui-template-editor ui-template-editor-${columns} ${className}`.trim()} {...props}>
    {navigation}
    {navigationResizer}
    {content}
    {details}
    {detailsResizer}
  </div>
}

export function BoardTemplate({ children, className = '', ...props }: TemplateProps) {
  return <section data-ui-template="board" className={`ui-template ui-template-board ${className}`.trim()} {...props}>{children}</section>
}

export function LibraryTemplate({ children, className = '', ...props }: TemplateProps) {
  return <section data-ui-template="library" className={`ui-template ui-template-library ${className}`.trim()} {...props}>{children}</section>
}

export function WorkflowTemplate({ children, className = '', ...props }: TemplateProps) {
  return <section data-ui-template="workflow" className={`ui-template ui-template-workflow ${className}`.trim()} {...props}>{children}</section>
}

export type WorkflowStepState = 'complete' | 'current' | 'upcoming'

export function WorkflowSteps({ label, items }: { label: string; items: Array<{ id: string; label: string; description?: string; state: WorkflowStepState }> }) {
  return <nav className="ui-workflow-steps" aria-label={label}><ol>{items.map((item, index) => <li key={item.id} className={`is-${item.state}`} aria-current={item.state === 'current' ? 'step' : undefined}>
    <span aria-hidden="true">{item.state === 'complete' ? '✓' : index + 1}</span>
    <div><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</div>
  </li>)}</ol></nav>
}

export function MetricStrip({ label, items, className = '' }: { label: string; className?: string; items: Array<{ id: string; label: string; value: ReactNode; icon?: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> }) {
  return <section className={`ui-metric-strip ${className}`.trim()} aria-label={label}>{items.map((item) => <article key={item.id} className={`ui-tone-${item.tone ?? 'neutral'}`}>
    {item.icon && <span className="ui-metric-icon" aria-hidden="true">{item.icon}</span>}
    <div><strong>{item.value}</strong><small>{item.label}</small></div>
  </article>)}</section>
}
