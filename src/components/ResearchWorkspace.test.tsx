import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, ResearchStatus } from '../../shared/types'
import { ResearchWorkspace } from './ResearchWorkspace'

const mocks = vi.hoisted(() => ({ getResearchStatus: vi.fn(), getReleaseReadiness: vi.fn(), enrollResearch: vi.fn(), startResearchTask: vi.fn(), completeResearchTask: vi.fn(), withdrawResearch: vi.fn(), exportResearch: vi.fn(), getSupportBundle: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mocks }))

describe('ResearchWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.getResearchStatus.mockResolvedValue(emptyStatus); mocks.getReleaseReadiness.mockResolvedValue(readiness); mocks.enrollResearch.mockResolvedValue(enrolledStatus); mocks.startResearchTask.mockResolvedValue(activeTask)
  })
  afterEach(() => cleanup())

  it('requires every explicit consent confirmation and states the no-upload boundary', async () => {
    const user = userEvent.setup(); render(<ResearchWorkspace projects={[project]} onBack={vi.fn()} onOpenCohort={vi.fn()} notify={vi.fn()}/>)
    expect(await screen.findByRole('heading', { name: '知情同意' })).toBeInTheDocument()
    expect(screen.getByText(/只有我主动导出研究包时数据才会离开本机/)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: '同意并生成匿名参与码' })
    expect(submit).toBeDisabled()
    for (const checkbox of screen.getAllByRole('checkbox')) await user.click(checkbox)
    expect(submit).toBeEnabled(); await user.click(submit)
    expect(mocks.enrollResearch).toHaveBeenCalledWith({ adultOrAuthorized: true, manuscriptRights: true, localOnlyUnderstood: true, voluntary: true })
  })

  it('shows public NO-GO and starts a task without sending a project title', async () => {
    mocks.getResearchStatus.mockResolvedValue(enrolledStatus)
    const user = userEvent.setup(); render(<ResearchWorkspace projects={[project]} onBack={vi.fn()} onOpenCohort={vi.fn()} notify={vi.fn()}/>)
    expect(await screen.findByLabelText('公开发布 NO-GO')).toBeInTheDocument()
    expect(screen.getByText('匿名参与码；不是账号或认证身份')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('验证任务'), 'fact_lookup')
    await user.click(screen.getByRole('button', { name: '开始计时' }))
    expect(mocks.startResearchTask).toHaveBeenCalledWith('project', 'fact_lookup')
    expect(JSON.stringify(mocks.startResearchTask.mock.calls[0])).not.toContain(project.title)
  })

  it('finishes an active task using only bounded metrics and issue codes', async () => {
    mocks.getResearchStatus.mockResolvedValue({ ...enrolledStatus, tasks: [activeTask] })
    mocks.completeResearchTask.mockResolvedValue({ ...activeTask, status: 'completed' })
    const user = userEvent.setup(); render(<ResearchWorkspace projects={[project]} onBack={vi.fn()} onOpenCohort={vi.fn()} notify={vi.fn()}/>)
    await screen.findByText('正在验证')
    await user.clear(screen.getByLabelText('操作难度')); await user.type(screen.getByLabelText('操作难度'), '2')
    await user.clear(screen.getByLabelText('预估节省分钟')); await user.type(screen.getByLabelText('预估节省分钟'), '15')
    await user.click(screen.getByText('出现误报'))
    await user.click(screen.getByRole('button', { name: '完成并记录' }))
    await waitFor(() => expect(mocks.completeResearchTask).toHaveBeenCalledWith('task', { outcome: 'completed', goalAchieved: true, difficulty: 2, minutesSaved: 15, issueCodes: ['false_positive'] }))
  })
})

const project: Project = { id: 'project', title: '绝不能发送的书名', description: '', createdAt: '', updatedAt: '', deletedAt: null }
const consent = { version: 'r1-consent-v1' as const, text: '只有我主动导出研究包时数据才会离开本机。', textHash: 'a'.repeat(64) }
const privacy = { localOnlyUntilExplicitExport: true as const, excludesManuscriptText: true as const, excludesProjectIdentity: true as const, exportDoesNotCompleteR1Gate: true as const }
const progress = { completedTasks: 0, completedCoreLoops: 0, observedWeekBuckets: 0, reportedMinutesSaved: 0, dataLossReports: 0, lastActivityAt: null }
const enrollment = { id: 'enrollment', participantCode: 'R1-ABCDEF123456', consentVersion: 'r1-consent-v1' as const, consentTextHash: 'a'.repeat(64), consentReceiptHash: 'b'.repeat(64), consentedAt: '2026-08-27T00:00:00.000Z', createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z' }
const emptyStatus: ResearchStatus = { consent, enrollment: null, tasks: [], progress, privacy }
const enrolledStatus: ResearchStatus = { ...emptyStatus, enrollment }
const activeTask = { id: 'task', taskType: 'fact_lookup' as const, projectScopeHash: 'c'.repeat(64), status: 'active' as const, startedAt: '2026-08-27T00:00:00.000Z', completedAt: null, durationSeconds: null, goalAchieved: null, difficulty: null, minutesSaved: null, issueCodes: [] }
const readiness = { appVersion: '1.7.0', publicRelease: 'NO-GO' as const, engineering: [{ gate: '数据库完整性', status: 'pass' as const, evidence: 'ok' }], external: [{ gate: '真实作者验证', status: 'required' as const, evidence: '至少 5 名完成两周' }] }
