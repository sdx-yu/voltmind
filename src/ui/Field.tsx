import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

interface FieldFrameProps {
  label: string
  description?: string
  error?: string
  required?: boolean
  inputId: string
  children: ReactNode
}

function FieldFrame({ label, description, error, required, inputId, children }: FieldFrameProps) {
  return <div className={`ui-field${error ? ' has-error' : ''}`}>
    <label className="ui-field-label" htmlFor={inputId}>{label}{required && <span aria-hidden="true"> *</span>}</label>
    {children}
    {(error || description) && <p id={`${inputId}-message`} className="ui-field-message">{error ?? description}</p>}
  </div>
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string
  description?: string
  error?: string
}

export function TextField({ label, description, error, id, required, className = '', ...props }: TextFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const messageId = error || description ? `${inputId}-message` : undefined
  return <FieldFrame label={label} description={description} error={error} required={required} inputId={inputId}>
    <input id={inputId} className={`ui-input ${className}`.trim()} required={required} aria-invalid={Boolean(error) || undefined} aria-describedby={messageId} {...props} />
  </FieldFrame>
}

export interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  description?: string
  error?: string
}

export function TextareaField({ label, description, error, id, required, className = '', ...props }: TextareaFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const messageId = error || description ? `${inputId}-message` : undefined
  return <FieldFrame label={label} description={description} error={error} required={required} inputId={inputId}>
    <textarea id={inputId} className={`ui-textarea ${className}`.trim()} required={required} aria-invalid={Boolean(error) || undefined} aria-describedby={messageId} {...props} />
  </FieldFrame>
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  description?: string
  error?: string
}

export function SelectField({ label, description, error, id, required, className = '', children, ...props }: SelectFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const messageId = error || description ? `${inputId}-message` : undefined
  return <FieldFrame label={label} description={description} error={error} required={required} inputId={inputId}>
    <select id={inputId} className={`ui-select ${className}`.trim()} required={required} aria-invalid={Boolean(error) || undefined} aria-describedby={messageId} {...props}>{children}</select>
  </FieldFrame>
}

export interface CheckboxFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string
  description?: string
}

export function CheckboxField({ label, description, id, className = '', ...props }: CheckboxFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  return <label className={`ui-choice ${className}`.trim()} htmlFor={inputId}>
    <input id={inputId} type="checkbox" {...props} />
    <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
  </label>
}

export function SwitchField({ label, description, id, checked, ...props }: CheckboxFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  return <label className="ui-choice ui-switch-field" htmlFor={inputId}>
    <input id={inputId} type="checkbox" role="switch" checked={checked} {...props} />
    <span className="ui-switch" aria-hidden="true"><i /></span>
    <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
  </label>
}
