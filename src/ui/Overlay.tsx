import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Check, ChevronRight, X } from 'lucide-react'
import { useRef, type ReactElement, type ReactNode } from 'react'
import { IconButton } from './Button'

interface ModalDialogProps {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  trigger?: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  wide?: boolean
  className?: string
}

export function ModalDialog({ title, description, children, footer, trigger, open, onOpenChange, wide = false, className = '' }: ModalDialogProps) {
  const returnFocus = useRef<HTMLElement | null>(null)
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-overlay" />
      <DialogPrimitive.Content className={`ui-dialog${wide ? ' ui-dialog-wide' : ''} ${className}`.trim()} onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }} onCloseAutoFocus={(event) => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus() } }}>
        <header className="ui-dialog-header">
          <div><DialogPrimitive.Title>{title}</DialogPrimitive.Title><DialogPrimitive.Description className={description ? '' : 'ui-sr-only'}>{description ?? `${title}对话框`}</DialogPrimitive.Description></div>
          <DialogPrimitive.Close asChild><IconButton label="关闭" size="small"><X size={18} /></IconButton></DialogPrimitive.Close>
        </header>
        <div className="ui-dialog-body">{children}</div>
        {footer && <footer className="ui-dialog-footer">{footer}</footer>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}

export function Drawer({ title, description, children, trigger, open, onOpenChange, side = 'right', className = '' }: Omit<ModalDialogProps, 'footer' | 'wide'> & { side?: 'left' | 'right' }) {
  const returnFocus = useRef<HTMLElement | null>(null)
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    {trigger && <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>}
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="ui-overlay" />
      <DialogPrimitive.Content className={`ui-drawer ui-drawer-${side} ${className}`.trim()} onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null }} onCloseAutoFocus={(event) => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus() } }}>
        <header className="ui-dialog-header">
          <div><DialogPrimitive.Title>{title}</DialogPrimitive.Title><DialogPrimitive.Description className={description ? '' : 'ui-sr-only'}>{description ?? `${title}抽屉`}</DialogPrimitive.Description></div>
          <DialogPrimitive.Close asChild><IconButton label="关闭" size="small"><X size={18} /></IconButton></DialogPrimitive.Close>
        </header>
        <div className="ui-dialog-body">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}

export function Popover({ trigger, children, align = 'center', sideOffset = 8, open, onOpenChange }: { trigger: ReactElement; children: ReactNode; align?: 'start' | 'center' | 'end'; sideOffset?: number; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  return <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
    <PopoverPrimitive.Portal><PopoverPrimitive.Content className="ui-popover" align={align} sideOffset={sideOffset}>{children}<PopoverPrimitive.Arrow className="ui-popover-arrow" /></PopoverPrimitive.Content></PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>
}

export interface MenuItem {
  id: string
  label: string
  icon?: ReactNode
  hint?: string
  disabled?: boolean
  danger?: boolean
  selected?: boolean
  onSelect?: () => void
  children?: MenuItem[]
}

function DropdownItems({ items }: { items: MenuItem[] }) {
  return <>{items.map((item) => item.children?.length ? <DropdownPrimitive.Sub key={item.id}>
    <DropdownPrimitive.SubTrigger className="ui-menu-item">{item.icon}<span>{item.label}</span><ChevronRight size={14} /></DropdownPrimitive.SubTrigger>
    <DropdownPrimitive.Portal><DropdownPrimitive.SubContent className="ui-menu-content" sideOffset={6}><DropdownItems items={item.children} /></DropdownPrimitive.SubContent></DropdownPrimitive.Portal>
  </DropdownPrimitive.Sub> : <DropdownPrimitive.Item
    key={item.id}
    className={`ui-menu-item${item.danger ? ' is-danger' : ''}`}
    disabled={item.disabled}
    onSelect={item.onSelect}
  >
    {item.icon}<span>{item.label}</span>{item.hint && <small>{item.hint}</small>}{item.selected && <Check size={14} />}
  </DropdownPrimitive.Item>)}</>
}

export function DropdownMenu({ trigger, items, label = '更多操作', align = 'end', onCloseAutoFocus }: { trigger: ReactElement; items: MenuItem[]; label?: string; align?: 'start' | 'center' | 'end'; onCloseAutoFocus?: (event: Event) => void }) {
  return <DropdownPrimitive.Root>
    <DropdownPrimitive.Trigger asChild aria-label={label}>{trigger}</DropdownPrimitive.Trigger>
    <DropdownPrimitive.Portal><DropdownPrimitive.Content className="ui-menu-content" align={align} sideOffset={6} onCloseAutoFocus={onCloseAutoFocus}><DropdownItems items={items} /></DropdownPrimitive.Content></DropdownPrimitive.Portal>
  </DropdownPrimitive.Root>
}
