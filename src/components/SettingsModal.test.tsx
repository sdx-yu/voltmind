import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from './SettingsModal'

const mocks = vi.hoisted(() => ({
  getAiSettings: vi.fn(),
  saveAiSettings: vi.fn(),
  stats: vi.fn(),
  testAi: vi.fn(),
  getProjectVoiceProfile: vi.fn(),
  saveProjectVoiceDefault: vi.fn(),
  listEntities: vi.fn(),
  listVoicePreferences: vi.fn(),
  clearVoicePreferences: vi.fn(),
  getCharacterVoice: vi.fn(),
  saveCharacterVoice: vi.fn(),
}))
vi.mock('../lib/api', () => ({ api: mocks }))

describe('SettingsModal function truth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAiSettings.mockResolvedValue({ baseUrl: 'mock://local', model: '笔不怠演示模型', hasApiKey: false, credentialStore: 'protected_file', provider: 'demo', costPolicy: 'local_only' })
    mocks.stats.mockResolvedValue({ dailyGoal: 2000, projectGoal: 100000 })
    mocks.testAi.mockResolvedValue({ ok: false, message: '无法连接到模型服务' })
    mocks.saveAiSettings.mockResolvedValue({ baseUrl: 'mock://local', model: '笔不怠演示模型', hasApiKey: false, credentialStore: 'protected_file', provider: 'demo', costPolicy: 'local_only' })
    mocks.getProjectVoiceProfile.mockResolvedValue(voiceProfile())
    mocks.saveProjectVoiceDefault.mockImplementation(async (_projectId: string, patch: Record<string, unknown>) => ({ ...voiceProfile(), ...patch, source: 'project' }))
    mocks.listEntities.mockResolvedValue([{ id: 'lin', projectId: 'p', type: 'character', canonicalName: '林照', aliases: [], summary: '', privacyLevel: 'normal', createdAt: '', updatedAt: '', deletedAt: null }])
    mocks.listVoicePreferences.mockResolvedValue([])
    mocks.clearVoicePreferences.mockResolvedValue({ ok: true })
    mocks.getCharacterVoice.mockResolvedValue({ entityId: 'lin', projectId: 'p', entityName: '林照', register: 'balanced', sentence: 'mixed', directness: 'balanced', emotion: 'balanced', signature: '', avoid: '', updatedAt: null })
    mocks.saveCharacterVoice.mockImplementation(async (_projectId: string, _entityId: string, patch: Record<string, unknown>) => ({ entityId: 'lin', projectId: 'p', entityName: '林照', register: 'balanced', sentence: 'mixed', directness: 'balanced', emotion: 'balanced', signature: '', avoid: '', updatedAt: 'now', ...patch }))
  })
  afterEach(cleanup)

  it('does not enable a local model when the real connection test fails', async () => {
    render(<SettingsModal projectId="p" onClose={vi.fn()} notify={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /本地免费模型/ }))
    await userEvent.click(screen.getByRole('button', { name: '检测并启用' }))
    const result = await screen.findByText('无法连接到模型服务')
    expect(result).toHaveClass('error')
    expect(mocks.saveAiSettings).not.toHaveBeenCalled()
  })

  it('states the zero-cost boundary and does not expose cloud credentials', async () => {
    render(<SettingsModal projectId="p" onClose={vi.fn()} notify={vi.fn()} />)
    expect(await screen.findByText('API 费用：¥0')).toBeInTheDocument()
    expect(screen.getByText(/不接受云端模型地址/)).toBeInTheDocument()
    expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument()
  })

  it('describes local relay according to its actual file-based behavior', async () => {
    render(<SettingsModal projectId="p" initialTab="help" onClose={vi.fn()} notify={vi.fn()} onOpenTool={vi.fn()} />)
    expect(screen.getByRole('button', { name: '打开本地加密接力（实验）' })).toBeInTheDocument()
    expect(screen.getByText(/接力依靠手动交换加密文件/)).toBeInTheDocument()
  })

  it('keeps the book baseline and character voice in the dedicated voice settings', async () => {
    render(<SettingsModal projectId="p" initialTab="voice" onClose={vi.fn()} notify={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: '全书基准文风' })).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: '全书文风说明（最优先）' }), '整本保持克制。')
    await userEvent.tab()
    await waitFor(() => expect(mocks.saveProjectVoiceDefault).toHaveBeenCalledWith('p', expect.objectContaining({ authorNote: '整本保持克制。', intents: [] })))

    await userEvent.click(screen.getByText('人物对白口吻'))
    await userEvent.click(screen.getByRole('combobox', { name: '人物' }))
    await userEvent.click(screen.getByRole('option', { name: '林照' }))
    await userEvent.type(await screen.findByRole('textbox', { name: '说话习惯' }), '回答前先停一下')
    await userEvent.tab()
    await waitFor(() => expect(mocks.saveCharacterVoice).toHaveBeenCalledWith('p', 'lin', { signature: '回答前先停一下' }))
  })
})

function voiceProfile() {
  return {
    nodeId: 'p', projectId: 'p', inherited: true, source: 'default' as const, sourceLabel: '全书尚未设置，使用中性默认',
    family: 'natural' as const, intensity: 'standard' as const, pace: 'balanced' as const, imagery: 'medium' as const,
    distance: 'medium' as const, interiority: 'medium' as const, intents: [], register: 'balanced' as const, sentence: 'mixed' as const,
    dialogue: 'balanced' as const, allusion: 'light' as const, slang: 'avoid' as const, authorNote: '', contract: '全书文风档', updatedAt: null,
  }
}
