import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManuscriptNode } from '../../shared/types'
import { ManuscriptTree } from './ManuscriptTree'

const nodes: ManuscriptNode[] = [
  node('book', '小说', null, 'book', 1000),
  node('chapter', '第一章', 'book', 'chapter', 1000),
  node('scene', '场景 1', 'chapter', 'scene', 1000),
]

describe('ManuscriptTree footer actions', () => {
  afterEach(cleanup)

  it('opens a real menu and exposes useful tree actions', async () => {
    const onSearch = vi.fn()
    renderTree(onSearch)

    await userEvent.click(screen.getByRole('button', { name: '书稿更多操作' }))
    expect(screen.getByRole('menuitem', { name: /重命名当前项/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '折叠全部' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: '展开全部' })).toHaveAttribute('data-disabled')
    await userEvent.click(screen.getByRole('menuitem', { name: '搜索书稿' }))
    expect(onSearch).toHaveBeenCalledOnce()
  })

  it('renames the selected scene and can collapse then expand the tree', async () => {
    renderTree()

    await userEvent.click(screen.getByRole('button', { name: '书稿更多操作' }))
    await userEvent.click(screen.getByRole('menuitem', { name: /重命名当前项/ }))
    expect(await screen.findByDisplayValue('场景 1')).toHaveFocus()

    await userEvent.tab()
    await userEvent.click(screen.getByRole('button', { name: '书稿更多操作' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '折叠全部' }))
    expect(document.querySelector('.scene-select')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '书稿更多操作' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '展开全部' }))
    expect(document.querySelector('.scene-select')).toBeInTheDocument()
  })
})

function renderTree(onSearch = vi.fn()) {
  return render(<ManuscriptTree nodes={nodes} selectedId="scene" onSelect={vi.fn()} onCreateVolume={vi.fn()} onCreateChapter={vi.fn()} onCreateScene={vi.fn()} onUpdate={vi.fn()} onTrash={vi.fn()} onSplit={vi.fn()} onMerge={vi.fn()} onSearch={onSearch} />)
}

function node(id: string, title: string, parentId: string | null, type: ManuscriptNode['type'], sortKey: number): ManuscriptNode {
  return { id, projectId: 'project', parentId, type, title, sortKey, status: 'draft', povEntityId: null, storyTime: null, deletedAt: null, wordCount: 0 }
}
