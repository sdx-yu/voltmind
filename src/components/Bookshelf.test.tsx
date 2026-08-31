import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../shared/types'
import { Bookshelf } from './Bookshelf'

const mocks = vi.hoisted(() => ({ updateProject: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mocks }))

const project: Project = { id: 'p', title: '雾港', description: '海雾里的旧案', createdAt: '', updatedAt: '2026-08-28T00:00:00.000Z', deletedAt: null }

describe('Bookshelf shell', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks() })

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

  it('routes native commands and explains project-only actions', async () => {
    const notify = vi.fn()
    renderBookshelf(vi.fn(), notify)
    act(() => window.dispatchEvent(new CustomEvent('bbd:command', { detail: 'command-palette' })))
    expect(await screen.findByRole('dialog', { name: '书架命令' })).toBeInTheDocument()
    act(() => window.dispatchEvent(new CustomEvent('bbd:command', { detail: 'view-write' })))
    expect(notify).toHaveBeenCalledWith('error', '这个命令需要先打开一个项目')
  })

  it('edits the novel title and description from the project card menu', async () => {
    const updated = { ...project, title: '雾港来信', description: '一封迟到十年的信' }
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    mocks.updateProject.mockResolvedValue(updated)
    renderBookshelf(vi.fn(), vi.fn(), onRefresh)

    await userEvent.click(screen.getByRole('button', { name: '雾港更多操作' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '编辑作品信息' }))
    const title = screen.getByRole('textbox', { name: /书名/ })
    const description = screen.getByRole('textbox', { name: /作品简介/ })
    await waitFor(() => expect(title).toHaveFocus())
    await userEvent.clear(title); await userEvent.type(title, '雾港来信')
    await userEvent.clear(description); await userEvent.type(description, '一封迟到十年的信')
    await userEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => expect(mocks.updateProject).toHaveBeenCalledWith('p', { title: '雾港来信', description: '一封迟到十年的信' }))
    expect(onRefresh).toHaveBeenCalled()
  })
})

function renderBookshelf(onOpen = vi.fn(), notify = vi.fn(), onRefresh = vi.fn().mockResolvedValue(undefined)) {
  return render(<Bookshelf projects={[project]} loading={false} onOpen={onOpen} onRefresh={onRefresh} onOpenReview={vi.fn()} onOpenResearch={vi.fn()} notify={notify} />)
}
