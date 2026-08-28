import type { HTMLAttributes, ReactNode } from 'react'

export function Toolbar({ label, children, className = '', ...props }: HTMLAttributes<HTMLDivElement> & { label: string }) {
  return <div className={`ui-toolbar ${className}`.trim()} role="toolbar" aria-label={label} {...props}>{children}</div>
}

export function ToolGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className="ui-tool-group" role="group" aria-label={label}>{children}</div>
}
