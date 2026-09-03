import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entity } from '../../shared/types'
import { CanonWorkspace } from './CanonWorkspace'

const mocks = vi.hoisted(() => ({
  listCandidates: vi.fn(),
  listStates: vi.fn(),
  listEntityMentions: vi.fn(),
  listProfileFields: vi.fn(),
  listRelationships: vi.fn(),
}))
vi.mock('../lib/api', () => ({ api: mocks }))

const entities: Entity[] = [
  entity('lin', '林照', 'character', '雾港调查员'),
  entity('harbor', '雾港', 'location', '终年有雾的港城'),
]

describe('CanonWorkspace library template', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listCandidates.mockResolvedValue([])
    mocks.listStates.mockResolvedValue([])
    mocks.listEntityMentions.mockResolvedValue([])
    mocks.listProfileFields.mockResolvedValue([])
    mocks.listRelationships.mockResolvedValue([])
  })
  afterEach(cleanup)

  it('keeps search, filtering and detail selection in one library structure', async () => {
    const { container } = render(<CanonWorkspace projectId="project" entities={entities} nodes={[]} refresh={vi.fn()} onSelectScene={vi.fn()} notify={vi.fn()} />)
    expect(container.firstElementChild).toHaveAttribute('data-ui-template', 'library')
    expect(screen.getByRole('complementary', { name: '正典导航' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '林照' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: '地点' }))
    expect(screen.queryByRole('button', { name: /林照/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /雾港/ }))
    await waitFor(() => expect(screen.getByRole('heading', { name: '雾港' })).toBeInTheDocument())

    await userEvent.type(screen.getByRole('searchbox', { name: '搜索正典' }), '不存在')
    expect(screen.getByRole('status')).toHaveTextContent('没有匹配的正典项')
    await userEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    expect(screen.getByRole('button', { name: /雾港/ })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '正典扩展功能' })).toBeInTheDocument()
  })

  it('provides an equivalent relationship list and keyboard-focusable graph projection', async () => {
    mocks.listRelationships.mockResolvedValue([{ id: 'rel', projectId: 'project', sourceEntityId: 'lin', targetEntityId: 'harbor', relationType: 'alliance', direction: 'directed', label: '守护', summary: '守护这座城市', privacyLevel: 'normal', createdAt: '', updatedAt: '', deletedAt: null, states: [], currentState: { id: 'state', relationshipId: 'rel', statusLabel: '仍在守护', note: '', validFromNodeId: null, validToNodeId: null, worldTimeFrom: null, worldTimeTo: null, sourceNodeId: null, evidence: '', createdAt: '' } }])
    render(<CanonWorkspace projectId="project" entities={entities} nodes={[]} refresh={vi.fn()} onSelectScene={vi.fn()} notify={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: '关系' }))
    expect(await screen.findByText('仍在守护')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: '关联图' }))
    const graphNode = await screen.findByRole('button', { name: /查看雾港的关系：仍在守护/ })
    expect(graphNode).toBeInTheDocument()
    graphNode.focus()
    expect(graphNode).toHaveFocus()
    expect(screen.getByRole('complementary', { name: '雾港关系详情' })).toHaveTextContent('守护这座城市')
    expect(screen.getByRole('button', { name: '打开档案' })).toBeInTheDocument()
    expect(screen.getByText('1 个相邻项')).toBeInTheDocument()
  })
})

function entity(id: string, canonicalName: string, type: Entity['type'], summary: string): Entity {
  return { id, projectId: 'project', type, canonicalName, aliases: [], summary, privacyLevel: 'normal', createdAt: '', updatedAt: '', deletedAt: null }
}
