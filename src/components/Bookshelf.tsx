import { useRef, useState } from 'react'
import { BookOpen, FileArchive, FileKey2, FileUp, MessageSquareText, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { Project } from '../../shared/types'
import { api } from '../lib/api'
import { formatRelativeTime, readWritingFile, splitChapters, textToTiptap } from '../lib/text'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState } from './EmptyState'
import { Modal } from './Modal'

interface Props {
  projects: Project[]
  loading: boolean
  onOpen: (project: Project) => void
  onRefresh: () => Promise<void>
  onOpenReview: () => void
  notify: (type: 'success' | 'error', message: string) => void
}

export function Bookshelf({ projects, loading, onOpen, onRefresh, onOpenReview, notify }: Props) {
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [importPreview, setImportPreview] = useState<{ file: File; chapters: Array<{ title: string; text: string; included: boolean }> } | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashed, setTrashed] = useState<Project[]>([])
  const [syncRestore, setSyncRestore] = useState<{ fileName: string; value: unknown } | null>(null)
  const [syncPhrase, setSyncPhrase] = useState('')
  const [syncDeviceName, setSyncDeviceName] = useState('我的电脑')
  const [pendingTrash, setPendingTrash] = useState<Project | null>(null)
  const [pendingSyncApply, setPendingSyncApply] = useState<{ projectTitle: string; senderDeviceName: string } | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const backupRef = useRef<HTMLInputElement>(null)
  const syncRef = useRef<HTMLInputElement>(null)

  async function createProject() {
    if (!title.trim()) return
    setBusy(true)
    try {
      const project = await api.createProject(title.trim())
      await onRefresh()
      setCreating(false)
      setTitle('')
      onOpen(project)
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

  async function openTrash() { try { setTrashed((await api.listProjects(true)).filter((project) => project.deletedAt)); setTrashOpen(true) } catch (error) { notify('error', error instanceof Error ? error.message : '回收站读取失败') } }
  async function trashProject() {
    if (!pendingTrash) return
    await api.trashProject(pendingTrash.id)
    setPendingTrash(null)
    await onRefresh()
    notify('success', '项目已移入回收站')
  }
  async function restoreProject(project: Project) { await api.restoreProject(project.id); setTrashed((current) => current.filter((item) => item.id !== project.id)); await onRefresh(); notify('success', '项目已恢复') }

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

  return <main className="bookshelf-page">
    <header className="bookshelf-header">
      <div className="brand"><span className="brand-mark">笔</span><div><h1>笔不怠</h1><p>笔耕不怠，写尽所思。</p></div></div>
      <div className="header-actions">
        <button className="button ghost" disabled={busy} onClick={onOpenReview}><MessageSquareText size={17} />打开审阅任务</button>
        <input ref={syncRef} hidden type="file" accept=".bbd-sync,application/json" onChange={(event) => event.target.files?.[0] && void previewSyncRestore(event.target.files[0])} />
        <button className="button ghost" disabled={busy} onClick={() => syncRef.current?.click()}><FileKey2 size={17} />接力恢复</button>
        <input ref={backupRef} hidden type="file" accept=".bbd-backup,application/json" onChange={(event) => event.target.files?.[0] && void restoreBackup(event.target.files[0])} />
        <button className="button ghost" disabled={busy} onClick={() => void openTrash()}><Trash2 size={17} />回收站</button>
        <button className="button ghost" disabled={busy} onClick={() => backupRef.current?.click()}><RotateCcw size={17} />恢复备份</button>
        <input ref={importRef} hidden type="file" accept=".txt,.md,.docx,text/plain" onChange={(event) => event.target.files?.[0] && void previewWriting(event.target.files[0])} />
        <button className="button secondary" disabled={busy} onClick={() => importRef.current?.click()}><FileUp size={17} />导入旧稿</button>
        <button className="button primary" disabled={busy} onClick={() => setCreating(true)}><Plus size={17} />新故事</button>
      </div>
    </header>

    <section className="bookshelf-content">
      <div className="section-heading"><div><span className="eyebrow">你的书架</span><h2>继续写下去</h2></div><span className="project-count">{projects.length} 个项目</span></div>
      {loading ? <div className="skeleton-grid"><span /><span /><span /></div> : projects.length === 0
        ? <EmptyState title="故事还没开始" description="新建一个空白项目，或把旧稿带进来。所有稿件默认只保存在本机。" action={<button className="button primary" onClick={() => setCreating(true)}><Plus size={17} />写第一个故事</button>} />
        : <div className="project-grid">{projects.map((project, index) => <article key={project.id} className="project-card"><button className="project-open" onClick={() => onOpen(project)}>
            <div className={`cover cover-${index % 5}`}><BookOpen size={29} /><span>{project.title.slice(0, 1)}</span></div>
            <div className="project-card-body"><h3>{project.title}</h3><p>{project.description || '一切还在发生。'}</p><footer><span>{formatRelativeTime(project.updatedAt)}</span><span className="local-badge"><FileArchive size={13} />本机</span></footer></div>
          </button><button className="project-trash" onClick={() => setPendingTrash(project)} aria-label={`删除 ${project.title}`}><Trash2 size={15} /></button></article>)}</div>}
    </section>
    <footer className="bookshelf-footer"><strong>笔耕不怠，写尽所思。</strong><span>本地优先 · 自动留痕 · AI 不越权</span></footer>

    {creating && <Modal title="新建故事" onClose={() => setCreating(false)}><form onSubmit={(event) => { event.preventDefault(); void createProject() }} className="form-stack">
      <label>书名<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="给故事一个暂定名" maxLength={200} /></label>
      <p className="form-hint">创建后 60 秒内即可开始写，不要求先填人物和世界观。</p>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={() => setCreating(false)}>取消</button><button disabled={!title.trim() || busy} className="button primary">创建并开始写</button></div>
    </form></Modal>}
    {importPreview && <Modal title="预览章节切分" onClose={() => setImportPreview(null)} wide><div className="import-preview"><p className="form-hint">原件将随项目保存在离线备份中。取消或导入失败都不会创建半成品项目。</p><div className="import-chapters">{importPreview.chapters.map((chapter, index) => <label key={index}><input type="checkbox" checked={chapter.included} onChange={(event) => setImportPreview((current) => current && ({ ...current, chapters: current.chapters.map((item, itemIndex) => itemIndex === index ? { ...item, included: event.target.checked } : item) }))} /><span><input value={chapter.title} onChange={(event) => setImportPreview((current) => current && ({ ...current, chapters: current.chapters.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) }))} /><small>{chapter.text.length.toLocaleString('zh-CN')} 字符 · {chapter.text.slice(0, 54) || '空章节'}</small></span></label>)}</div><div className="modal-actions"><button className="button ghost" onClick={() => setImportPreview(null)}>取消</button><button className="button primary" disabled={busy || !importPreview.chapters.some((chapter) => chapter.included)} onClick={() => void importWriting()}>{busy ? '正在导入…' : `导入 ${importPreview.chapters.filter((chapter) => chapter.included).length} 章`}</button></div></div></Modal>}
    {syncRestore && <Modal title="从加密接力包恢复" onClose={() => setSyncRestore(null)}><div className="form-stack"><p className="form-hint">{syncRestore.fileName} 将先在本机完成分块哈希、密钥验证和解密预检；验证通过后才创建项目。</p><label>这台设备的名称<input value={syncDeviceName} maxLength={80} onChange={(event) => setSyncDeviceName(event.target.value)}/></label><label>恢复短语<input type="password" autoComplete="off" value={syncPhrase} onChange={(event) => setSyncPhrase(event.target.value)} placeholder="不会保存到数据库"/></label><div className="modal-actions"><button className="button ghost" onClick={() => setSyncRestore(null)}>取消</button><button className="button primary" disabled={busy || syncPhrase.length < 20 || !syncDeviceName.trim()} onClick={() => void inspectSyncPackage()}>{busy ? '正在校验…' : '校验并恢复'}</button></div></div></Modal>}
    {pendingSyncApply && <ConfirmDialog title="恢复为本地副本" message={`接力包校验通过：${pendingSyncApply.projectTitle}，来自 ${pendingSyncApply.senderDeviceName}。恢复为这台设备的本地副本？`} confirmLabel="恢复为本地副本" busy={busy} onConfirm={() => void applySyncPackage()} onClose={() => setPendingSyncApply(null)} />}
    {pendingTrash && <ConfirmDialog title="移到回收站" message={`把“${pendingTrash.title}”移入回收站？`} confirmLabel="移到回收站" danger onConfirm={() => void trashProject()} onClose={() => setPendingTrash(null)} />}
    {trashOpen && <Modal title="项目回收站" onClose={() => setTrashOpen(false)}>{trashed.length ? <div className="trash-list">{trashed.map((project) => <div key={project.id}><span><strong>{project.title}</strong><small>可恢复到书架</small></span><button className="button secondary compact" onClick={() => void restoreProject(project)}>恢复</button></div>)}</div> : <p className="muted">回收站是空的。</p>}</Modal>}
  </main>
}
