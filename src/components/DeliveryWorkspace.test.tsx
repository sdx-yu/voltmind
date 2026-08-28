import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManuscriptNode, Project } from '../../shared/types'
import { DeliveryWorkspace } from './DeliveryWorkspace'

const mocks = vi.hoisted(() => ({ stats: vi.fn(), listForeshadows: vi.fn(), listDeliveryTemplates: vi.fn(), listDeliveryChecks: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mocks, downloadUrl: (path: string) => path }))

describe('DeliveryWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const pending = new Promise(() => undefined)
    mocks.stats.mockReturnValue(pending); mocks.listForeshadows.mockReturnValue(pending); mocks.listDeliveryTemplates.mockReturnValue(pending); mocks.listDeliveryChecks.mockReturnValue(pending)
  })
  afterEach(cleanup)

  it('keeps the first render usable while templates and history are loading', () => {
    render(<DeliveryWorkspace project={project} nodes={nodes} onSelectScene={vi.fn()} notify={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '把故事安全地带出去' })).toBeInTheDocument()
    expect(screen.getByText('尚未检查', { selector: '.ui-badge' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '按所选范围检查' })).toBeDisabled()
  })
})

const project: Project = { id: 'p', title: '交付', description: '', createdAt: '', updatedAt: '', deletedAt: null }
const nodes: ManuscriptNode[] = [
  node('book', '书', null, 1000), node('chapter', '第一章', 'book', 1000), node('scene', '场景 1', 'chapter', 1000),
]
function node(id: string, title: string, parentId: string | null, sortKey: number): ManuscriptNode { return { id, projectId: 'p', parentId, type: id === 'book' ? 'book' : id === 'chapter' ? 'chapter' : 'scene', title, sortKey, status: 'draft', povEntityId: null, storyTime: null, deletedAt: null, wordCount: 0 } }
