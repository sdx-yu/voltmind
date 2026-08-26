import type { ReactNode } from 'react'
import { Modal } from './Modal'

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = '取消',
  danger = false,
  busy = false,
  disabled = false,
  children,
  onConfirm,
  onClose,
}: {
  title: string
  message?: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  disabled?: boolean
  children?: ReactNode
  onConfirm: () => void
  onClose: () => void
}) {
  return <Modal title={title} onClose={onClose}>
    <div className="form-stack">
      {message && <p className="form-hint">{message}</p>}
      {children}
      <div className="modal-actions">
        <button type="button" className="button ghost" onClick={onClose}>{cancelLabel}</button>
        <button type="button" className={`button ${danger ? 'danger' : 'primary'}`} disabled={busy || disabled} onClick={onConfirm}>{busy ? '正在处理…' : confirmLabel}</button>
      </div>
    </div>
  </Modal>
}
