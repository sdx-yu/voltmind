import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResearchWaveStatusResponse, ResearchWaveSummary } from '../../shared/types'
import { ResearchWaveWorkspace } from './ResearchWaveWorkspace'

const mocks = vi.hoisted(() => ({ getResearchWaveStatus: vi.fn(), createResearchWave: vi.fn(), transitionResearchWave: vi.fn(), reportResearchWaveIncident: vi.fn(), resolveResearchWaveIncident: vi.fn(), exportResearchWaveKit: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mocks }))

describe('ResearchWaveWorkspace', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getResearchWaveStatus.mockResolvedValue(emptyStatus); mocks.createResearchWave.mockResolvedValue({}); mocks.transitionResearchWave.mockResolvedValue({}); mocks.reportResearchWaveIncident.mockResolvedValue({}) })
  afterEach(() => cleanup())

  it('defaults to a non-counting rehearsal and requires all four readiness gates', async () => {
    const user = userEvent.setup(); render(<ResearchWaveWorkspace onBack={vi.fn()} notify={vi.fn()}/>)
    expect(await screen.findByLabelText('真实执行 NO-GO')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '波次类型' })).toHaveTextContent('工程演练（不计数）')
    expect(screen.getByText('真实执行未开始')).toBeInTheDocument()
    const create = screen.getByRole('button', { name: '创建波次草稿' }); expect(create).toBeDisabled()
    for (const checkbox of screen.getAllByRole('checkbox')) await user.click(checkbox)
    expect(create).toBeEnabled(); await user.click(create)
    await waitFor(() => expect(mocks.createResearchWave).toHaveBeenCalledWith(expect.objectContaining({ kind: 'engineering_rehearsal', targetParticipants: 1, quotas: { web_serial: 1, revision_novel: 0, ai_assisted: 0, other_target: 0 }, readiness: { protocolReviewed: true, controlledRosterReady: true, deletionContactReady: true, supportRouteRehearsed: true } })))
  })

  it('offers only valid next states and reports incidents with bounded codes', async () => {
    mocks.getResearchWaveStatus.mockResolvedValue(statusWithWave)
    const notify = vi.fn(); const user = userEvent.setup(); render(<ResearchWaveWorkspace onBack={vi.fn()} notify={notify}/>)
    expect(await screen.findByText(wave.displayCode)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '复核中' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '执行中' }))
    await waitFor(() => expect(mocks.transitionResearchWave).toHaveBeenCalledWith(wave.id, 'active'))
    await user.click(screen.getByRole('combobox', { name: `${wave.displayCode}异常码` }))
    await user.click(screen.getByRole('option', { name: '数据丢失' }))
    await user.click(screen.getByRole('combobox', { name: `${wave.displayCode}异常级别` }))
    await user.click(screen.getByRole('option', { name: '严重' }))
    await user.click(screen.getByRole('button', { name: '记录异常' }))
    await waitFor(() => expect(mocks.reportResearchWaveIncident).toHaveBeenCalledWith(wave.id, 'data_loss', 'critical'))
  })
})

const wave: ResearchWaveSummary = { id: '00000000-0000-4000-8000-000000000001', displayCode: 'WAVE-20260827-ABCD', kind: 'engineering_rehearsal', status: 'recruiting', windowStart: '2026-08-27T00:00:00.000Z', windowEnd: '2026-09-10T23:59:59.999Z', targetParticipants: 1, quotas: { web_serial: 1, revision_novel: 0, ai_assisted: 0, other_target: 0 }, readiness: { protocolReviewed: true, controlledRosterReady: true, deletionContactReady: true, supportRouteRehearsed: true }, protocolHash: 'a'.repeat(64), createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z', participantCount: 0, twoWeekQualified: 0, coreLoopQualified: 0, openIncidents: 0, openCriticalIncidents: 0, incidents: [], evidenceClass: 'engineering_only', r1Decision: 'NO-GO' }
const emptyStatus: ResearchWaveStatusResponse = { protocolVersion: 'r1c-wave-v1', appVersion: '1.7.0', waves: [], externalExecution: { waveCount: 0, activeWaveCount: 0, participantCount: 0, twoWeekQualified: 0, status: 'not_started' }, privacy: { storesNamesOrContacts: false, sendsInvitations: false, rehearsalsCountAsExternal: false, automaticR1Go: false } }
const statusWithWave: ResearchWaveStatusResponse = { ...emptyStatus, waves: [wave] }
