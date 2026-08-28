import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entity, ManuscriptNode, Project, Storyboard, VisualAnchor } from '../../shared/types'
import { VisualWorkspace } from './VisualWorkspace'

const mocks = vi.hoisted(() => ({ listVisualAnchors: vi.fn(), listStoryboards: vi.fn(), listStates: vi.fn(), createVisualAnchor: vi.fn(), refreshVisualAnchor: vi.fn(), importVisualCandidate: vi.fn(), resolveVisualCandidate: vi.fn(), getOrCreateStoryboard: vi.fn(), addStoryboardCard: vi.fn(), moveStoryboardCard: vi.fn(), deleteStoryboardCard: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mocks }))

describe('VisualWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.listVisualAnchors.mockResolvedValue([anchor]); mocks.listStoryboards.mockResolvedValue([storyboard]); mocks.listStates.mockResolvedValue([])
    mocks.importVisualCandidate.mockResolvedValue(anchor.candidates[0]); mocks.resolveVisualCandidate.mockResolvedValue(anchor.candidates[0]); mocks.addStoryboardCard.mockResolvedValue(storyboard.cards[0])
  })
  afterEach(() => cleanup())

  it('states the local-only provider boundary and disables local_private canon in the field picker', async () => {
    const user = userEvent.setup(); render(<VisualWorkspace project={project} nodes={nodes} entities={entities} onBack={vi.fn()} notify={vi.fn()}/>)
    expect(await screen.findByText('本阶段不连接远程图像 Provider')).toBeInTheDocument()
    expect(screen.getByText(/不会用图片反写人物、地点、物品或剧情事实/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '建立视觉锚点' }))
    await user.click(screen.getByRole('combobox', { name: '正典项' }))
    expect(screen.getByRole('option', { name: '密钥（仅本地，不可读取）' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText(/只有下方明确勾选的字段/)).toBeInTheDocument()
  })

  it('reads a real image File and imports it as a candidate before any acceptance', async () => {
    const user = userEvent.setup(); render(<VisualWorkspace project={project} nodes={nodes} entities={entities} onBack={vi.fn()} notify={vi.fn()}/>)
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
    const file = new File([bytes], 'lin-wu.png', { type: 'image/png' })
    Object.defineProperty(file, 'arrayBuffer', { value: vi.fn().mockResolvedValue(bytes.buffer) })
    await user.upload(await screen.findByLabelText('导入视觉候选'), file)
    await waitFor(() => expect(mocks.importVisualCandidate).toHaveBeenCalledWith('anchor', expect.objectContaining({ fileName: 'lin-wu.png', mimeType: 'image/png' })))
    expect(mocks.resolveVisualCandidate).not.toHaveBeenCalled()
  })

  it('accepts candidates explicitly and creates text-free storyboard cards', async () => {
    const user = userEvent.setup(); render(<VisualWorkspace project={project} nodes={nodes} entities={entities} onBack={vi.fn()} notify={vi.fn()}/>)
    await user.click(await screen.findByLabelText('接受 candidate.png'))
    await waitFor(() => expect(mocks.resolveVisualCandidate).toHaveBeenCalledWith('candidate', 'accepted'))
    await user.type(screen.getByLabelText('镜头目的'), '人物入场')
    await user.click(screen.getByRole('combobox', { name: '镜头视觉锚点' }))
    await user.click(screen.getByRole('option', { name: '林雾' }))
    await user.type(screen.getByLabelText('镜头备注'), '保持红围巾连续性')
    await user.click(screen.getByRole('button', { name: '添加分镜卡' }))
    expect(mocks.addStoryboardCard).toHaveBeenCalledWith('board', expect.objectContaining({ purpose: '人物入场', note: '保持红围巾连续性', anchorIds: ['anchor'], assetHash: 'a'.repeat(64) }))
    expect(JSON.stringify(mocks.addStoryboardCard.mock.calls[0])).not.toContain('正文不能进入')
  })
})

const project: Project = { id: 'project', title: '视觉小说', description: '', createdAt: '', updatedAt: '', deletedAt: null }
const nodes: ManuscriptNode[] = [{ id: 'scene', projectId: 'project', parentId: 'chapter', type: 'scene', title: '雨夜入场', sortKey: 1000, status: 'draft', povEntityId: null, storyTime: null, deletedAt: null, wordCount: 8 }]
const entities: Entity[] = [
  { id: 'entity', projectId: 'project', type: 'character', canonicalName: '林雾', aliases: [], summary: '红围巾', privacyLevel: 'normal', createdAt: '', updatedAt: '', deletedAt: null },
  { id: 'private', projectId: 'project', type: 'item', canonicalName: '密钥', aliases: [], summary: '正文不能进入', privacyLevel: 'local_private', createdAt: '', updatedAt: '', deletedAt: null },
]
const asset = { contentHash: 'a'.repeat(64), mimeType: 'image/png' as const, byteSize: 68, width: 1, height: 1, createdAt: '', url: '/api/visual-assets/asset/content' }
const anchor: VisualAnchor = { id: 'anchor', projectId: 'project', entityId: 'entity', entityName: '林雾', entityType: 'character', selectedFields: ['canonicalName', 'summary'], styleNote: '', visualDescription: '人物：林雾。已确认简介：红围巾', canonSnapshot: { entityId: 'entity', entityType: 'character', entityUpdatedAt: '', selectedFields: ['canonicalName', 'summary'], values: { canonicalName: '林雾', summary: '红围巾' } }, canonHash: 'c'.repeat(64), currentCanonHash: 'c'.repeat(64), bindingStatus: 'current', acceptedCandidateId: 'accepted', acceptedAsset: asset, candidates: [{ id: 'candidate', projectId: 'project', anchorId: 'anchor', asset, sourceKind: 'import', sourceLabel: '作者本地导入', fileName: 'candidate.png', descriptionSnapshot: '人物：林雾', canonHash: 'c'.repeat(64), status: 'pending', createdAt: '', resolvedAt: null }], createdAt: '', updatedAt: '' }
const storyboard: Storyboard = { id: 'board', projectId: 'project', sceneId: 'scene', sceneTitle: '雨夜入场', title: '雨夜入场 · 故事板', cards: [], createdAt: '', updatedAt: '' }
