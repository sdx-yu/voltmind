import { AlertTriangle, CheckCircle2, CircleAlert, Info, X } from 'lucide-react'
import type { HTMLAttributes, ReactNode } from 'react'
import { IconButton } from './Button'

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`ui-badge ui-tone-${tone}`}>{children}</span>
}

const toneIcons = {
  neutral: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: CircleAlert,
  info: Info,
}

export function InlineNotice({ tone = 'info', title, children, actions, className = '', ...props }: HTMLAttributes<HTMLDivElement> & { tone?: Tone; title: string; actions?: ReactNode }) {
  const Icon = toneIcons[tone]
  return <div className={`ui-inline-notice ui-tone-${tone} ${className}`.trim()} role={tone === 'danger' ? 'alert' : 'status'} {...props}>
    <Icon size={18} aria-hidden="true" />
    <div><strong>{title}</strong><p>{children}</p></div>
    {actions && <aside>{actions}</aside>}
  </div>
}

export function ToastNotice({ tone = 'success', children, onClose }: { tone?: Tone; children: ReactNode; onClose?: () => void }) {
  const Icon = toneIcons[tone]
  return <div className={`ui-toast ui-tone-${tone}`} role={tone === 'danger' ? 'alert' : 'status'} aria-live={tone === 'danger' ? 'assertive' : 'polite'}>
    <Icon size={18} aria-hidden="true" />
    <span>{children}</span>
    {onClose && <IconButton label="关闭提示" size="small" onClick={onClose}><X size={15} /></IconButton>}
  </div>
}
