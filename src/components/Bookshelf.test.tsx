import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../shared/types'
import { Bookshelf } from './Bookshelf'

vi.mock('../lib/api', () => ({ api: {} }))

const project: Project = { id: 'p', title: '雾港', description: '海雾里的旧案', createdAt: '', updatedAt: '2026-08-28T00:00:00.000Z', deletedAt: null }

describe('Bookshelf shell', () => {
  afterEach(cleanup)

  it('keeps only the three core actions and a more menu visible', () => {
    renderBookshelf()
    expect(screen.getByRole('button', { name: '搜索书架和功能' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入旧稿' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新故事' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '书架更多操作' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'R1 真实验证' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开审阅任务' })).not.toBeInTheDocument()
  })

  it('offers blank and structure-first creation paths', async () => {
    renderBookshelf()
    await userEvent.click(screen.getByRole('button', { name: '新故事' }))
    expect(screen.getByRole('radio', { name: /直接开写/ })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('radio', { name: /从结构起步/ }))
    expect(screen.getByRole('radio', { name: /从结构起步/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: '创建并选择结构' })).toBeInTheDocument()
  })

  it('opens projects from the Mod+K command palette', async () => {
    const onOpen = vi.fn()
    renderBookshelf(onOpen)
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('dialog', { name: '书架命令' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: /雾港/ }))
    expect(onOpen).toHaveBeenCalledWith(project)
  })
})

function renderBookshelf(onOpen = vi.fn()) {
  return render(<Bookshelf projects={[project]} loading={false} onOpen={onOpen} onRefresh={vi.fn().mockResolvedValue(undefined)} onOpenReview={vi.fn()} onOpenResearch={vi.fn()} notify={vi.fn()} />)
}
