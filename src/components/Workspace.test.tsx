import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManuscriptNode, Project } from '../../shared/types'
import { Workspace } from './Workspace'

const mocks = vi.hoisted(() => ({
  listNodes: vi.fn(),
  listEntities: vi.fn(),
  getScene: vi.fn(),
  trashNode: vi.fn(),
}))
vi.mock('../lib/api', () => ({ api: mocks }))

const project: Project = { id: 'p', title: '雾港', description: '', createdAt: '', updatedAt: '', deletedAt: null }
const nodes: ManuscriptNode[] = [
  node('book', '书', null, 1000, 'book'),
  node('chapter', '第一章', 'book', 1000, 'chapter'),
  node('scene', '雨夜', 'chapter', 1000, 'scene'),
]

describe('Workspace chrome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
    mocks.listNodes.mockResolvedValue(nodes)
    mocks.listEntities.mockResolvedValue([])
    mocks.getScene.mockResolvedValue({ nodeId: 'scene', contentJson: { type: 'doc', content: [{ type: 'paragraph' }] }, plainText: '', contentHash: '', currentRevisionId: null, updatedAt: '' })
  })
  afterEach(cleanup)

  it('keeps five task modes and exposes contextual tools outside primary navigation', async () => {
    render(<Workspace project={project} onBack={vi.fn()} notify={vi.fn()} />)
    expect(await screen.findByRole('navigation', { name: '主要工作台' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '写作' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '规划' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '正典' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '修订' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '交付' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '来源' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '接力' })).not.toBeInTheDocument()
  })

  it('opens the project command palette with Mod+K and navigates to revision', async () => {
    render(<Workspace project={project} onBack={vi.fn()} notify={vi.fn()} />)
    expect(await screen.findByRole('navigation', { name: '主要工作台' })).toBeInTheDocument()
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('dialog', { name: '项目命令' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: /打开修订台/ }))
    expect(await screen.findByRole('heading', { name: '把发现变成决定' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '修订' })).toHaveClass('active')
  })

  it('persists keyboard resized pane widths', async () => {
    render(<Workspace project={project} onBack={vi.fn()} notify={vi.fn()} />)
    const separator = await screen.findByRole('separator', { name: '调整书稿树宽度' })
    separator.focus()
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(JSON.parse(localStorage.getItem('bbd-chrome') || '{}')).toMatchObject({ treeWidth: 272 }))
  })

  it('asks before trashing a scene instead of using window.confirm', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    render(<Workspace project={project} onBack={vi.fn()} notify={vi.fn()} />)
    expect(await screen.findByRole('button', { name: '删除 雨夜' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '删除 雨夜' }))
    expect(screen.getByRole('dialog', { name: '移到回收站' })).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '移到回收站' }))
    await waitFor(() => expect(mocks.trashNode).toHaveBeenCalledWith('scene'))
  })

  it('moves both side panes into accessible drawers on a single-column viewport', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes('max-width: 1279px') || query.includes('max-width: 1023px'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    })
    render(<Workspace project={project} onBack={vi.fn()} notify={vi.fn()} />)
    expect(await screen.findByRole('button', { name: '打开书稿树' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: '书稿结构' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '打开书稿树' }))
    expect(screen.getByRole('dialog', { name: '书稿结构' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    await userEvent.click(screen.getByRole('button', { name: '打开检查器' }))
    expect(screen.getByRole('dialog', { name: '场景检查器' })).toBeInTheDocument()
  })
})

function node(id: string, title: string, parentId: string | null, sortKey: number, type: ManuscriptNode['type']): ManuscriptNode {
  return { id, projectId: 'p', parentId, type, title, sortKey, status: 'draft', povEntityId: null, storyTime: null, deletedAt: null, wordCount: 0 }
}
