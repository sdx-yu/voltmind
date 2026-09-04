import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, BookOpen, Compass, FileArchive, FileKey2, FileText, FileUp, FlaskConical, LayoutTemplate, MessageSquareText, MoreHorizontal, PencilLine, Plus, RotateCcw, Search, Trash2, Undo2 } from 'lucide-react'
import type { Project, ProjectTrashSummary } from '../../shared/types'
import { api } from '../lib/api'
import { onCommand } from '../lib/commands'
import { formatRelativeTime, readWritingFile, splitChapters, textToTiptap } from '../lib/text'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState } from './EmptyState'
import { Modal } from './Modal'
import { ProjectDetailsDialog } from './ProjectDetailsDialog'
import { Button, CommandPalette, DropdownMenu, IconButton, SearchField, SelectField, TextareaField, TextField, type CommandItem } from '../ui'

interface Props {
  projects: Project[]
  loading: boolean
  onOpen: (project: Project, initialView?: 'write' | 'plot' | 'template') => void
  onRefresh: () => Promise<void>
  onOpenReview: () => void
  onOpenResearch: () => void
  notify: (type: 'success' | 'error', message: string) => void
}

export function Bookshelf({ projects, loading, onOpen, onRefresh, onOpenReview, onOpenResearch, notify }: Props) {
  const [creating, setCreating] = useState(false)
  const [creationPath, setCreationPath] = useState<'blank' | 'guided' | 'template'>('blank')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [storyGenre, setStoryGenre] = useState('')
  const [storyPremise, setStoryPremise] = useState('')
  const [storyEnding, setStoryEnding] = useState('')
  const [busy, setBusy] = useState(false)
  const [importPreview, setImportPreview] = useState<{ file: File; chapters: Array<{ title: string; text: string; included: boolean }> } | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashed, setTrashed] = useState<ProjectTrashSummary[]>([])
  const [trashLoading, setTrashLoading] = useState(false)
  const [trashError, setTrashError] = useState('')
  const [trashQuery, setTrashQuery] = useState('')
  const [trashSort, setTrashSort] = useState<'recent' | 'oldest' | 'title'>('recent')
  const [selectedTrashIds, setSelectedTrashIds] = useState<Set<string>>(new Set())
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set())
  const [restoreErrors, setRestoreErrors] = useState<Record<string, string>>({})
  const [batchRestoring, setBatchRestoring] = useState(false)
  const [recentlyTrashed, setRecentlyTrashed] = useState<Project | null>(null)
  const [syncRestore, setSyncRestore] = useState<{ fileName: string; value: unknown } | null>(null)
  const [syncPhrase, setSyncPhrase] = useState('')
  const [syncDeviceName, setSyncDeviceName] = useState('我的电脑')
  const [pendingTrash, setPendingTrash] = useState<Project | null>(null)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [pendingSyncApply, setPendingSyncApply] = useState<{ projectTitle: string; senderDeviceName: string } | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const backupRef = useRef<HTMLInputElement>(null)
  const syncRef = useRef<HTMLInputElement>(null)
  const undoTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.isComposing) {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => onCommand((command) => {
    if (command === 'search' || command === 'command-palette') { setPaletteOpen(true); return }
    if (command === 'trash') { void openTrash(); return }
    if (command === 'view-review') { onOpenReview(); return }
    if (command === 'view-sync') { syncRef.current?.click(); return }
    if (command === 'bookshelf') return
    if (command === 'help') { notify('error', '备份、接力恢复和作品回收站位于书架的“更多操作”中'); return }
    notify('error', '这个命令需要先打开一个项目')
  }), [notify, onOpenReview])

  useEffect(() => () => { if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current) }, [])

  async function createProject() {
    if (!title.trim()) return
    setBusy(true)
    try {
      const guided = creationPath === 'guided'
      const project = await api.createProject(title.trim(), storyPremise.trim(), guided ? { blueprint: { approach: 'guided', genre: storyGenre.trim(), premise: storyPremise.trim(), endingState: storyEnding.trim() }, starter: 'three_act' } : undefined)
      await onRefresh()
      setCreating(false)
      setTitle('')
      setStoryGenre(''); setStoryPremise(''); setStoryEnding('')
      onOpen(project, creationPath === 'template' ? 'template' : creationPath === 'guided' ? 'plot' : 'write')
    } catch (error) { notify('error', error instanceof Error ? error.message : '创建失败') }
    finally { setBusy(false) }
  }

  async function previewWriting(file: File) {
    try {
      const text = await readWritingFile(file)
      setImportPreview({ file, chapters: splitChapters(text).map((chapter) => ({ ...chapter, included: true })) })
    } catch (error) { notify('error', error instanceof Error ? error.message : '无法读取文件') }
    finally { if (importRef.current) importRef.current.value = '' }
  }

  async function importWriting() {
    if (!importPreview) return
    setBusy(true)
    try {
      const bytes = new Uint8Array(await importPreview.file.arrayBuffer())
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const contentHash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
      let binary = ''; for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
      const chapters = importPreview.chapters.filter((chapter) => chapter.included).map((chapter) => ({ title: chapter.title, text: chapter.text, contentJson: textToTiptap(chapter.text) }))
      const project = await api.importProject({ title: importPreview.file.name.replace(/\.(txt|md|docx)$/i, ''), chapters, original: { fileName: importPreview.file.name, mimeType: importPreview.file.type || 'application/octet-stream', byteSize: bytes.byteLength, contentHash, contentBase64: btoa(binary) } })
      await onRefresh()
      notify('success', `已导入 ${chapters.length} 章，原文件未被修改`)
      setImportPreview(null)
      onOpen(project)
    } catch (error) { notify('error', error instanceof Error ? error.message : '导入失败') }
    finally { setBusy(false) }
  }

  async function loadTrash() {
    setTrashLoading(true); setTrashError('')
    try {
      const items = await api.listProjectTrash()
      setTrashed(items)
      setSelectedTrashIds((current) => new Set([...current].filter((id) => items.some((item) => item.id === id))))
    } catch (error) { setTrashError(error instanceof Error ? error.message : '回收站读取失败') }
    finally { setTrashLoading(false) }
  }
  function openTrash() {
    setTrashOpen(true); setTrashed([]); setTrashQuery(''); setRestoreErrors({}); setSelectedTrashIds(new Set())
    void loadTrash()
  }
  async function trashProject() {
    if (!pendingTrash) return
    setBusy(true)
    try {
      const removed = await api.trashProject(pendingTrash.id)
      setPendingTrash(null); setRecentlyTrashed(removed)
      if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current)
      undoTimerRef.current = window.setTimeout(() => setRecentlyTrashed(null), 7_000)
      await onRefresh(); notify('success', '作品已移入回收站')
    } catch (error) { notify('error', error instanceof Error ? error.message : '移入回收站失败') }
    finally { setBusy(false) }
  }
  async function undoTrash() {
    if (!recentlyTrashed) return
    const project = recentlyTrashed
    setRecentlyTrashed(null)
    if (undoTimerRef.current !== null) window.clearTimeout(undoTimerRef.current)
    try { await api.restoreProject(project.id); await onRefresh(); notify('success', `“${project.title}”已恢复到书架`) }
    catch (error) { notify('error', error instanceof Error ? error.message : '撤销删除失败') }
  }
  async function restoreProject(project: ProjectTrashSummary) {
    setRestoringIds((current) => new Set(current).add(project.id))
    setRestoreErrors((current) => { const next = { ...current }; delete next[project.id]; return next })
    try {
      await api.restoreProject(project.id)
      setTrashed((current) => current.filter((item) => item.id !== project.id))
      setSelectedTrashIds((current) => { const next = new Set(current); next.delete(project.id); return next })
      await onRefresh(); notify('success', `“${project.title}”已恢复到书架`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '恢复失败，请重试'
      setRestoreErrors((current) => ({ ...current, [project.id]: message }))
    } finally { setRestoringIds((current) => { const next = new Set(current); next.delete(project.id); return next }) }
  }
  async function restoreSelected() {
    const ids = [...selectedTrashIds].filter((id) => trashed.some((project) => project.id === id))
    if (!ids.length) return
    setBatchRestoring(true); setTrashError('')
    try {
      await api.restoreProjects(ids)
      setTrashed((current) => current.filter((project) => !ids.includes(project.id)))
      setSelectedTrashIds(new Set())
      await onRefresh(); notify('success', `已恢复 ${ids.length} 部作品`)
    } catch (error) { setTrashError(error instanceof Error ? error.message : '批量恢复失败，请重试') }
    finally { setBatchRestoring(false) }
  }

  async function restoreBackup(file: File) {
    setBusy(true)
    try {
      const archive = JSON.parse(await file.text()) as unknown
      const project = await api.restoreBackup(archive)
      await onRefresh()
      notify('success', '备份已恢复为新项目，原项目没有被覆盖')
      onOpen(project)
    } catch (error) { notify('error', error instanceof Error ? error.message : '备份恢复失败') }
    finally { setBusy(false); if (backupRef.current) backupRef.current.value = '' }
  }

  async function previewSyncRestore(file: File) {
    try { setSyncRestore({ fileName: file.name, value: JSON.parse(await file.text()) as unknown }) }
    catch (error) { notify('error', error instanceof Error ? error.message : '接力包无法读取') }
    finally { if (syncRef.current) syncRef.current.value = '' }
  }

  async function inspectSyncPackage() {
    if (!syncRestore) return
    setBusy(true)
    try {
      const inspection = await api.inspectSyncPackage(syncRestore.value, syncPhrase)
      setPendingSyncApply({ projectTitle: inspection.projectTitle, senderDeviceName: inspection.senderDeviceName })
    } catch (error) { notify('error', error instanceof Error ? error.message : '接力恢复失败') }
    finally { setBusy(false) }
  }
  async function applySyncPackage() {
    if (!syncRestore || !pendingSyncApply) return
    setBusy(true)
    try {
      const result = await api.importSyncPackage(syncRestore.value, syncPhrase, syncDeviceName)
      await onRefresh(); setSyncRestore(null); setSyncPhrase(''); setPendingSyncApply(null)
      notify('success', `“${pendingSyncApply.projectTitle}”已从加密接力包恢复`); onOpen(result.project)
    } catch (error) { notify('error', error instanceof Error ? error.message : '接力恢复失败') }
    finally { setBusy(false) }
  }

  const commandItems: CommandItem[] = [
    { id: 'new', title: '新建故事', description: '从空白正文或结构模板开始', section: '书架', shortcut: 'N', icon: <Plus size={17} />, onSelect: () => { setCreationPath('blank'); setCreating(true) } },
    { id: 'import', title: '导入旧稿', description: '读取 TXT、Markdown 或 Word 文稿', section: '书架', icon: <FileUp size={17} />, onSelect: () => importRef.current?.click() },
    ...projects.map((project) => ({ id: `project-${project.id}`, title: project.title, description: project.description || '继续上次写作', section: '项目', icon: <BookOpen size={17} />, keywords: ['打开', '继续写'], onSelect: () => onOpen(project) })),
    { id: 'review', title: '打开审阅任务', description: '进入隔离的审阅者工作台', section: '协作', icon: <MessageSquareText size={17} />, onSelect: onOpenReview },
    { id: 'sync', title: '恢复加密接力包', description: '从另一台设备带回项目副本', section: '恢复', icon: <FileKey2 size={17} />, onSelect: () => syncRef.current?.click() },
    { id: 'backup', title: '恢复完整备份', description: '恢复为新项目，不覆盖现有内容', section: '恢复', icon: <RotateCcw size={17} />, onSelect: () => backupRef.current?.click() },
    { id: 'trash', title: '作品回收站', description: '查看并恢复已删除作品', section: '恢复', icon: <Trash2 size={17} />, onSelect: openTrash },
    { id: 'research', title: '真实作者验证', description: '研究负责人查看任务、批次与波次', section: '研究工具', icon: <FlaskConical size={17} />, onSelect: onOpenResearch },
  ]

  const visibleTrash = useMemo(() => {
    const query = trashQuery.trim().toLocaleLowerCase('zh-CN')
    const items = query ? trashed.filter((project) => `${project.title}\n${project.description}`.toLocaleLowerCase('zh-CN').includes(query)) : [...trashed]
    return items.sort((left, right) => trashSort === 'title'
      ? left.title.localeCompare(right.title, 'zh-CN')
      : trashSort === 'oldest'
        ? new Date(left.deletedAt!).getTime() - new Date(right.deletedAt!).getTime()
        : new Date(right.deletedAt!).getTime() - new Date(left.deletedAt!).getTime())
  }, [trashed, trashQuery, trashSort])
  const allVisibleSelected = visibleTrash.length > 0 && visibleTrash.every((project) => selectedTrashIds.has(project.id))

  return <main className="bookshelf-page">
    <header className="bookshelf-header">
      <div className="brand"><span className="brand-mark">笔</span><div><h1>笔不怠</h1><p>笔耕不怠，写尽所思。</p></div></div>
      <div className="bookshelf-global-actions">
        <input ref={syncRef} hidden type="file" accept=".bbd-sync,application/json" onChange={(event) => event.target.files?.[0] && void previewSyncRestore(event.target.files[0])} />
        <input ref={backupRef} hidden type="file" accept=".bbd-backup,application/json" onChange={(event) => event.target.files?.[0] && void restoreBackup(event.target.files[0])} />
        <input ref={importRef} hidden type="file" accept=".txt,.md,.docx,text/plain" onChange={(event) => event.target.files?.[0] && void previewWriting(event.target.files[0])} />
        <IconButton label="搜索书架和功能" onClick={() => setPaletteOpen(true)}><Search size={18} /></IconButton>
        <Button variant="secondary" disabled={busy} leadingIcon={<FileUp size={17} />} onClick={() => importRef.current?.click()}>导入旧稿</Button>
        <Button variant="primary" disabled={busy} leadingIcon={<Plus size={17} />} onClick={() => { setCreationPath('blank'); setCreating(true) }}>新故事</Button>
        <DropdownMenu label="书架更多操作" trigger={<IconButton className="bookshelf-more-trigger" label="书架更多操作"><MoreHorizontal size={19} /></IconButton>} items={[
          { id: 'review', label: '打开审阅任务', icon: <MessageSquareText size={15} />, onSelect: onOpenReview },
          { id: 'sync', label: '恢复加密接力包', icon: <FileKey2 size={15} />, onSelect: () => syncRef.current?.click() },
          { id: 'backup', label: '恢复完整备份', icon: <RotateCcw size={15} />, onSelect: () => backupRef.current?.click() },
          { id: 'trash', label: '作品回收站', icon: <Trash2 size={15} />, onSelect: openTrash },
          { id: 'research', label: '真实作者验证', icon: <FlaskConical size={15} />, onSelect: onOpenResearch },
        ]} />
      </div>
    </header>

    <section className="bookshelf-content" aria-labelledby="bookshelf-title">
      <div className="section-heading">
        <span className="eyebrow">你的书架</span>
        <div className="bookshelf-title-row"><h2 id="bookshelf-title">继续写下去</h2><span className="project-count" aria-live="polite">{projects.length} 部作品</span></div>
      </div>
      {loading ? <div className="skeleton-grid"><span /><span /><span /></div> : projects.length === 0
        ? <EmptyState title="故事还没开始" description="新建一个空白项目，或把旧稿带进来。所有稿件默认只保存在本机。" action={<button className="button primary" onClick={() => { setCreationPath('blank'); setCreating(true) }}><Plus size={17} />写第一个故事</button>} />
        : <div className="project-grid">{projects.map((project, index) => <article key={project.id} className="project-card"><button className="project-open" onClick={() => onOpen(project)}>
            <div className={`cover cover-${index % 5}`}><BookOpen size={29} /><span>{project.title.slice(0, 1)}</span></div>
            <div className="project-card-body"><h3>{project.title}</h3><p className={project.description ? undefined : 'project-description-empty'}>{project.description || '尚未填写作品简介'}</p><footer><time dateTime={project.updatedAt}>{formatRelativeTime(project.updatedAt)}</time><span className="local-badge"><FileArchive size={13} />本机</span></footer></div>
          </button><span className="project-actions"><DropdownMenu label={`${project.title}更多操作`} trigger={<IconButton size="small" label={`${project.title}更多操作`}><MoreHorizontal size={16} /></IconButton>} items={[
            { id: 'edit', label: '编辑作品信息', icon: <PencilLine size={15} />, onSelect: () => setEditingProject(project) },
            { id: 'trash', label: '移到回收站', icon: <Trash2 size={15} />, danger: true, onSelect: () => setPendingTrash(project) },
          ]} /></span></article>)}</div>}
    </section>
    <footer className="bookshelf-footer" aria-label="创作数据保障"><span>稿件默认保存在本机</span><span>自动留痕</span><span>AI 不越权</span></footer>

    {creating && <Modal title="新建故事" wide={creationPath === 'guided'} onClose={() => setCreating(false)}><form onSubmit={(event) => { event.preventDefault(); void createProject() }} className="form-stack">
      <TextField label="书名" required showCount autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="给故事一个暂定名" maxLength={200} />
      <div className="bookshelf-create-paths" role="radiogroup" aria-label="开始方式">
        <button type="button" role="radio" aria-checked={creationPath === 'blank'} className={`bookshelf-create-path${creationPath === 'blank' ? ' is-selected' : ''}`} onClick={() => setCreationPath('blank')}><FileText size={24} /><span><strong>直接开写</strong><small>创建基础章节，立即进入正文。</small></span></button>
        <button type="button" role="radio" aria-checked={creationPath === 'guided'} className={`bookshelf-create-path${creationPath === 'guided' ? ' is-selected' : ''}`} onClick={() => setCreationPath('guided')}><Compass size={24} /><span><strong>先定故事方向</strong><small>写下前提与结局，建立可修改的关键节拍。</small></span><em>推荐</em></button>
        <button type="button" role="radio" aria-checked={creationPath === 'template'} className={`bookshelf-create-path${creationPath === 'template' ? ' is-selected' : ''}`} onClick={() => setCreationPath('template')}><LayoutTemplate size={24} /><span><strong>从结构起步</strong><small>先进入模板目录，预览后再安装结构。</small></span></button>
      </div>
      {creationPath === 'guided' && <div className="bookshelf-guided-fields"><div className="form-grid"><TextField label="类型 / 气质" optional maxLength={80} value={storyGenre} onChange={(event) => setStoryGenre(event.target.value)} placeholder="如：古风悬疑、都市情感" /><TextField label="结局落点" optional maxLength={1200} value={storyEnding} onChange={(event) => setStoryEnding(event.target.value)} placeholder="结局时人物与世界变成什么样" /></div><TextareaField label="一句话故事前提" optional maxLength={1200} value={storyPremise} onChange={(event) => setStoryPremise(event.target.value)} placeholder="当……发生，一个……的人必须……否则……" description="现在不确定也可以留空，创建后在故事蓝图中继续补。" /></div>}
      <p className="form-hint">蓝图、模板和正文相互独立；先定方向不会自动生成章节，也不会锁死写法。</p>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setCreating(false)}>取消</button><button disabled={!title.trim() || busy} className="button primary">{creationPath === 'template' ? '创建并选择结构' : creationPath === 'guided' ? '创建并规划故事' : '创建并开始写'}</button></div>
    </form></Modal>}
    {importPreview && <Modal title="预览章节切分" onClose={() => setImportPreview(null)} wide><div className="import-preview"><p className="form-hint">原件将随项目保存在离线备份中。取消或导入失败都不会创建半成品项目。</p><div className="import-chapters">{importPreview.chapters.map((chapter, index) => <label key={index}><input type="checkbox" checked={chapter.included} onChange={(event) => setImportPreview((current) => current && ({ ...current, chapters: current.chapters.map((item, itemIndex) => itemIndex === index ? { ...item, included: event.target.checked } : item) }))} /><span><input value={chapter.title} onChange={(event) => setImportPreview((current) => current && ({ ...current, chapters: current.chapters.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) }))} /><small>{chapter.text.length.toLocaleString('zh-CN')} 字符 · {chapter.text.slice(0, 54) || '空章节'}</small></span></label>)}</div><div className="modal-actions"><button className="button ghost" onClick={() => setImportPreview(null)}>取消</button><button className="button primary" disabled={busy || !importPreview.chapters.some((chapter) => chapter.included)} onClick={() => void importWriting()}>{busy ? '正在导入…' : `导入 ${importPreview.chapters.filter((chapter) => chapter.included).length} 章`}</button></div></div></Modal>}
    {syncRestore && <Modal title="从加密接力包恢复" onClose={() => setSyncRestore(null)}><div className="form-stack"><p className="form-hint">{syncRestore.fileName} 将先在本机完成分块哈希、密钥验证和解密预检；验证通过后才创建项目。</p><TextField label="这台设备的名称" required value={syncDeviceName} maxLength={80} onChange={(event) => setSyncDeviceName(event.target.value)}/><TextField label="恢复短语" required type="password" autoComplete="off" value={syncPhrase} onChange={(event) => setSyncPhrase(event.target.value)} description="至少 20 个字符；只用于本次校验，不会保存到数据库"/><div className="modal-actions"><button className="button ghost" onClick={() => setSyncRestore(null)}>取消</button><button className="button primary" disabled={busy || syncPhrase.length < 20 || !syncDeviceName.trim()} onClick={() => void inspectSyncPackage()}>{busy ? '正在校验…' : '校验并恢复'}</button></div></div></Modal>}
    {pendingSyncApply && <ConfirmDialog title="恢复为本地副本" message={`接力包校验通过：${pendingSyncApply.projectTitle}，来自 ${pendingSyncApply.senderDeviceName}。恢复为这台设备的本地副本？`} confirmLabel="恢复为本地副本" busy={busy} onConfirm={() => void applySyncPackage()} onClose={() => setPendingSyncApply(null)} />}
    {pendingTrash && <ConfirmDialog title="移到回收站" message={`把“${pendingTrash.title}”移入回收站？`} confirmLabel="移到回收站" danger onConfirm={() => void trashProject()} onClose={() => setPendingTrash(null)} />}
    {editingProject && <ProjectDetailsDialog project={editingProject} onClose={() => setEditingProject(null)} onSaved={async () => onRefresh()} notify={notify} />}
    {trashOpen && <Modal className="trash-dialog" wide title="作品回收站" onClose={() => setTrashOpen(false)} footer={trashed.length > 0 && !trashLoading ? <div className="trash-batch-footer"><span>已选择 {selectedTrashIds.size} 部</span><Button variant="primary" leadingIcon={<RotateCcw size={15}/>} loading={batchRestoring} disabled={!selectedTrashIds.size || restoringIds.size > 0} onClick={() => void restoreSelected()}>恢复所选</Button></div> : undefined}>
      <div className="trash-center">
        <div className="trash-intro"><div><strong>{trashLoading ? '正在读取…' : `${trashed.length} 部作品`}</strong><span>删除的作品仍完整保存在本机，恢复后将回到书架。</span></div><FileArchive size={22} aria-hidden="true" /></div>
        {!trashLoading && !trashError && trashed.length > 0 && <div className="trash-toolbar">
          <SearchField label="搜索作品" value={trashQuery} onValueChange={setTrashQuery} placeholder="作品名或简介" />
          <SelectField label="排序" value={trashSort} onValueChange={(value) => setTrashSort(value as typeof trashSort)}><option value="recent">最近删除</option><option value="oldest">最早删除</option><option value="title">作品名称</option></SelectField>
        </div>}
        {trashLoading ? <div className="trash-skeleton" aria-label="正在加载作品回收站"><span/><span/><span/></div>
          : trashError ? <div className="trash-error" role="alert"><AlertCircle size={22}/><div><strong>作品回收站暂时无法读取</strong><span>{trashError}</span></div><Button size="small" variant="secondary" onClick={() => void loadTrash()}>重试</Button></div>
            : trashed.length === 0 ? <div className="trash-empty"><Trash2 size={28}/><strong>作品回收站是空的</strong><span>移入回收站的作品会安全保留在这里。</span></div>
              : visibleTrash.length === 0 ? <div className="trash-empty"><Search size={26}/><strong>没有匹配的作品</strong><span>试试其他作品名或简介。</span></div>
                : <div className="project-trash-list" aria-label="已删除作品">
                  <label className="trash-select-all"><input type="checkbox" aria-label="全选当前结果" checked={allVisibleSelected} onChange={(event) => setSelectedTrashIds((current) => { const next = new Set(current); for (const project of visibleTrash) event.target.checked ? next.add(project.id) : next.delete(project.id); return next })}/><span>全选当前结果</span><small>{visibleTrash.length} 部</small></label>
                  {visibleTrash.map((project) => <article key={project.id} className={`trash-row${restoreErrors[project.id] ? ' has-error' : ''}`}>
                    <input type="checkbox" aria-label={`选择作品 ${project.title}`} checked={selectedTrashIds.has(project.id)} disabled={restoringIds.has(project.id) || batchRestoring} onChange={(event) => setSelectedTrashIds((current) => { const next = new Set(current); event.target.checked ? next.add(project.id) : next.delete(project.id); return next })}/>
                    <div className="trash-row-main"><strong>{project.title}</strong><p className={project.description ? undefined : 'is-empty'}>{project.description || '未填写作品简介'}</p><div className="trash-meta"><time dateTime={project.deletedAt!}>删除于 {formatDeletedAt(project.deletedAt!)}</time><span>{project.chapterCount} 章</span><span>{project.sceneCount} 场</span><span>{project.wordCount.toLocaleString('zh-CN')} 字</span></div>{restoreErrors[project.id] && <small className="trash-row-error" role="alert">{restoreErrors[project.id]}</small>}</div>
                    <Button size="small" variant="secondary" leadingIcon={<RotateCcw size={14}/>} loading={restoringIds.has(project.id)} disabled={batchRestoring} onClick={() => void restoreProject(project)}>{restoreErrors[project.id] ? '重试' : '恢复'}</Button>
                  </article>)}
                </div>}
      </div>
    </Modal>}
    {recentlyTrashed && <div className="trash-undo" role="status"><span>“{recentlyTrashed.title}”已移入作品回收站</span><button onClick={() => void undoTrash()}><Undo2 size={14}/>撤销</button></div>}
    <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={commandItems} title="书架命令" placeholder="搜索项目或功能…" />
  </main>
}

function formatDeletedAt(value: string) {
  return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
