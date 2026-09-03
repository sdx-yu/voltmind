import type { ReactNode } from 'react'
import { ModalDialog } from '../ui'

export function Modal({ title, children, footer, onClose, wide = false, className = '' }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean; className?: string }) {
  return <ModalDialog title={title} open onOpenChange={(open) => { if (!open) onClose() }} wide={wide} footer={footer} className={className}>{children}</ModalDialog>
}
