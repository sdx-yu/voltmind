import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManuscriptNode, Project, SprintBoard, SprintSession } from '../../shared/types'
import { SprintWorkspace } from './SprintWorkspace'

const mocks = vi.hoisted(() => ({ listSprints: vi.fn(), listSprintBoards: vi.fn(), startSprint: vi.fn(), pauseSprint: vi.fn(), resumeSprint: vi.fn(), reconcileSprint: vi.fn(), completeSprint: vi.fn(), cancelSprint: vi.fn(), exportSprintCard: vi.fn(), inspectSprintCard: vi.fn(), createSprintBoard: vi.fn(), importSprintCard: vi.fn(), addLocalSprintCard: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mocks }))

describe('SprintWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); mocks.listSprints.mockResolvedValue([]); mocks.listSprintBoards.mockResolvedValue([])
    mocks.startSprint.mockResolvedValue(activeSession); mocks.inspectSprintCard.mockResolvedValue({ valid: true, cardId: 'card', participantLabel: '作者甲', scope: 'scene', startedAt: '', endedAt: '', activeDurationMs: 600000, goalWords: 500, netWords: 320, eventCount: 2 })
    mocks.importSprintCard.mockResolvedValue({ board, duplicate: false })
  })
  afterEach(() => cleanup())

  it('starts a scene sprint with an explicit duration and saved-version goal', async () => {
    const user = userEvent.setup(); const onOpenScene = vi.fn()
    render(<SprintWorkspace project={project} nodes={nodes} activeSceneId="scene" onOpenScene={onOpenScene} onBack={vi.fn()} notify={vi.fn()}/>)
    await user.clear(await screen.findByLabelText('时长（分钟）')); await user.type(screen.getByLabelText('时长（分钟）'), '30')
    await user.clear(screen.getByLabelText('净新增目标')); await user.type(screen.getByLabelText('净新增目标'), '800')
    await user.click(screen.getByRole('button', { name: '开始并进入安静写作' }))
    await waitFor(() => expect(mocks.startSprint).toHaveBeenCalledWith('project', { scope: 'scene', sceneId: 'scene', durationMinutes: 30, goalWords: 800 }))
    expect(onOpenScene).toHaveBeenCalledWith('scene')
  })

  it('shows conservative sleep reconciliation and resumes only explicitly', async () => {
    const sleeping = { ...activeSession, status: 'paused' as const, clockStatus: 'sleep_reconciled' as const, activeElapsedMs: 60000, pausedAt: new Date().toISOString() }
    mocks.listSprints.mockResolvedValue([sleeping]); mocks.resumeSprint.mockResolvedValue({ ...sleeping, status: 'running', pausedAt: null })
    const user = userEvent.setup(); render(<SprintWorkspace project={project} nodes={nodes} activeSceneId="scene" onOpenScene={vi.fn()} onBack={vi.fn()} notify={vi.fn()}/>)
    expect(await screen.findByText('计时需要核对')).toBeInTheDocument(); expect(screen.getByText(/未知时段没有算作连续写作/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '核对后恢复' })); await waitFor(() => expect(mocks.resumeSprint).toHaveBeenCalledWith('sprint'))
  })

  it('preflights a real result file before adding it to the selected offline board', async () => {
    mocks.listSprintBoards.mockResolvedValue([board]); const user = userEvent.setup()
    render(<SprintWorkspace project={project} nodes={nodes} activeSceneId="scene" onOpenScene={vi.fn()} onBack={vi.fn()} notify={vi.fn()}/>)
    const sprintPackage = { format: 'bbd-sprint-v1', protocolVersion: 1, card: { id: 'card' }, events: [], cardHash: 'hash' }
    const file = new File([JSON.stringify(sprintPackage)], 'result.bbd-sprint', { type: 'application/json' }); Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(JSON.stringify(sprintPackage)) })
    await user.upload(await screen.findByLabelText('选择冲刺成果卡'), file)
    await waitFor(() => expect(mocks.inspectSprintCard).toHaveBeenCalledWith(sprintPackage)); expect(screen.getByText('作者甲 · +320 字')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '校验后加入当前看板' })); await waitFor(() => expect(mocks.importSprintCard).toHaveBeenCalledWith('board', sprintPackage))
  })
})

const project: Project = { id: 'project', title: '冲刺小说', description: '', createdAt: '', updatedAt: '', deletedAt: null }
const nodes: ManuscriptNode[] = [{ id: 'scene', projectId: 'project', parentId: 'chapter', type: 'scene', title: '场景 1', sortKey: 1000, status: 'draft', povEntityId: null, storyTime: null, deletedAt: null, wordCount: 12 }]
const activeSession: SprintSession = { id: 'sprint', projectId: 'project', scope: 'scene', sceneId: 'scene', durationMinutes: 25, goalWords: 500, status: 'running', clockStatus: 'ok', startedAt: new Date().toISOString(), plannedEndAt: new Date(Date.now() + 1500000).toISOString(), pausedAt: null, endedAt: null, totalPausedMs: 0, lastReconciledAt: new Date().toISOString(), activeElapsedMs: 0, currentWords: 12, netWords: 0, samples: [], events: [], resultCard: null }
const board: SprintBoard = { id: 'board', projectId: 'project', name: '本周小组', period: 'week', targetWords: 5000, periodStartedAt: new Date(Date.now() - 1000).toISOString(), createdAt: '', updatedAt: '', entries: [], totalNetWords: 0, participants: [] }
