import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManuscriptNode, StoryPlan } from '../../shared/types'
import { StoryBlueprintWorkspace } from './StoryBlueprintWorkspace'

const mocks = vi.hoisted(() => ({ getStoryPlan: vi.fn(), installStoryStarter: vi.fn(), updateStoryBlueprint: vi.fn(), createStoryBeat: vi.fn(), updateStoryBeat: vi.fn(), trashStoryBeat: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mocks }))

const scene: ManuscriptNode = { id: 'scene-1', projectId: 'project', parentId: 'chapter', type: 'scene', title: '雨夜归港', sortKey: 1000, status: 'draft', povEntityId: null, storyTime: null, deletedAt: null, wordCount: 0 }

describe('StoryBlueprintWorkspace', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getStoryPlan.mockResolvedValue(plan()); mocks.updateStoryBlueprint.mockResolvedValue(plan().blueprint) })
  afterEach(cleanup)

  it('shows destination, guardrails and scene-linked beats as author-owned constraints', async () => {
    render(<StoryBlueprintWorkspace projectId="project" scenes={[scene]} notify={vi.fn()} />)
    expect(await screen.findByText('失踪的领航员必须带仇人穿过风暴。')).toBeInTheDocument()
    expect(screen.getByText('灯塔必须在高潮前保持熄灭')).toBeInTheDocument()
    expect(screen.getByText('雨夜归港')).toBeInTheDocument()
    expect(screen.getByText('67%')).toBeInTheDocument()
  })

  it('edits the story blueprint and keeps the explicit author fields', async () => {
    render(<StoryBlueprintWorkspace projectId="project" scenes={[scene]} notify={vi.fn()} />)
    await screen.findByText('故事航向')
    await userEvent.click(screen.getByRole('button', { name: '编辑蓝图' }))
    const stakes = screen.getByRole('textbox', { name: /失败代价/ })
    await userEvent.type(stakes, '港口会被风暴吞没')
    await userEvent.click(screen.getByRole('button', { name: '保存故事蓝图' }))
    await waitFor(() => expect(mocks.updateStoryBlueprint).toHaveBeenCalledWith('project', expect.objectContaining({ stakes: '港口会被风暴吞没' })))
  })
})

function plan(): StoryPlan {
  return {
    blueprint: { projectId: 'project', approach: 'guided', genre: '航海悬疑', premise: '失踪的领航员必须带仇人穿过风暴。', coreConflict: '回家与复仇互相冲突', protagonistGoal: '抵达旧港', protagonistNeed: '', stakes: '', thematicQuestion: '', climaxChoice: '', endingTruth: '', endingState: '灯塔重新亮起。', mustKeep: ['灯塔必须在高潮前保持熄灭'], mustAvoid: [], targetWords: 120000, createdAt: '', updatedAt: '' },
    beats: [{ id: 'beat-1', projectId: 'project', act: 'opening', title: '开场承诺', purpose: '让领航员回到旧港', expectedChange: '主角无法继续逃避', caution: '', sortKey: 1000, status: 'drafting', sceneIds: ['scene-1'], createdAt: '', updatedAt: '', deletedAt: null }],
  }
}
