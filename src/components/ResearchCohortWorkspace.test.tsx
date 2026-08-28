import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResearchCohortStatus } from '../../shared/types'
import { ResearchCohortWorkspace } from './ResearchCohortWorkspace'

const mocks = vi.hoisted(() => ({ getResearchCohortStatus: vi.fn(), getResearchWaveStatus: vi.fn(), inspectResearch: vi.fn(), importResearchCohortPackage: vi.fn(), deleteResearchCohortParticipant: vi.fn(), purgeExpiredResearchCohort: vi.fn(), exportResearchCohort: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mocks }))

describe('ResearchCohortWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.getResearchCohortStatus.mockResolvedValue(emptyStatus); mocks.getResearchWaveStatus.mockResolvedValue({ waves: [] }); mocks.inspectResearch.mockResolvedValue(inspection); mocks.importResearchCohortPackage.mockResolvedValue({ disposition: 'imported', participant: {}, aggregate: emptyStatus.aggregate })
  })
  afterEach(() => cleanup())

  it('keeps the release decision NO-GO and visibly separates fixtures from real evidence', async () => {
    render(<ResearchCohortWorkspace onBack={vi.fn()} onOpenWaves={vi.fn()} notify={vi.fn()}/>)
    expect(await screen.findByLabelText('发布决策 NO-GO')).toBeInTheDocument()
    expect(screen.getByText('把真实样本与工程夹具彻底分开')).toBeInTheDocument()
    expect(screen.getByText(/工程夹具只验证研究台，永不进入/)).toBeInTheDocument()
    expect(screen.getByText('试点数值门尚未达到')).toBeInTheDocument()
  })

  it('preflights a package and requires every external attestation before import', async () => {
    const user = userEvent.setup(); render(<ResearchCohortWorkspace onBack={vi.fn()} onOpenWaves={vi.fn()} notify={vi.fn()}/>)
    const file = new File(['{}'], 'author.bbd-research', { type: 'application/json' }); Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(JSON.stringify(researchPackage)) })
    await user.upload(await screen.findByLabelText('选择研究包'), file)
    expect(await screen.findByText('author.bbd-research')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: '证据类型' }))
    await user.click(screen.getByRole('option', { name: '人工核对的真实外部样本' }))
    const submit = screen.getByRole('button', { name: '确认导入本机研究台' }); expect(submit).toBeDisabled()
    for (const checkbox of screen.getAllByRole('checkbox')) await user.click(checkbox)
    expect(submit).toBeEnabled(); await user.click(submit)
    await waitFor(() => expect(mocks.importResearchCohortPackage).toHaveBeenCalledWith(researchPackage, expect.objectContaining({ evidenceClass: 'external_attested', segment: 'web_serial', attestation: { targetAuthorConfirmed: true, independentParticipantConfirmed: true, manuscriptRightsConfirmed: true, realUseConfirmed: true } })))
  })
})

const zeroGate = (required: number) => ({ current: 0, required, met: required === 0 })
const emptyStatus: ResearchCohortStatus = {
  protocolVersion: 'r1b-cohort-v1', appVersion: '1.7.0', participants: [], deletionReceipts: 0,
  privacy: { storesRawResearchPackages: false, storesParticipantCodes: false, containsManuscriptText: false, fixturesCountTowardGates: false, automaticR1Go: false },
  aggregate: { externalAttestedParticipants: 0, engineeringFixtures: 0, expiredParticipants: 0, twoWeekQualified: 0, fourWeekQualified: 0, coreLoopQualified: 0, completedTasks: 0, completedCoreLoops: 0, reportedMinutesSaved: 0, dataLossReports: 0, falsePositiveReports: 0, missedFactReports: 0, taskCompletionRate: 0, segments: { web_serial: 0, revision_novel: 0, ai_assisted: 0, other_target: 0 }, gates: { twoWeek: zeroGate(5) as { current: number; required: 5; met: boolean }, fourWeek: zeroGate(3) as { current: number; required: 3; met: boolean }, coreLoop: zeroGate(3) as { current: number; required: 3; met: boolean }, zeroDataLoss: zeroGate(0) as { current: number; required: 0; met: boolean }, pilotThresholdMet: false, humanReviewRequired: true, r1Decision: 'NO-GO' } },
}
const inspection = { ok: true, manifestHashValid: true, eventChainValid: true, semanticValid: true, participantCode: 'R1-ABCDEF123456', completedTasks: 2, message: 'ok' }
const researchPackage = { format: 'bbd-research-v1', manifest: { participantCode: 'R1-ABCDEF123456' }, manifestHash: 'a'.repeat(64) }
