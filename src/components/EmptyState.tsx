import { Feather } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Feather size={25} /></span><h3>{title}</h3><p>{description}</p>{action}</div>
}
