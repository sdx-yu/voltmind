import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VOICE_KNOBS } from '../../shared/voice'
import { SeriesWorkspace } from './SeriesWorkspace'

const mocks = vi.hoisted(() => ({
  getProjectSeries: vi.fn(), listSeries: vi.fn(), listProjects: vi.fn(), listSeriesCanon: vi.fn(), listStyleSamples: vi.fn(),
  analyzeStyleSamples: vi.fn(), confirmStyleAnalysis: vi.fn(),
}))
vi.mock('../lib/api', () => ({ api: mocks }))

describe('SeriesWorkspace style distillation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const series = { id: 'series', name: '雾港纪事', description: '', createdAt: '', updatedAt: '', deletedAt: null, members: [{ projectId: 'p', title: '雾港', addedAt: '' }] }
    mocks.getProjectSeries.mockResolvedValue(series); mocks.listSeries.mockResolvedValue([series]); mocks.listProjects.mockResolvedValue([]); mocks.listSeriesCanon.mockResolvedValue([])
    mocks.listStyleSamples.mockResolvedValue([
      { id: 'sample-1', scope: 'project', projectId: 'p', seriesId: null, title: '克制短句', content: '雨停了。他没有回头。', guidance: '参考停顿', privacyLevel: 'author_only', enabled: true, effectiveEnabled: true, createdAt: '', updatedAt: '', deletedAt: null },
    ])
    mocks.analyzeStyleSamples.mockResolvedValue({ id: 'analysis-1', projectId: 'p', sampleIds: ['sample-1'], metrics: { characters: 10, sentences: 2, paragraphs: 1, averageSentenceLength: 5, averageParagraphLength: 10, dialogueRatio: 0, shortSentenceRatio: 1, classicalMarkerRatio: 0, sensoryMarkerCount: 1 }, suggested: { ...DEFAULT_VOICE_KNOBS, family: 'restrained', sentence: 'short' }, evidence: ['平均句长 5 字，短句占比高'], warnings: ['样本较短，建议再加入一篇'], confirmedAt: null, createdAt: '' })
    mocks.confirmStyleAnalysis.mockImplementation(async () => ({ confirmedAt: 'now' }))
  })
  afterEach(cleanup)

  it('requires explicit sample selection and confirmation before changing the book default', async () => {
    const notify = vi.fn()
    render(<SeriesWorkspace projectId="p" notify={notify}/>)
    await userEvent.click(await screen.findByRole('button', { name: '风格样本' }))
    expect(screen.getByRole('button', { name: /分析所选/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: '选择样本 克制短句' }))
    await userEvent.click(screen.getByRole('button', { name: '分析所选 1' }))
    expect(await screen.findByRole('dialog', { name: '确认样本文风档' })).toBeInTheDocument()
    expect(screen.getByText(/冷峻克制/)).toBeInTheDocument()
    expect(mocks.confirmStyleAnalysis).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '确认并设为本书默认' }))
    await waitFor(() => expect(mocks.confirmStyleAnalysis).toHaveBeenCalledWith('p', 'analysis-1'))
    expect(notify).toHaveBeenCalledWith('success', '已把分析结果设为本书默认文风档')
  })
})
