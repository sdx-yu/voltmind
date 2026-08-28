import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { Children, Fragment, isValidElement, useId, type ChangeEventHandler, type InputHTMLAttributes, type ReactElement, type ReactNode, type TextareaHTMLAttributes } from 'react'

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

interface SelectOption {
  value: string
  label: ReactNode
  disabled: boolean
}

export interface SelectValueChangeEvent {
  target: { value: string }
  currentTarget: { value: string }
}

interface SelectControlProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  onChange?: (event: SelectValueChangeEvent) => void
  disabled?: boolean
  required?: boolean
  name?: string
  id?: string
  className?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  children: ReactNode
}

const EMPTY_VALUE = '__bbd_select_empty__'

export function SelectControl({ value, defaultValue, onValueChange, onChange, disabled, required, name, id, className = '', children, ...aria }: SelectControlProps) {
  const options = collectOptions(children)
  function change(next: string) {
    const decoded = decodeValue(next)
    onValueChange?.(decoded)
    onChange?.({ target: { value: decoded }, currentTarget: { value: decoded } })
  }
  return <Select.Root value={value === undefined ? undefined : encodeValue(value)} defaultValue={defaultValue === undefined ? undefined : encodeValue(defaultValue)} onValueChange={change} disabled={disabled} required={required} name={name}>
    <Select.Trigger id={id} className={`ui-select-trigger ${className}`.trim()} {...aria}>
      <Select.Value />
      <Select.Icon className="ui-select-chevron"><ChevronDown size={16} /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content className="ui-select-content" position="popper" sideOffset={6} collisionPadding={8} align="start">
        <Select.ScrollUpButton className="ui-select-scroll"><ChevronUp size={15} /></Select.ScrollUpButton>
        <Select.Viewport className="ui-select-viewport">
          {options.map((option) => <Select.Item key={encodeValue(option.value)} className="ui-select-option" value={encodeValue(option.value)} disabled={option.disabled}>
            <Select.ItemText>{option.label}</Select.ItemText>
            <Select.ItemIndicator className="ui-select-indicator"><Check size={15} /></Select.ItemIndicator>
          </Select.Item>)}
        </Select.Viewport>
        <Select.ScrollDownButton className="ui-select-scroll"><ChevronDown size={15} /></Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
}

export interface SelectFieldProps extends SelectControlProps {
  label: string
  description?: string
  error?: string
}

export function SelectField({ label, description, error, id, required, className = '', children, ...props }: SelectFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const messageId = error || description ? `${inputId}-message` : undefined
  return <FieldFrame label={label} description={description} error={error} required={required} inputId={inputId}>
    <SelectControl id={inputId} className={className} required={required} aria-invalid={Boolean(error) || undefined} aria-describedby={messageId} {...props}>{children}</SelectControl>
  </FieldFrame>
}

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  label: string
  value: string
  onValueChange: (value: string) => void
  description?: string
  error?: string
}

export function SearchField({ label, value, onValueChange, description, error, id, required, className = '', ...props }: SearchFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const messageId = error || description ? `${inputId}-message` : undefined
  const onChange: ChangeEventHandler<HTMLInputElement> = (event) => onValueChange(event.target.value)
  return <FieldFrame label={label} description={description} error={error} required={required} inputId={inputId}>
    <div className={`ui-search-control${error ? ' has-error' : ''}`}>
      <Search className="ui-search-icon" size={16} aria-hidden="true" />
      <input id={inputId} className={`ui-search-input ${className}`.trim()} type="search" value={value} onChange={onChange} required={required} aria-invalid={Boolean(error) || undefined} aria-describedby={messageId} {...props} />
      {value && <button className="ui-search-clear" type="button" aria-label="清空搜索" onClick={() => onValueChange('')}><X size={15} /></button>}
    </div>
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

function collectOptions(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const element = child as ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>
    if (element.type === 'option') {
      options.push({ value: String(element.props.value ?? ''), label: element.props.children, disabled: Boolean(element.props.disabled) })
      return
    }
    if (element.type === Fragment || element.type === 'optgroup') options.push(...collectOptions(element.props.children))
  })
  return options
}

function encodeValue(value: string) { return value === '' ? EMPTY_VALUE : value }
function decodeValue(value: string) { return value === EMPTY_VALUE ? '' : value }
