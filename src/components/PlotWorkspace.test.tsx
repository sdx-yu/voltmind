import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Foreshadow, ManuscriptNode } from '../../shared/types'
import { PlotWorkspace } from './PlotWorkspace'

const mocks = vi.hoisted(() => ({ listForeshadows: vi.fn(), createForeshadow: vi.fn(), transitionForeshadow: vi.fn(), trashForeshadow: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mocks }))

const nodes: ManuscriptNode[] = [
  node('book', 'book', null, 1000), node('chapter', '第一章', 'book', 1000),
  { ...node('late', '现在', 'chapter', 1000), storyTime: '2026-08-03T09:00' },
  { ...node('early', '三日前', 'chapter', 2000), storyTime: '2026-07-31T09:00' },
]

describe('PlotWorkspace', () => {
  afterEach(cleanup)
  beforeEach(() => { vi.clearAllMocks(); mocks.listForeshadows.mockResolvedValue([]); mocks.createForeshadow.mockResolvedValue(clue()) })

  it('compares narrative order with story-time order without changing scenes', async () => {
    render(<PlotWorkspace projectId="project" nodes={nodes} entities={[]} onSelectScene={vi.fn()} notify={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: '故事时间' }))
    const lane = screen.getByText('按实际发生先后').closest('.timeline-lane')!
    expect(lane.textContent?.indexOf('三日前')).toBeLessThan(lane.textContent?.indexOf('现在') ?? 0)
    expect(screen.getByText('2/2 场已定时')).toBeInTheDocument()
  })

  it('creates a foreshadow with scene evidence through the visible workflow', async () => {
    render(<PlotWorkspace projectId="project" nodes={nodes} entities={[]} onSelectScene={vi.fn()} notify={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: '伏笔看板' }))
    await userEvent.click(screen.getByRole('button', { name: '建立伏笔' }))
    await userEvent.type(screen.getByLabelText('伏笔名称'), '停摆的怀表')
    await userEvent.click(screen.getByRole('combobox', { name: '建立场景' }))
    await userEvent.click(screen.getByRole('option', { name: '现在' }))
    await userEvent.type(screen.getByLabelText('正文证据'), '指针停在子夜')
    await userEvent.click(screen.getByRole('button', { name: '建立并留痕' }))
    await waitFor(() => expect(mocks.createForeshadow).toHaveBeenCalledWith('project', expect.objectContaining({ title: '停摆的怀表', nodeId: 'late', evidence: '指针停在子夜' })))
  })
})

function node(id: string, title: string, parentId: string | null, sortKey: number): ManuscriptNode { return { id, projectId: 'project', parentId, type: id === 'book' ? 'book' : id === 'chapter' ? 'chapter' : 'scene', title, sortKey, status: 'draft', povEntityId: null, storyTime: null, deletedAt: null, wordCount: 0 } }
function clue(): Foreshadow { return { id: 'clue', projectId: 'project', title: '停摆的怀表', summary: '', status: 'planted', importance: 'medium', plannedPayoff: '', createdAt: '', updatedAt: '', deletedAt: null, events: [] } }
