import type { ReactNode } from 'react'
import { ModalDialog } from '../ui'

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <ModalDialog title={title} open onOpenChange={(open) => { if (!open) onClose() }} wide>{children}</ModalDialog>
}
