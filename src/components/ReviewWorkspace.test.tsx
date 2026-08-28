import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManuscriptNode, Project, ReviewSession } from '../../shared/types'
import { ReviewWorkspace } from './ReviewWorkspace'

const mocks = vi.hoisted(() => ({ listProjectReviews: vi.fn(), listReceivedReviews: vi.fn(), createReviewAssignment: vi.fn(), inspectReviewPackage: vi.fn(), importReviewPackage: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mocks }))

describe('ReviewWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.listProjectReviews.mockResolvedValue([]); mocks.listReceivedReviews.mockResolvedValue([])
    mocks.createReviewAssignment.mockResolvedValue({ session: authoredSession, recoveryPhrase: phrase, package: { format: 'bbd-review-v1' } })
    mocks.inspectReviewPackage.mockResolvedValue({ valid: true, mode: 'assignment', sessionId: 'review-1', projectTitle: project.title, reviewerName: '试读者', role: 'beta_reader', sceneCount: 1, feedbackCount: 0, createdAt: '' })
    mocks.importReviewPackage.mockResolvedValue({ session: receivedSession, duplicate: false })
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:review'), revokeObjectURL: vi.fn() })
    HTMLAnchorElement.prototype.click = vi.fn()
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('creates a scoped assignment and shows its recovery phrase only after creation', async () => {
    const user = userEvent.setup(); render(<ReviewWorkspace project={project} nodes={nodes} onSelectScene={vi.fn()} onChanged={vi.fn()} onBack={vi.fn()} notify={vi.fn()}/>)
    expect(await screen.findByRole('heading', { name: '把意见带回来，不把项目权限交出去' })).toBeInTheDocument()
    expect(screen.queryByText(phrase)).not.toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('例如：林编辑'), '林编辑')
    await user.click(screen.getByRole('button', { name: '生成并下载任务包' }))
    await waitFor(() => expect(mocks.createReviewAssignment).toHaveBeenCalledWith('p', expect.objectContaining({ reviewerName: '林编辑', role: 'editor', sceneIds: ['scene'] })))
    expect(screen.getByText(phrase)).toBeInTheDocument(); expect(screen.getByText('恢复短语只显示这一次')).toBeInTheDocument()
  })

  it('keeps beta-reader feedback comment-only in the isolated reviewer workbench', async () => {
    mocks.listReceivedReviews.mockResolvedValue([receivedSession]); const user = userEvent.setup()
    render(<ReviewWorkspace project={project} nodes={nodes} onSelectScene={vi.fn()} onChanged={vi.fn()} onBack={vi.fn()} notify={vi.fn()}/>)
    await user.click(await screen.findByRole('tab', { name: '审阅者工作台' }))
    expect((await screen.findAllByText('试读者')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('option', { name: '改写建议' })).not.toBeInTheDocument()
    expect(screen.getByText('仅保存隔离副本')).toBeInTheDocument()
  })

  it('opens an empty reviewer inbox without requiring a local project', async () => {
    render(<ReviewWorkspace project={null} nodes={[]} reviewerOnly onSelectScene={vi.fn()} onChanged={vi.fn()} onBack={vi.fn()} notify={vi.fn()}/>)
    expect(await screen.findByRole('button', { name: '返回书架' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '打开作者任务' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '作者处理' })).not.toBeInTheDocument()
  })

  it('reads a selected review file and imports only after package preflight', async () => {
    const user = userEvent.setup(); render(<ReviewWorkspace project={null} nodes={[]} reviewerOnly onSelectScene={vi.fn()} onChanged={vi.fn()} onBack={vi.fn()} notify={vi.fn()}/>)
    const reviewPackage = { format: 'bbd-review-v1', protocolVersion: 1, ciphertext: 'sealed' }
    const file = new File([JSON.stringify(reviewPackage)], 'task.bbd-review', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(JSON.stringify(reviewPackage)) })
    await user.upload(screen.getByLabelText('选择审阅包'), file)
    await user.type(screen.getByPlaceholderText('从另一条安全渠道取得'), phrase)
    await user.click(screen.getByRole('button', { name: '校验并打开任务' }))
    await waitFor(() => expect(mocks.inspectReviewPackage).toHaveBeenCalledWith(reviewPackage, phrase))
    expect(mocks.importReviewPackage).toHaveBeenCalledWith(reviewPackage, phrase, undefined)
  })
})

const project: Project = { id: 'p', title: '接力之书', description: '', createdAt: '', updatedAt: '', deletedAt: null }
const nodes: ManuscriptNode[] = [{ id: 'scene', projectId: 'p', parentId: 'chapter', type: 'scene', title: '场景 1', sortKey: 1000, status: 'draft', povEntityId: null, storyTime: null, deletedAt: null, wordCount: 12 }]
const phrase = '1111-2222-3333-4444-5555-6666-7777-8888-9999-aaaa-bbbb-cccc'
const baseSession: ReviewSession = { id: 'review-1', projectId: 'p', sourceProjectId: 'p', projectTitle: project.title, role: 'editor', reviewerName: '林编辑', sceneIds: ['scene'], scenes: [{ id: 'scene', title: '场景 1', plainText: '这是需要审阅的正文。', contentHash: 'hash', provenanceLabel: null }], includeProvenance: false, direction: 'authored', status: 'open', expiresAt: null, createdAt: '2026-08-27T00:00:00.000Z', feedback: [] }
const authoredSession = baseSession
const receivedSession: ReviewSession = { ...baseSession, projectId: null, role: 'beta_reader', reviewerName: '试读者', direction: 'received' }
