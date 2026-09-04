import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, ProjectTrashSummary } from '../../shared/types'
import { Bookshelf } from './Bookshelf'

const mocks = vi.hoisted(() => ({ createProject: vi.fn(), updateProject: vi.fn(), listProjectTrash: vi.fn(), restoreProject: vi.fn(), restoreProjects: vi.fn(), trashProject: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mocks }))

const project: Project = { id: 'p', title: '雾港', description: '海雾里的旧案', createdAt: '', updatedAt: '2026-08-28T00:00:00.000Z', deletedAt: null }

describe('Bookshelf shell', () => {
  beforeEach(() => {
    mocks.listProjectTrash.mockResolvedValue([])
    mocks.restoreProject.mockResolvedValue(project)
    mocks.restoreProjects.mockResolvedValue([])
    mocks.trashProject.mockResolvedValue({ ...project, deletedAt: '2026-09-03T10:00:00.000Z' })
    mocks.createProject.mockResolvedValue(project)
  })
  afterEach(() => { cleanup(); vi.clearAllMocks() })

  it('keeps only the three core actions and a more menu visible', () => {
    renderBookshelf()
    expect(screen.getByRole('button', { name: '搜索书架和功能' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入旧稿' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新故事' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '书架更多操作' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'R1 真实验证' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开审阅任务' })).not.toBeInTheDocument()
  })

  it('presents the bookshelf as a compact work list with truthful metadata', () => {
    const untitledDescription = { ...project, id: 'empty-description', title: '潮声', description: '' }
    renderBookshelf(vi.fn(), vi.fn(), vi.fn().mockResolvedValue(undefined), [project, untitledDescription])

    expect(screen.getByRole('heading', { name: '继续写下去' })).toBeInTheDocument()
    expect(screen.getByText('2 部作品')).toBeInTheDocument()
    expect(screen.getByText('尚未填写作品简介')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo', { name: '创作数据保障' })).toHaveTextContent('稿件默认保存在本机自动留痕AI 不越权')
  })

  it('offers blank and structure-first creation paths', async () => {
    renderBookshelf()
    await userEvent.click(screen.getByRole('button', { name: '新故事' }))
    expect(screen.getByRole('radio', { name: /直接开写/ })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('radio', { name: /从结构起步/ }))
    expect(screen.getByRole('radio', { name: /从结构起步/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: '创建并选择结构' })).toBeInTheDocument()
  })

  it('creates a guided story with a separate blueprint and opens planning first', async () => {
    const onOpen = vi.fn(); const onRefresh = vi.fn().mockResolvedValue(undefined)
    renderBookshelf(onOpen, vi.fn(), onRefresh)
    await userEvent.click(screen.getByRole('button', { name: '新故事' }))
    await userEvent.click(screen.getByRole('radio', { name: /先定故事方向/ }))
    await userEvent.type(screen.getByRole('textbox', { name: /书名/ }), '归航')
    await userEvent.type(screen.getByRole('textbox', { name: /类型/ }), '航海悬疑')
    await userEvent.type(screen.getByRole('textbox', { name: /故事前提/ }), '领航员必须穿过风暴。')
    await userEvent.click(screen.getByRole('button', { name: '创建并规划故事' }))
    await waitFor(() => expect(mocks.createProject).toHaveBeenCalledWith('归航', '领航员必须穿过风暴。', { blueprint: expect.objectContaining({ approach: 'guided', genre: '航海悬疑' }), starter: 'three_act' }))
    expect(onOpen).toHaveBeenCalledWith(project, 'plot')
  })

  it('opens projects from the Mod+K command palette', async () => {
    const onOpen = vi.fn()
    renderBookshelf(onOpen)
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('dialog', { name: '书架命令' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: /雾港/ }))
    expect(onOpen).toHaveBeenCalledWith(project)
  })

  it('routes native commands and explains project-only actions', async () => {
    const notify = vi.fn()
    renderBookshelf(vi.fn(), notify)
    act(() => window.dispatchEvent(new CustomEvent('bbd:command', { detail: 'command-palette' })))
    expect(await screen.findByRole('dialog', { name: '书架命令' })).toBeInTheDocument()
    act(() => window.dispatchEvent(new CustomEvent('bbd:command', { detail: 'view-write' })))
    expect(notify).toHaveBeenCalledWith('error', '这个命令需要先打开一个项目')
  })

  it('edits the novel title and description from the project card menu', async () => {
    const updated = { ...project, title: '雾港来信', description: '一封迟到十年的信' }
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    mocks.updateProject.mockResolvedValue(updated)
    renderBookshelf(vi.fn(), vi.fn(), onRefresh)

    await userEvent.click(screen.getByRole('button', { name: '雾港更多操作' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '编辑作品信息' }))
    const title = screen.getByRole('textbox', { name: /书名/ })
    const description = screen.getByRole('textbox', { name: /作品简介/ })
    await waitFor(() => expect(title).toHaveFocus())
    await userEvent.clear(title); await userEvent.type(title, '雾港来信')
    await userEvent.clear(description); await userEvent.type(description, '一封迟到十年的信')
    await userEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => expect(mocks.updateProject).toHaveBeenCalledWith('p', { title: '雾港来信', description: '一封迟到十年的信' }))
    expect(onRefresh).toHaveBeenCalled()
  })

  it('opens an informative project trash center and filters duplicate-looking work', async () => {
    const trash = [trashedProject('deleted-a', '雾港', '旧案第一稿', '2026-09-03T10:00:00.000Z'), trashedProject('deleted-b', '雾港', '', '2026-09-02T10:00:00.000Z')]
    mocks.listProjectTrash.mockResolvedValue(trash)
    renderBookshelf()

    await userEvent.click(screen.getByRole('button', { name: '书架更多操作' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '作品回收站' }))
    const dialog = await screen.findByRole('dialog', { name: '作品回收站' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('2 部作品')).toBeInTheDocument()
    expect(screen.getAllByText('2 章')).toHaveLength(2)
    expect(within(dialog).getAllByText('雾港')).toHaveLength(2)

    await userEvent.type(screen.getByRole('searchbox', { name: '搜索作品' }), '第一稿')
    expect(screen.getByText('旧案第一稿')).toBeInTheDocument()
    expect(screen.queryByText('未填写作品简介')).not.toBeInTheDocument()
  })

  it('restores selected trash items as one operation and keeps the list truthful', async () => {
    const trash = [trashedProject('deleted-a', '雾港'), trashedProject('deleted-b', '旧城')]
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    mocks.listProjectTrash.mockResolvedValue(trash)
    mocks.restoreProjects.mockResolvedValue(trash)
    renderBookshelf(vi.fn(), vi.fn(), onRefresh)

    await userEvent.click(screen.getByRole('button', { name: '书架更多操作' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '作品回收站' }))
    await screen.findByRole('dialog', { name: '作品回收站' })
    await userEvent.click(screen.getByRole('checkbox', { name: '全选当前结果' }))
    await userEvent.click(screen.getByRole('button', { name: '恢复所选' }))

    await waitFor(() => expect(mocks.restoreProjects).toHaveBeenCalledWith(['deleted-a', 'deleted-b']))
    expect(onRefresh).toHaveBeenCalled()
    expect(screen.getByText('作品回收站是空的')).toBeInTheDocument()
  })

  it('shows a recoverable load error inside the trash center', async () => {
    mocks.listProjectTrash.mockRejectedValueOnce(new Error('资料库正忙')).mockResolvedValueOnce([])
    renderBookshelf()
    await userEvent.click(screen.getByRole('button', { name: '书架更多操作' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '作品回收站' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('资料库正忙')
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('作品回收站是空的')).toBeInTheDocument()
    expect(mocks.listProjectTrash).toHaveBeenCalledTimes(2)
  })

  it('offers a short undo after moving a work to the trash', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    renderBookshelf(vi.fn(), vi.fn(), onRefresh)
    await userEvent.click(screen.getByRole('button', { name: '雾港更多操作' }))
    await userEvent.click(screen.getByRole('menuitem', { name: '移到回收站' }))
    await userEvent.click(screen.getByRole('button', { name: '移到回收站' }))
    expect(await screen.findByRole('button', { name: /撤销/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /撤销/ }))
    await waitFor(() => expect(mocks.restoreProject).toHaveBeenCalledWith('p'))
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })
})

function renderBookshelf(onOpen = vi.fn(), notify = vi.fn(), onRefresh = vi.fn().mockResolvedValue(undefined), projects = [project]) {
  return render(<Bookshelf projects={projects} loading={false} onOpen={onOpen} onRefresh={onRefresh} onOpenReview={vi.fn()} onOpenResearch={vi.fn()} notify={notify} />)
}

function trashedProject(id: string, title: string, description = '旧稿', deletedAt = '2026-09-03T10:00:00.000Z'): ProjectTrashSummary {
  return { id, title, description, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: deletedAt, deletedAt, chapterCount: 2, sceneCount: 5, wordCount: 8600 }
}
