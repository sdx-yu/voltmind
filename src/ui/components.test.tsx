import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, ModalDialog, PageHeader, SearchField, SegmentedControl, SelectField, TextField } from './index'

describe('UI foundation components', () => {
  afterEach(cleanup)

  it('exposes loading and disabled button state without losing its label', () => {
    render(<Button loading>保存设置</Button>)
    const button = screen.getByRole('button', { name: '保存设置' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('connects field errors to the input', () => {
    render(<TextField label="章节编号" error="必须大于 0" defaultValue="-1" />)
    const input = screen.getByRole('textbox', { name: '章节编号' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('必须大于 0')
  })

  it('supports arrow-key focus and explicit selection in segmented controls', async () => {
    const onChange = vi.fn()
    render(<SegmentedControl label="主题" value="paper" onChange={onChange} items={[{ id: 'paper', label: '宣纸' }, { id: 'night', label: '夜间' }, { id: 'high-contrast', label: '高对比' }]} />)
    const paper = screen.getByRole('tab', { name: '宣纸' })
    const night = screen.getByRole('tab', { name: '夜间' })
    paper.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(night).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('night')
  })

  it('uses a branded listbox while preserving keyboard selection and focus', async () => {
    const onValueChange = vi.fn()
    render(<SelectField label="场景状态" value="draft" onValueChange={onValueChange}><option value="idea">想法</option><option value="draft">草稿</option><option value="revising">修订中</option></SelectField>)
    const trigger = screen.getByRole('combobox', { name: '场景状态' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onValueChange).toHaveBeenCalledWith('revising')
    expect(trigger).toHaveFocus()
  })

  it('keeps search in one control surface and offers an explicit clear action', async () => {
    const onValueChange = vi.fn()
    render(<SearchField label="搜索正典" value="雾港" onValueChange={onValueChange} />)
    expect(screen.getByRole('searchbox', { name: '搜索正典' })).toHaveValue('雾港')
    await userEvent.click(screen.getByRole('button', { name: '清空搜索' }))
    expect(onValueChange).toHaveBeenCalledWith('')
  })

  it('closes a modal with Escape and preserves an accessible title', async () => {
    const onOpenChange = vi.fn()
    render(<ModalDialog title="接受候选" open onOpenChange={onOpenChange}><p>候选内容</p></ModalDialog>)
    expect(screen.getByRole('dialog', { name: '接受候选' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('returns focus to the trigger after a modal closes', async () => {
    render(<ModalDialog title="项目设置" trigger={<button type="button">打开设置</button>}><p>设置内容</p></ModalDialog>)
    const trigger = screen.getByRole('button', { name: '打开设置' })
    await userEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '项目设置' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
  })

  it('uses utility headings by default and makes editorial headings explicit', () => {
    const { rerender } = render(<PageHeader title="设备接力" />)
    expect(screen.getByRole('banner')).toHaveClass('ui-page-header-utility')
    rerender(<PageHeader tone="editorial" title="故事中的事实" />)
    expect(screen.getByRole('banner')).toHaveClass('ui-page-header-editorial')
  })
})
