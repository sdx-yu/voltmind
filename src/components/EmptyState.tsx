import type { ReactNode } from 'react'
import { EmptyState as FoundationEmptyState } from '../ui'

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <FoundationEmptyState title={title} description={description} action={action} />
}
