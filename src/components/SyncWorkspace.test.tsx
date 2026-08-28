import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, SyncProjectStatus } from '../../shared/types'
import { SyncWorkspace } from './SyncWorkspace'

const mocks = vi.hoisted(() => ({ getSyncStatus: vi.fn(), listSyncConflicts: vi.fn(), initializeSync: vi.fn(), runSyncDrill: vi.fn(), exportSyncPackage: vi.fn(), inspectSyncPackage: vi.fn(), importSyncPackage: vi.fn(), resolveSyncConflict: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mocks }))

describe('SyncWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.getSyncStatus.mockResolvedValue(uninitialized); mocks.listSyncConflicts.mockResolvedValue([])
    mocks.initializeSync.mockResolvedValue({ status: initialized, recoveryPhrase: phrase })
  })
  afterEach(cleanup)

  it('labels the feature as local file relay and shows the recovery phrase only after initialization', async () => {
    const user = userEvent.setup(); render(<SyncWorkspace project={project} onSynced={vi.fn()} notify={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: '加密接力，不托管你的故事' })).toBeInTheDocument()
    expect(screen.getByText(/本地文件 · 暂无云服务/)).toBeInTheDocument()
    expect(screen.queryByText(phrase)).not.toBeInTheDocument()
    await user.clear(screen.getByRole('textbox', { name: '设备名称' })); await user.type(screen.getByRole('textbox', { name: '设备名称' }), '书房电脑')
    await user.click(screen.getByRole('button', { name: '建立同步身份' }))
    await waitFor(() => expect(mocks.initializeSync).toHaveBeenCalledWith('p', '书房电脑'))
    expect(await screen.findByRole('dialog')).toHaveTextContent('仅显示这一次：恢复短语')
    expect(screen.getByText(phrase)).toBeInTheDocument()
    expect(screen.getByText(/丢失恢复短语将无法解密/)).toBeInTheDocument()
  })
})

const project: Project = { id: 'p', title: '接力之书', description: '', createdAt: '', updatedAt: '', deletedAt: null }
const phrase = '1111-2222-3333-4444-5555-6666-7777-8888-9999-aaaa-bbbb-cccc'
const uninitialized: SyncProjectStatus = { initialized: false, protocolVersion: 'bbd-sync-v1', deviceId: null, deviceName: '', sequence: 0, vector: {}, pendingPackages: 0, unresolvedConflicts: 0, lastExportedAt: null, lastImportedAt: null, engineeringOnly: true }
const initialized: SyncProjectStatus = { ...uninitialized, initialized: true, deviceId: 'device-a', deviceName: '书房电脑' }
