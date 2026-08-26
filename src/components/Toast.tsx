import { CheckCircle2, CircleAlert, X } from 'lucide-react'

export interface ToastState { type: 'success' | 'error'; message: string }

export function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  if (!toast) return null
  return <div className={`toast toast-${toast.type}`} role="status" aria-live={toast.type === 'error' ? 'assertive' : 'polite'}>
    {toast.type === 'success' ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}
    <span>{toast.message}</span><button onClick={onClose} aria-label="关闭提示"><X size={15} /></button>
  </div>
}
