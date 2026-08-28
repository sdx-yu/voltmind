import { AlertTriangle, Feather, LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './Button'

export function EmptyState({ title, description, action, icon }: { title: string; description: string; action?: ReactNode; icon?: ReactNode }) {
  return <div className="ui-state ui-empty-state">
    <span className="ui-state-icon">{icon ?? <Feather size={24} />}</span>
    <h3>{title}</h3><p>{description}</p>{action}
  </div>
}

export function LoadingState({ label = '正在加载…' }: { label?: string }) {
  return <div className="ui-state ui-loading-state" role="status"><LoaderCircle className="ui-spin" size={24} /><p>{label}</p></div>
}

export function ErrorState({ title = '暂时无法完成', description, onRetry }: { title?: string; description: string; onRetry?: () => void }) {
  return <div className="ui-state ui-error-state" role="alert"><span className="ui-state-icon"><AlertTriangle size={24} /></span><h3>{title}</h3><p>{description}</p>{onRetry && <Button onClick={onRetry}>重试</Button>}</div>
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="ui-skeleton" aria-hidden="true">{Array.from({ length: lines }, (_, index) => <span key={index} />)}</div>
}
