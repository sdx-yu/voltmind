import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entity, KnowledgeFact, ManuscriptNode } from '../../shared/types'
import { Inspector } from './Inspector'

const mocks = vi.hoisted(() => ({
  listKnowledge: vi.fn(), listNodes: vi.fn(), createKnowledge: vi.fn(), trashKnowledge: vi.fn(), grantKnowledge: vi.fn(),
  listMentions: vi.fn(), suggestMentions: vi.fn(), currentStates: vi.fn(),
  getContext: vi.fn(), getAiSettings: vi.fn(),
}))
vi.mock('../lib/api', () => ({ api: mocks }))

const character: Entity = { id: 'lin', projectId: 'p', type: 'character', canonicalName: '林照', aliases: [], summary: '', privacyLevel: 'normal', createdAt: '', updatedAt: '', deletedAt: null }
const nodes = [node('book', 'book', null, 1000), node('chapter', '第一章', 'book', 1000), { ...node('s1', '场景 1', 'chapter', 1000), povEntityId: 'lin' }, { ...node('s2', '场景 2', 'chapter', 2000), povEntityId: 'lin' }]

describe('Inspector knowledge panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listNodes.mockResolvedValue(nodes)
    mocks.listKnowledge.mockResolvedValue([fact()])
    mocks.createKnowledge.mockResolvedValue(fact())
    mocks.listMentions.mockResolvedValue([])
    mocks.suggestMentions.mockResolvedValue([])
    mocks.currentStates.mockResolvedValue([])
    mocks.getContext.mockResolvedValue([{ id: 's1', type: 'scene', title: '当前场景', content: '雨落在窗前。', selected: true, privacyLevel: 'normal', estimatedTokens: 8, reason: '当前正文' }])
    mocks.getAiSettings.mockResolvedValue({ baseUrl: 'mock://local', model: '笔不怠演示模型', hasApiKey: false, credentialStore: 'protected_file', provider: 'demo', costPolicy: 'local_only' })
  })
  afterEach(cleanup)

  it('shows the current POV boundary and creates facts only from explicit keywords', async () => {
    render(<Inspector projectId="p" node={nodes[2]} entities={[character]} refreshEntities={vi.fn()} onUpdateNode={vi.fn()} onRefreshTree={vi.fn()} onReloadScene={vi.fn()} notify={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: '正典' }))
    expect(await screen.findByText('当前视角：')).toBeInTheDocument()
    expect(screen.getByText('0 条已知 · 1 条未知')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '建立知识事实' }))
    await userEvent.type(screen.getByLabelText('秘密或知识名称'), '凶手身份')
    await userEvent.type(screen.getByLabelText('正文识别词'), '沈砚是凶手、真凶沈砚')
    await userEvent.click(screen.getByRole('combobox', { name: '首次对读者揭示' }))
    await userEvent.click(screen.getByRole('option', { name: '场景 2' }))
    await userEvent.click(screen.getByRole('button', { name: '建立' }))
    await waitFor(() => expect(mocks.createKnowledge).toHaveBeenCalledWith('p', expect.objectContaining({ title: '凶手身份', keywords: ['沈砚是凶手', '真凶沈砚'], firstRevealedNodeId: 's2' })))
  })

  it('labels the default AI provider as a non-networked demo before generation', async () => {
    render(<Inspector projectId="p" node={nodes[2]} entities={[character]} refreshEntities={vi.fn()} onUpdateNode={vi.fn()} onRefreshTree={vi.fn()} onReloadScene={vi.fn()} notify={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: 'AI' }))
    expect(await screen.findByText('演示模式 · 固定候选 · 不联网')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '生成演示候选' })).toBeInTheDocument()
  })
})

function node(id: string, title: string, parentId: string | null, sortKey: number): ManuscriptNode { return { id, projectId: 'p', parentId, type: id === 'book' ? 'book' : id === 'chapter' ? 'chapter' : 'scene', title, sortKey, status: 'draft', povEntityId: null, storyTime: null, deletedAt: null, wordCount: 0 } }
function fact(): KnowledgeFact { return { id: 'k', projectId: 'p', title: '凶手身份', detail: '凶手是沈砚', keywords: ['沈砚是凶手'], firstRevealedNodeId: 's2', privacyLevel: 'author_only', createdAt: '', updatedAt: '', deletedAt: null, grants: [{ id: 'g', knowledgeId: 'k', entityId: 'lin', knownFromNodeId: 's2', sourceNodeId: 's2', evidence: '', note: '', createdAt: '' }] } }
