import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, TemplateInstallation, TemplatePreview } from '../../shared/types'
import { TemplateWorkspace } from './TemplateWorkspace'

const mocks = vi.hoisted(() => ({ listTemplatePackages: vi.fn(), listTemplateApplications: vi.fn(), listTemplateGrants: vi.fn(), inspectTemplatePackage: vi.fn(), installTemplatePackage: vi.fn(), setTemplatePackageStatus: vi.fn(), setTemplateGrant: vi.fn(), previewTemplate: vi.fn(), applyTemplate: vi.fn(), revertTemplateApplication: vi.fn(), exportTemplatePackage: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mocks }))

describe('TemplateWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.listTemplatePackages.mockResolvedValue([installation]); mocks.listTemplateApplications.mockResolvedValue([]); mocks.listTemplateGrants.mockResolvedValue(grants)
    mocks.previewTemplate.mockResolvedValue(preview); mocks.applyTemplate.mockResolvedValue({ id: 'application', projectId: 'project', installationId: 'package', packageName: '三幕结构起步包', packageVersion: '1.0.0', previewHash: 'p'.repeat(64), createdNodeIds: ['chapter', 'scene'], status: 'applied', appliedAt: '', revertedAt: null })
    mocks.inspectTemplatePackage.mockResolvedValue({ valid: true, duplicate: false, collision: false, manifest: installation.manifest, chapterCount: 1, sceneCount: 1, ruleCount: 1, packageHash: installation.packageHash, warnings: ['作者身份未经认证'] })
    mocks.installTemplatePackage.mockResolvedValue(installation)
  })
  afterEach(() => cleanup())

  it('shows per-project least privilege and permanently unavailable capabilities', async () => {
    const onBack = vi.fn()
    render(<TemplateWorkspace project={project} onBack={onBack} onChanged={vi.fn()} notify={vi.fn()}/>)
    const back = screen.getByRole('button', { name: '返回规划' })
    expect(back).toHaveClass('ui-button-ghost', 'template-header-back')
    await userEvent.click(back)
    expect(onBack).toHaveBeenCalledOnce()
    expect(await screen.findByText('当前项目授权')).toBeInTheDocument()
    expect(screen.getByText(/正文读取 · 网络访问 · 密钥与恢复短语/)).toBeInTheDocument()
    expect(screen.getByText('发布者身份未经认证；包已通过本地结构与 SHA-256 完整性校验，但不是数字签名。')).toBeInTheDocument()
  })

  it('preflights a real local file before installing it', async () => {
    const user = userEvent.setup(); render(<TemplateWorkspace project={project} onBack={vi.fn()} onChanged={vi.fn()} notify={vi.fn()}/>)
    const file = new File([JSON.stringify(installation.package)], 'structure.bbd-template.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(JSON.stringify(installation.package)) })
    await user.upload(await screen.findByLabelText('选择结构模板包'), file)
    await waitFor(() => expect(mocks.inspectTemplatePackage).toHaveBeenCalledWith(installation.package))
    expect(screen.getByText(/完整性校验通过/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '安装到本地目录' }))
    await waitFor(() => expect(mocks.installTemplatePackage).toHaveBeenCalledWith(installation.package))
  })

  it('applies only the current preview and refreshes the manuscript tree', async () => {
    const user = userEvent.setup(); const onChanged = vi.fn().mockResolvedValue(undefined)
    render(<TemplateWorkspace project={project} onBack={vi.fn()} onChanged={onChanged} notify={vi.fn()}/>)
    await user.click(await screen.findByRole('button', { name: '生成预览' }))
    expect((await screen.findAllByText('＋')).length).toBe(2); expect(screen.getAllByText(/空白正文/).length).toBe(2)
    await user.click(screen.getByRole('button', { name: '确认并单事务创建' }))
    await waitFor(() => expect(mocks.applyTemplate).toHaveBeenCalledWith('project', 'package', 'p'.repeat(64), 'cancel'))
    expect(onChanged).toHaveBeenCalled()
  })
})

const project: Project = { id: 'project', title: '模板小说', description: '本地项目', createdAt: '', updatedAt: '', deletedAt: null }
const structure = { nodes: [{ localId: 'chapter', parentLocalId: null, type: 'chapter' as const, title: '第一幕', description: '建立', status: 'planned' as const }, { localId: 'scene', parentLocalId: 'chapter', type: 'scene' as const, title: '诱发事件', description: '失衡', status: 'idea' as const }], rules: [{ id: 'minimum', kind: 'minimum_scene_count' as const, title: '至少一场', config: { min: 1 } }] }
const installation: TemplateInstallation = { id: 'package', manifest: { packageId: 'example.structure', name: '三幕结构起步包', version: '1.0.0', description: '本地结构示例', authorLabel: '本地作者（自述）', license: 'CC0-1.0', sourceUrl: '', capabilities: ['project.summary.read', 'plan.nodes.create', 'local.rules.run'], structureHash: 's'.repeat(64) }, package: { format: 'bbd-template-v1', protocolVersion: 1, manifest: {} as never, structure, packageHash: 'h'.repeat(64) }, packageHash: 'h'.repeat(64), status: 'enabled', builtIn: true, installedAt: '', updatedAt: '' }
installation.package.manifest = installation.manifest
const grants = installation.manifest.capabilities.map((capability) => ({ projectId: 'project', installationId: 'package', capability, granted: true, updatedAt: '' }))
const preview: TemplatePreview = { projectId: 'project', installationId: 'package', packageHash: 'h'.repeat(64), previewHash: 'p'.repeat(64), projectSummary: { title: '模板小说', description: '本地项目', chapterCount: 1, sceneCount: 1 }, nodes: structure.nodes.map((node) => ({ ...node, parentTitle: node.parentLocalId ? '第一幕' : '书稿根目录', conflict: 'none' as const })), conflicts: [], ruleResults: [{ ruleId: 'minimum', title: '至少一场', passed: true, message: '通过' }], requiredCapabilities: installation.manifest.capabilities, missingCapabilities: [] }
