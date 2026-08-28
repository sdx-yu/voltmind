import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'small' | 'medium' | 'large'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  full?: boolean
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'medium',
  loading = false,
  full = false,
  leadingIcon,
  trailingIcon,
  children,
  className = '',
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return <button
    type={type}
    className={`ui-button ui-button-${variant} ui-button-${size}${full ? ' ui-button-full' : ''} ${className}`.trim()}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    {...props}
  >
    {loading ? <span className="ui-spinner" aria-hidden="true" /> : leadingIcon}
    <span>{children}</span>
    {!loading && trailingIcon}
  </button>
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  size?: 'small' | 'medium' | 'large'
  selected?: boolean
  tooltip?: string
}

export function IconButton({ label, size = 'medium', selected = false, tooltip, className = '', children, type = 'button', ...props }: IconButtonProps) {
  return <button
    type={type}
    className={`ui-icon-button ui-icon-button-${size}${selected ? ' is-selected' : ''} ${className}`.trim()}
    aria-label={label}
    aria-pressed={selected || undefined}
    title={tooltip ?? label}
    {...props}
  >{children}</button>
}
