import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BookOpen, Check, CloudOff, Download, Flag, Inbox, Lightbulb, RefreshCw, Send, Sparkles, Wifi } from 'lucide-react'
import type { MobileInboxAction, MobileInboxActionType, MobileInboxItem, MobileInboxKind, MobileLibraryScene } from '../../shared/types'
import { api } from '../lib/api'
import { SelectControl } from '../ui'
import {
  getMobileDeviceId,
  getMobileLibrary,
  listLocalMobileItems,
  mergeLocalMobileItems,
  putLocalMobileAction,
  putLocalMobileItem,
  resetMobileStore,
  saveMobileLibrary,
  type CachedMobileLibrary,
} from '../lib/mobileStore'

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
type SyncState = 'idle' | 'syncing' | 'offline' | 'error'

const kindLabels: Record<MobileInboxKind, string> = { inspiration: '灵感', scene_idea: '场景想法', review_note: '审阅笔记' }
const actionLabels: Record<MobileInboxActionType, string> = { filed: '已归档', dismissed: '已忽略', revisit: '稍后再看', approved: '已认可' }

export function MobileHome() {
  const [library, setLibrary] = useState<CachedMobileLibrary>({ projects: [], scenes: [], cachedAt: '' })
  const [items, setItems] = useState<MobileInboxItem[]>([])
  const [kind, setKind] = useState<MobileInboxKind>('inspiration')
  const [projectId, setProjectId] = useState('')
  const [targetNodeId, setTargetNodeId] = useState('')
  const [content, setContent] = useState('')
  const [reader, setReader] = useState<MobileLibraryScene | null>(null)
  const [syncState, setSyncState] = useState<SyncState>(navigator.onLine ? 'idle' : 'offline')
  const [message, setMessage] = useState('')
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [storageError, setStorageError] = useState(false)
  const [storageWarning, setStorageWarning] = useState(false)

  const reloadLocal = useCallback(async () => {
    const [cachedLibrary, localItems] = await Promise.all([getMobileLibrary(), listLocalMobileItems()])
    setLibrary(cachedLibrary); setItems(localItems)
  }, [])

  const synchronize = useCallback(async () => {
    if (!navigator.onLine) { setSyncState('offline'); await reloadLocal(); return }
    setSyncState('syncing')
    try {
      const localItems = await listLocalMobileItems()
      for (const item of localItems) {
        const { actions, currentAction: _currentAction, ...record } = item
        await api.createMobileInboxItem(record)
        for (const action of actions) await api.createMobileInboxAction(action)
      }
      const [remoteItems, remoteLibrary] = await Promise.all([api.listMobileInbox(), api.getMobileLibrary()])
      await Promise.all([mergeLocalMobileItems(remoteItems), saveMobileLibrary(remoteLibrary)])
      await reloadLocal(); setSyncState('idle')
    } catch {
      await reloadLocal(); setSyncState(navigator.onLine ? 'error' : 'offline')
    }
  }, [reloadLocal])

  useEffect(() => {
    void reloadLocal().then(synchronize).catch(() => { setStorageError(true); setMessage('本地收集箱暂时无法读取，请尝试修复本地缓存。') })
    void navigator.storage?.estimate?.().then(({ quota, usage }) => { if (quota && quota - (usage ?? 0) < 2 * 1024 * 1024) setStorageWarning(true) }).catch(() => undefined)
    const online = () => void synchronize()
    const offline = () => setSyncState('offline')
    const captureInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent) }
    window.addEventListener('online', online); window.addEventListener('offline', offline); window.addEventListener('beforeinstallprompt', captureInstall)
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', offline); window.removeEventListener('beforeinstallprompt', captureInstall) }
  }, [reloadLocal, synchronize])

  const projectScenes = useMemo(() => library.scenes.filter((scene) => !projectId || scene.projectId === projectId), [library.scenes, projectId])
  const pending = useMemo(() => items.filter((item) => item.currentAction === null || item.currentAction === 'revisit'), [items])

  async function capture() {
    const text = content.trim(); if (!text) return
    const item = {
      id: crypto.randomUUID(), projectId: projectId || null, targetNodeId: targetNodeId || null,
      kind, content: text, originDeviceId: getMobileDeviceId(), createdAt: new Date().toISOString(),
    }
    try {
      await navigator.storage?.persist?.().catch(() => false)
      await putLocalMobileItem(item); setContent(''); setMessage(navigator.onLine ? '已存入本机，正在回流' : '已安全存入本机，联网后自动回流')
      await reloadLocal(); await synchronize()
    } catch (error) {
      const quota = error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
      setStorageWarning(quota); setStorageError(!quota); setMessage(quota ? '设备可用空间不足，这条记录尚未保存。请释放空间后重试。' : '本地收集箱写入失败，这条记录尚未保存。')
    }
  }

  async function decide(item: MobileInboxItem, action: MobileInboxActionType) {
    const event: MobileInboxAction = { id: crypto.randomUUID(), itemId: item.id, action, note: '', createdAt: new Date().toISOString() }
    try { await putLocalMobileAction(event); await reloadLocal(); setMessage(`已标记为“${actionLabels[action]}”`); await synchronize() }
    catch { setStorageError(true); setMessage('处理结果未能写入本机，请修复本地缓存后重试。') }
  }

  function openReview(scene: MobileLibraryScene) { setReader(scene); setKind('review_note'); setProjectId(scene.projectId); setTargetNodeId(scene.id) }

  async function install() {
    if (!installPrompt) return
    await installPrompt.prompt(); const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') setInstallPrompt(null)
  }

  async function repairStorage() {
    try { await resetMobileStore(); setStorageError(false); setStorageWarning(false); setMessage('本地缓存已重建，可以继续记录。'); await reloadLocal(); await synchronize() }
    catch { setMessage('缓存仍被其他页面占用，请关闭笔不怠的其他页面后重试。') }
  }

  return <main className="mobile-home">
    <header className="mobile-header">
      <div className="mobile-brand"><span>笔</span><div><strong>笔不怠</strong><small>笔耕不怠，写尽所思。</small></div></div>
      <div className={`mobile-network mobile-network-${syncState}`} aria-live="polite">
        {syncState === 'offline' ? <CloudOff size={15}/> : syncState === 'syncing' ? <RefreshCw className="spin" size={15}/> : <Wifi size={15}/>}
        <span>{syncState === 'offline' ? '离线可用' : syncState === 'syncing' ? '回流中' : syncState === 'error' ? '仅本机' : '已同步'}</span>
      </div>
    </header>

    {installPrompt && <button className="mobile-install" onClick={() => void install()}><Download size={17}/>安装到主屏幕<span>离线也能随手记</span></button>}
    {syncState === 'error' && <div className="mobile-local-notice">本地服务暂不可达。记录仍保存在本机，恢复连接后会自动回流。</div>}
    {storageWarning && <div className="mobile-storage-alert">设备可用空间偏低。已有记录仍可阅读，请释放空间后再继续大量记录。</div>}
    {storageError && <div className="mobile-storage-alert danger">本地缓存异常。重建会清除尚未回流的本机记录。<button onClick={() => void repairStorage()}>重建缓存</button></div>}

    <section className="mobile-hero" aria-labelledby="capture-title">
      <div className="mobile-section-title"><div><span className="eyebrow">QUICK CAPTURE</span><h1 id="capture-title">此刻想到什么？</h1></div><Sparkles size={22}/></div>
      <div className="mobile-kind-tabs" role="group" aria-label="记录类型">
        {(Object.keys(kindLabels) as MobileInboxKind[]).map((value) => <button key={value} className={kind === value ? 'active' : ''} onClick={() => setKind(value)}>{kindLabels[value]}</button>)}
      </div>
      <textarea aria-label="记录内容" value={content} onChange={(event) => setContent(event.target.value)} placeholder={kind === 'review_note' ? '写下阅读时的判断或疑问…' : '先记下来，不打断思路…'} rows={5}/>
      <div className="mobile-targets">
        <label>归属项目<SelectControl aria-label="归属项目" value={projectId} onChange={(event) => { setProjectId(event.target.value); setTargetNodeId('') }}><option value="">稍后整理</option>{library.projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</SelectControl></label>
        <label>关联场景<SelectControl aria-label="关联场景" value={targetNodeId} onChange={(event) => setTargetNodeId(event.target.value)}><option value="">不关联场景</option>{projectScenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</SelectControl></label>
      </div>
      <button className="mobile-capture-button" disabled={!content.trim()} onClick={() => void capture()}><Send size={18}/>存入收集箱</button>
      {message && <p className="mobile-message" role="status">{message}</p>}
    </section>

    <section className="mobile-section" aria-labelledby="reading-title">
      <div className="mobile-section-title"><div><span className="eyebrow">CONTINUE READING</span><h2 id="reading-title">继续阅读</h2></div><BookOpen size={21}/></div>
      {library.scenes.length ? <div className="mobile-scene-list">{library.scenes.slice(0, 4).map((scene) => <button key={scene.id} onClick={() => openReview(scene)}>
        <span className="mobile-scene-project">{scene.projectTitle}</span><strong>{scene.title}</strong><p>{scene.plainText || '空场景'}</p><small>{formatTime(scene.updatedAt)} · {provenanceText(scene.provenanceLabel)}</small>
      </button>)}</div> : <MobileEmpty icon={<BookOpen size={19}/>} title="尚无离线书稿" text="联网打开一次后，最近场景会保存在本机供阅读。"/>}
    </section>

    <section className="mobile-section mobile-pending" aria-labelledby="pending-title">
      <div className="mobile-section-title"><div><span className="eyebrow">INBOX</span><h2 id="pending-title">待处理 <em>{pending.length}</em></h2></div><Inbox size={21}/></div>
      {pending.length ? <div className="mobile-inbox-list">{pending.map((item) => <article key={item.id}>
        <header><span>{kindLabels[item.kind]}</span><time>{formatTime(item.createdAt)}</time></header><p>{item.content}</p>
        <footer>{item.kind === 'review_note' && <button onClick={() => void decide(item, 'approved')}><Check size={16}/>认可</button>}<button onClick={() => void decide(item, 'filed')}>归档</button><button onClick={() => void decide(item, 'dismissed')}>忽略</button></footer>
      </article>)}</div> : <MobileEmpty icon={<Lightbulb size={19}/>} title="收集箱已清空" text="想到的内容都妥善处理了。"/>}
    </section>
    <section className="mobile-section" aria-labelledby="sprint-mobile-title">
      <div className="mobile-section-title"><div><span className="eyebrow">SPRINT RESULTS</span><h2 id="sprint-mobile-title">最近冲刺</h2></div><Flag size={21}/></div>
      {(library.sprintCards ?? []).length ? <div className="mobile-sprint-list">{(library.sprintCards ?? []).slice(0, 4).map((card) => <article key={card.id}><strong>{card.netWords > 0 ? '+' : ''}{card.netWords} 字</strong><span>{card.participantLabel} · {Math.round(card.activeDurationMs / 60_000)} 分钟</span><small>{formatTime(card.endedAt)} · 仅结果，不含正文</small></article>)}</div> : <MobileEmpty icon={<Flag size={19}/>} title="尚无冲刺成果" text="桌面端完成安静冲刺后，可在这里只读查看结果。"/>}
    </section>
    <footer className="mobile-footer">数据默认留在本机 · 不会自动改写书稿或正典</footer>

    {reader && <div className="mobile-reader" role="dialog" aria-modal="true" aria-label={`阅读 ${reader.title}`}>
      <header><button aria-label="返回首页" onClick={() => setReader(null)}><ArrowLeft size={21}/></button><div><small>{reader.projectTitle}</small><strong>{reader.title}</strong></div></header>
      <div className="mobile-reader-meta"><span>{provenanceText(reader.provenanceLabel)}</span><time>版本更新于 {formatTime(reader.updatedAt)}</time></div>
      <article>{reader.plainText ? reader.plainText.split(/\n+/).map((paragraph, index) => <p key={index}>{paragraph}</p>) : <p className="muted">这个场景还没有正文。</p>}</article>
      <button className="mobile-review-button" onClick={() => { setReader(null); document.getElementById('capture-title')?.scrollIntoView({ behavior: 'smooth' }) }}><Lightbulb size={17}/>写审阅笔记</button>
    </div>}
  </main>
}

function MobileEmpty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div className="mobile-empty"><span>{icon}</span><strong>{title}</strong><p>{text}</p></div> }
function formatTime(value: string) { if (!value) return '未缓存'; return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
function provenanceText(label: MobileLibraryScene['provenanceLabel']) { return ({ human: '纯人工', ai_accepted: '采纳 AI 后', human_after_ai: '人工修订 AI', import: '导入', restore: '恢复版本', merge: '同步合并' } as const)[label ?? 'human'] }
