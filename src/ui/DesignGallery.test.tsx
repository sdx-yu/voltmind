import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { DesignGallery } from './DesignGallery'

describe('Design Gallery', () => {
  afterEach(() => {
    cleanup()
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.density
  })

  it('catalogues the foundation and switches theme and density', async () => {
    render(<DesignGallery />)
    expect(screen.getByRole('heading', { name: '温润纸感，克制工具感' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '按钮与工具栏' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '弹层与菜单' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: '夜间' }))
    expect(document.documentElement.dataset.theme).toBe('night')
    await userEvent.click(screen.getByRole('tab', { name: '触控' }))
    expect(document.documentElement.dataset.density).toBe('touch')
  })

  it('opens the dialog and drawer examples', async () => {
    render(<DesignGallery />)
    await userEvent.click(screen.getByRole('button', { name: '打开对话框' }))
    expect(screen.getByRole('dialog', { name: '接受事实候选' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: '打开详情栏' }))
    expect(screen.getByRole('dialog', { name: '正典详情' })).toBeInTheDocument()
  })
})
