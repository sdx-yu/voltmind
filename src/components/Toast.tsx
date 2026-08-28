import { ToastNotice } from '../ui'

export interface ToastState { type: 'success' | 'error'; message: string }

export function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  if (!toast) return null
  return <div className="ui-toast-position"><ToastNotice tone={toast.type === 'error' ? 'danger' : 'success'} onClose={onClose}>{toast.message}</ToastNotice></div>
}
