import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BoardTemplate, EditorTemplate, LibraryTemplate, MetricStrip, WorkflowSteps, WorkflowTemplate } from './Templates'

describe('UI page templates', () => {
  afterEach(cleanup)

  it('labels the editor template and derives its visible pane contract', () => {
    render(<EditorTemplate navigation={<aside>书稿</aside>} content={<main>正文</main>} details={<aside>检查器</aside>} />)
    const template = screen.getByText('正文').parentElement
    expect(template).toHaveAttribute('data-ui-template', 'editor')
    expect(template).toHaveClass('ui-template-editor-three')
  })

  it.each([
    ['board', BoardTemplate],
    ['library', LibraryTemplate],
    ['workflow', WorkflowTemplate],
  ] as const)('exposes the %s template for page-level verification', (name, Template) => {
    const { container } = render(<Template>内容</Template>)
    expect(container.firstElementChild).toHaveAttribute('data-ui-template', name)
  })

  it('marks the current workflow step semantically', () => {
    render(<WorkflowSteps label="交付步骤" items={[
      { id: 'scope', label: '确认范围', state: 'complete' },
      { id: 'check', label: '执行检查', description: '处理阻断项', state: 'current' },
      { id: 'export', label: '导出', state: 'upcoming' },
    ]} />)
    expect(screen.getByRole('navigation', { name: '交付步骤' })).toBeInTheDocument()
    expect(screen.getByText('执行检查').closest('li')).toHaveAttribute('aria-current', 'step')
  })

  it('exposes workflow metrics as a named region', () => {
    render(<MetricStrip label="交付摘要" items={[{ id: 'words', label: '总字数', value: '12,800' }]} />)
    expect(screen.getByRole('region', { name: '交付摘要' })).toContainElement(screen.getByText('总字数'))
  })
})
