import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from './SettingsModal'

const mocks = vi.hoisted(() => ({
  getAiSettings: vi.fn(),
  stats: vi.fn(),
  testAi: vi.fn(),
}))
vi.mock('../lib/api', () => ({ api: mocks }))

describe('SettingsModal function truth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAiSettings.mockResolvedValue({ baseUrl: 'https://invalid.example/v1', model: 'model-x', hasApiKey: false, credentialStore: 'protected_file' })
    mocks.stats.mockResolvedValue({ dailyGoal: 2000, projectGoal: 100000 })
    mocks.testAi.mockResolvedValue({ ok: false, message: '无法连接到模型服务' })
  })
  afterEach(cleanup)

  it('renders failed connection tests as errors instead of success', async () => {
    render(<SettingsModal projectId="p" onClose={vi.fn()} notify={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '测试连接' }))
    const result = await screen.findByText('无法连接到模型服务')
    expect(result).toHaveClass('error')
  })

  it('describes local relay according to its actual file-based behavior', async () => {
    render(<SettingsModal projectId="p" initialTab="help" onClose={vi.fn()} notify={vi.fn()} onOpenTool={vi.fn()} />)
    expect(screen.getByRole('button', { name: '打开本地加密接力（实验）' })).toBeInTheDocument()
    expect(screen.getByText(/接力依靠手动交换加密文件/)).toBeInTheDocument()
  })
})
