import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManuscriptNode, Project } from '../../shared/types'
import { DeliveryWorkspace } from './DeliveryWorkspace'

const mocks = vi.hoisted(() => ({ stats: vi.fn(), listForeshadows: vi.fn(), listDeliveryTemplates: vi.fn(), listDeliveryChecks: vi.fn(), getSetting: vi.fn(), setSetting: vi.fn(), runDeliveryCheck: vi.fn(), setDeliveryRule: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mocks, downloadUrl: (path: string) => path }))

describe('DeliveryWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const pending = new Promise(() => undefined)
    mocks.stats.mockReturnValue(pending); mocks.listForeshadows.mockReturnValue(pending); mocks.listDeliveryTemplates.mockReturnValue(pending); mocks.listDeliveryChecks.mockReturnValue(pending); mocks.getSetting.mockReturnValue(pending)
  })
  afterEach(cleanup)

  it('keeps the first render usable while templates and history are loading', () => {
    render(<DeliveryWorkspace project={project} nodes={nodes} onSelectScene={vi.fn()} notify={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '把故事安全地带出去' })).toBeInTheDocument()
    expect(screen.getByText('尚未检查', { selector: '.ui-badge' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '按所选范围检查' })).toBeDisabled()
  })

  it('persists manual confirmation for the current check run before declaring completion', async () => {
    mocks.stats.mockResolvedValue({ todayNet: 0, dailyGoal: 2000, projectGoal: 100000 })
    mocks.listForeshadows.mockResolvedValue([])
    mocks.listDeliveryTemplates.mockResolvedValue([template])
    mocks.listDeliveryChecks.mockResolvedValue([])
    mocks.getSetting.mockResolvedValue({ value: {} })
    mocks.runDeliveryCheck.mockResolvedValue(checkRun)
    mocks.setSetting.mockResolvedValue({ value: true })

    render(<DeliveryWorkspace project={project} nodes={nodes} onSelectScene={vi.fn()} notify={vi.fn()} />)
    expect(await screen.findByRole('button', { name: '先运行检查' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '按所选范围检查' }))
    await userEvent.click(await screen.findByRole('button', { name: '标记本次已人工确认' }))
    await waitFor(() => expect(mocks.setSetting).toHaveBeenCalledWith('p', 'deliveryManualConfirmations', {
      manual: expect.objectContaining({ checkRunId: 'run-1' }),
    }))
    expect(screen.getByText('检查完成', { selector: '.ui-badge' })).toBeInTheDocument()
  })
})

const project: Project = { id: 'p', title: '交付', description: '', createdAt: '', updatedAt: '', deletedAt: null }
const nodes: ManuscriptNode[] = [
  node('book', '书', null, 1000), node('chapter', '第一章', 'book', 1000), node('scene', '场景 1', 'chapter', 1000),
]
function node(id: string, title: string, parentId: string | null, sortKey: number): ManuscriptNode { return { id, projectId: 'p', parentId, type: id === 'book' ? 'book' : id === 'chapter' ? 'chapter' : 'scene', title, sortKey, status: 'draft', povEntityId: null, storyTime: null, deletedAt: null, wordCount: 0 } }
const template = { id: 'template', channel: '通用', name: '投稿前检查', version: '1', verifiedAt: '', sourceUrl: '', sourceNote: '本地模板', enabled: true, builtIn: true, staleAfterDays: 0, rules: [{ id: 'manual', templateId: 'template', code: 'MANUAL', title: '人工复核版权', description: '确认授权状态', kind: 'manual' as const, config: {}, severity: 'review' as const, enabled: true, effectiveEnabled: true, manual: true }] }
const checkRun = { id: 'run-1', projectId: 'p', templateId: 'template', chapterIds: ['chapter'], results: [], createdAt: '2026-08-28T00:00:00.000Z' }
