import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from './SettingsModal'

const mocks = vi.hoisted(() => ({
  getAiSettings: vi.fn(),
  saveAiSettings: vi.fn(),
  stats: vi.fn(),
  testAi: vi.fn(),
}))
vi.mock('../lib/api', () => ({ api: mocks }))

describe('SettingsModal function truth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAiSettings.mockResolvedValue({ baseUrl: 'mock://local', model: '笔不怠演示模型', hasApiKey: false, credentialStore: 'protected_file', provider: 'demo', costPolicy: 'local_only' })
    mocks.stats.mockResolvedValue({ dailyGoal: 2000, projectGoal: 100000 })
    mocks.testAi.mockResolvedValue({ ok: false, message: '无法连接到模型服务' })
    mocks.saveAiSettings.mockResolvedValue({ baseUrl: 'mock://local', model: '笔不怠演示模型', hasApiKey: false, credentialStore: 'protected_file', provider: 'demo', costPolicy: 'local_only' })
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
})
