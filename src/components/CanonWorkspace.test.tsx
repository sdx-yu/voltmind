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
  })
})

function entity(id: string, canonicalName: string, type: Entity['type'], summary: string): Entity {
  return { id, projectId: 'project', type, canonicalName, aliases: [], summary, privacyLevel: 'normal', createdAt: '', updatedAt: '', deletedAt: null }
}
