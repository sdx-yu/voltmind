import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManuscriptNode, Project, ProvenanceEvent, Revision } from '../../shared/types'
import { ProvenanceWorkspace } from './ProvenanceWorkspace'

const mocks = vi.hoisted(() => ({ listProvenance: vi.fn(), listProvenanceExports: vi.fn(), exportProvenance: vi.fn(), verifyProvenance: vi.fn(), listRevisions: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mocks }))

describe('ProvenanceWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listProvenance.mockResolvedValue(events)
    mocks.listProvenanceExports.mockResolvedValue([])
    mocks.exportProvenance.mockResolvedValue({ fileName: '来源.json', mimeType: 'application/json', content: '{}', manifestHash: 'f'.repeat(64), eventCount: 2 })
    mocks.listRevisions.mockResolvedValue(revisions)
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('filters the timeline, opens parent-version diff and exports only explicitly selected text', async () => {
    const user = userEvent.setup()
    render(<ProvenanceWorkspace project={project} nodes={nodes} onSelectScene={vi.fn()} notify={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '每一次选择，都有来处' })).toBeInTheDocument()
    expect(await screen.findByText('人工编辑')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'AI' }))
    expect(screen.queryByText('人工编辑')).not.toBeInTheDocument()
    expect(screen.getByText('AI 候选生成')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '全部' }))
    await user.click(screen.getByRole('button', { name: '版本差异' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('版本与父版本差异')
    await user.click(screen.getByRole('button', { name: '关闭' }))
    await user.click(screen.getByRole('button', { name: '导出 JSON' }))
    await waitFor(() => expect(mocks.exportProvenance).toHaveBeenCalledWith('p', 'json', false))
    await user.click(screen.getByRole('checkbox', { name: /包含正文摘录/ }))
    await user.click(screen.getByRole('button', { name: '导出 HTML' }))
    await waitFor(() => expect(mocks.exportProvenance).toHaveBeenCalledWith('p', 'html', true))
  })
})

const project: Project = { id: 'p', title: '来源之书', description: '', createdAt: '', updatedAt: '', deletedAt: null }
const nodes: ManuscriptNode[] = [{ id: 'scene', projectId: 'p', parentId: 'chapter', type: 'scene', title: '场景 1', sortKey: 1, status: 'draft', povEntityId: null, storyTime: null, deletedAt: null, wordCount: 4 }]
const events: ProvenanceEvent[] = [
  { id: 'e1', projectId: 'p', nodeId: 'scene', revisionId: 'r1', eventType: 'human_edit', actorType: 'human', sourceTaskId: null, sourceRevisionId: null, contentHash: 'a'.repeat(64), metadata: {}, previousHash: null, eventHash: '1'.repeat(64), createdAt: '2026-08-26T08:00:00.000Z', nodeTitle: '场景 1' },
  { id: 'e2', projectId: 'p', nodeId: 'scene', revisionId: null, eventType: 'ai_generated', actorType: 'ai', sourceTaskId: 'task', sourceRevisionId: null, contentHash: 'b'.repeat(64), metadata: {}, previousHash: '1'.repeat(64), eventHash: '2'.repeat(64), createdAt: '2026-08-26T08:01:00.000Z', nodeTitle: '场景 1' },
]
const revisions: Revision[] = [{ id: 'r1', nodeId: 'scene', parentRevisionId: null, contentJson: {}, plainText: '作者初稿', contentHash: 'a'.repeat(64), sourceType: 'human', provenanceLabel: 'human', sourceTaskId: null, createdAt: '2026-08-26T08:00:00.000Z' }]
