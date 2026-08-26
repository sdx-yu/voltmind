import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BookOpenText, Boxes, Feather, LayoutGrid, PanelLeft, PanelRight, RotateCcw, Search, Settings, Share2, Trash2, Volume2 } from 'lucide-react'
import type { Entity, ManuscriptNode, Project, SceneDocument } from '../../shared/types'
import { readChrome, writeChrome } from '../lib/chrome'
import { isComposingKey, isEditableTarget, matchMod, onCommand, type AppCommand } from '../lib/commands'
import { api } from '../lib/api'
import { CanonWorkspace } from './CanonWorkspace'
import { ConfirmDialog } from './ConfirmDialog'
import { DeliveryWorkspace } from './DeliveryWorkspace'
import { Inspector } from './Inspector'
import { ManuscriptTree } from './ManuscriptTree'
import { Modal } from './Modal'
import { PlotWorkspace } from './PlotWorkspace'
import { ProvenanceWorkspace } from './ProvenanceWorkspace'
import { ReadAloudPanel } from './ReadAloudPanel'
import { SearchModal } from './SearchModal'
import { SettingsModal } from './SettingsModal'
import { SplitSceneDialog } from './SplitSceneDialog'
import { SyncWorkspace } from './SyncWorkspace'
import { WritingEditor } from './WritingEditor'

type View = 'write' | 'plot' | 'canon' | 'deliver' | 'provenance' | 'sync'

export function Workspace({ project, onBack, notify }: { project: Project; onBack: () => void; notify: (type: 'success' | 'error', message: string) => void }) {
  const storedChrome = readChrome()
  const [view, setView] = useState<View>('write')
  const [nodes, setNodes] = useState<ManuscriptNode[]>([])
  const [entities, setEntities] = useState<Entity[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [treeOpen, setTreeOpen] = useState(storedChrome.tree)
  const [inspectorOpen, setInspectorOpen] = useState(storedChrome.inspector)
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1100px)').matches)
  const [searching, setSearching] = useState(false)
  const [replaceMode, setReplaceMode] = useState(false)
  const [settings, setSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'ai' | 'goals' | 'display' | 'help'>('ai')
  const [loading, setLoading] = useState(true)
  const [trashOpen, setTrashOpen] = useState(false)
  const [deletedNodes, setDeletedNodes] = useState<ManuscriptNode[]>([])
  const [deletedEntities, setDeletedEntities] = useState<Entity[]>([])
  const [editorEpoch, setEditorEpoch] = useState(0)
  const [restoreParents, setRestoreParents] = useState<Record<string, string>>({})
  const [readAloudOpen, setReadAloudOpen] = useState(false)
  const [pendingTrash, setPendingTrash] = useState<ManuscriptNode | null>(null)
  const [pendingMerge, setPendingMerge] = useState<ManuscriptNode | null>(null)
  const [pendingSplit, setPendingSplit] = useState<{ node: ManuscriptNode; document: SceneDocument } | null>(null)
  const [sheetBusy, setSheetBusy] = useState(false)
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedId) ?? null, [nodes, selectedId])
  const showTree = !focusMode && treeOpen
  const showReadAloud = !focusMode && view === 'write' && readAloudOpen
  const showInspector = !focusMode && view === 'write' && inspectorOpen && !readAloudOpen && Boolean(selectedNode)
  const inspectorDrawer = showInspector && narrow

  async function refreshTree() {
    const next = await api.listNodes(project.id)
    setNodes(next)
    if (!selectedId || !next.some((node) => node.id === selectedId && node.type === 'scene')) setSelectedId(next.find((node) => node.type === 'scene')?.id ?? null)
  }
  async function refreshEntities() { setEntities(await api.listEntities(project.id)) }
  useEffect(() => { setLoading(true); void Promise.all([refreshTree(), refreshEntities()]).catch((error) => notify('error', error instanceof Error ? error.message : '项目加载失败')).finally(() => setLoading(false)) }, [project.id])
  useEffect(() => writeChrome({ tree: treeOpen, inspector: inspectorOpen }), [treeOpen, inspectorOpen])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1100px)')
    const sync = () => {
      setNarrow(media.matches)
      if (media.matches) setInspectorOpen(false)
    }
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  useEffect(() => {
    if (focusMode) setReadAloudOpen(false)
  }, [focusMode])

  function persistTree(open: boolean) { setTreeOpen(open) }
  function persistInspector(open: boolean) { setInspectorOpen(open); if (open) setReadAloudOpen(false) }
  function enterFocus(value: boolean) {
    setFocusMode(value)
    if (value) setReadAloudOpen(false)
  }
  function handleCommand(command: AppCommand) {
    if (command === 'search') { setReplaceMode(false); setSearching(true) }
    if (command === 'replace') { setReplaceMode(true); setSearching(true) }
    if (command === 'settings') { setSettingsTab('ai'); setSettings(true) }
    if (command === 'help') { setSettingsTab('help'); setSettings(true) }
    if (command === 'focus' && view === 'write') enterFocus(!focusMode)
    if (command === 'toggle-tree') persistTree(!treeOpen)
    if (command === 'toggle-inspector') persistInspector(!inspectorOpen)
    if (command === 'read-aloud' && view === 'write') setReadAloudOpen((value) => !value)
    if (command === 'trash') void openTrash()
    if (command === 'bookshelf') onBack()
    if (command === 'view-write') setView('write')
    if (command === 'view-plot') setView('plot')
    if (command === 'view-canon') setView('canon')
    if (command === 'view-deliver') setView('deliver')
    if (command === 'view-provenance') setView('provenance')
    if (command === 'view-sync') setView('sync')
  }
  const handleCommandRef = useRef<(command: AppCommand) => void>(() => undefined)
  handleCommandRef.current = handleCommand
  useEffect(() => onCommand((command) => handleCommandRef.current(command)), [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isComposingKey(event)) return
      const command = shortcutCommand(event)
      if (!command) return
      if (isEditableTarget(event.target) && !['search', 'replace', 'settings', 'focus'].includes(command) && !command.startsWith('view-')) return
      event.preventDefault()
      handleCommandRef.current(command)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function createVolume() { const book = nodes.find((node) => node.type === 'book'); if (!book) return; try { await api.createNode(project.id, { parentId: book.id, type: 'volume', title: `第 ${nodes.filter((node) => node.type === 'volume').length + 1} 卷` }); await refreshTree() } catch (error) { notify('error', error instanceof Error ? error.message : '卷创建失败') } }
  async function createChapter(parentId?: string) {
    const book = nodes.find((node) => node.type === 'book')
    if (!book) return
    try { const chapter = await api.createNode(project.id, { parentId: parentId ?? book.id, type: 'chapter', title: `第 ${nodes.filter((node) => node.type === 'chapter').length + 1} 章` }); const scene = await api.createNode(project.id, { parentId: chapter.id, type: 'scene', title: '场景 1' }); await refreshTree(); setSelectedId(scene.id) }
    catch (error) { notify('error', error instanceof Error ? error.message : '章节创建失败') }
  }
  async function createScene(chapterId: string) { try { const siblings = nodes.filter((node) => node.parentId === chapterId && node.type === 'scene'); const scene = await api.createNode(project.id, { parentId: chapterId, type: 'scene', title: `场景 ${siblings.length + 1}` }); await refreshTree(); setSelectedId(scene.id) } catch (error) { notify('error', error instanceof Error ? error.message : '场景创建失败') } }
  async function updateNode(id: string, patch: Partial<ManuscriptNode>) { try { await api.updateNode(id, patch); await refreshTree() } catch (error) { notify('error', error instanceof Error ? error.message : '更新失败') } }
  async function confirmTrash() {
    if (!pendingTrash) return
    setSheetBusy(true)
    try { await api.trashNode(pendingTrash.id); await refreshTree(); notify('success', '已移入回收站，可从项目数据中恢复'); setPendingTrash(null) }
    catch (error) { notify('error', error instanceof Error ? error.message : '删除失败') }
    finally { setSheetBusy(false) }
  }
  async function openSplit(node: ManuscriptNode) {
    try { setPendingSplit({ node, document: await api.getScene(node.id) }) }
    catch (error) { notify('error', error instanceof Error ? error.message : '场景加载失败') }
  }
  async function confirmSplit(offset: number) {
    if (!pendingSplit) return
    setSheetBusy(true)
    try { await api.splitScene(pendingSplit.node.id, offset); await refreshTree(); setEditorEpoch((value) => value + 1); notify('success', '场景已拆分，原场景保留版本记录'); setPendingSplit(null) }
    catch (error) { notify('error', error instanceof Error ? error.message : '拆分失败') }
    finally { setSheetBusy(false) }
  }
  async function confirmMerge() {
    if (!pendingMerge) return
    setSheetBusy(true)
    try { await api.mergeNextScene(pendingMerge.id); await refreshTree(); setEditorEpoch((value) => value + 1); notify('success', '已合并；原正文有版本记录，下一场景可从回收站恢复'); setPendingMerge(null) }
    catch (error) { notify('error', error instanceof Error ? error.message : '合并失败') }
    finally { setSheetBusy(false) }
  }
  async function openTrash() { const [allNodes, allEntities] = await Promise.all([api.listNodes(project.id, true), api.listEntities(project.id, true)]); setDeletedNodes(allNodes.filter((node) => node.deletedAt)); setDeletedEntities(allEntities.filter((entity) => entity.deletedAt)); setTrashOpen(true) }
  async function restoreNode(node: ManuscriptNode) { const parentId = restoreParents[node.id] || node.parentId; await api.restoreNode(node.id, parentId); await refreshTree(); setDeletedNodes((await api.listNodes(project.id, true)).filter((item) => item.deletedAt)); notify('success', parentId === node.parentId ? '书稿节点及其下级内容已恢复到原位置' : '书稿节点已恢复到所选新位置') }
  async function restoreEntity(id: string) { await api.restoreEntity(id); setDeletedEntities((current) => current.filter((entity) => entity.id !== id)); await refreshEntities(); notify('success', '正典项已恢复') }
  function onSaved(_document: SceneDocument, wordCount: number) { setNodes((current) => current.map((node) => node.id === selectedId ? { ...node, wordCount } : node)) }
  function selectScene(id: string) { setSelectedId(id); setView('write') }

  if (loading) return <div className="workspace-loading"><span className="brand-mark">笔</span><p>正在打开故事…</p></div>
  const writingColumns = [
    showTree ? 'tree' : '',
    'paper',
    showReadAloud || (showInspector && !inspectorDrawer) ? 'side' : '',
  ].filter(Boolean).join('-')

  return <div className={`workspace ${focusMode ? 'workspace-focus' : ''} ${narrow ? 'workspace-narrow' : ''}`}>
    {!focusMode && <header className="workspace-topbar">
      <div className="workspace-title">
        <button className="icon-button" onClick={onBack} aria-label="返回书架"><ArrowLeft size={18} /></button>
        <span className="mini-brand">笔</span>
        <div><strong>{project.title}</strong><small>已保存在本机</small></div>
      </div>
      <nav className="main-nav" aria-label="主要工作台">
        <button className={view === 'write' ? 'active' : ''} onClick={() => setView('write')}><Feather size={16} />写作</button>
        <button className={view === 'plot' ? 'active' : ''} onClick={() => setView('plot')}><LayoutGrid size={16} />剧情</button>
        <button className={view === 'canon' ? 'active' : ''} onClick={() => setView('canon')}><Boxes size={16} />正典</button>
        <button className={view === 'deliver' || view === 'provenance' || view === 'sync' ? 'active' : ''} onClick={() => setView('deliver')}><Share2 size={16} />交付</button>
      </nav>
      <div className="topbar-actions">
        {view === 'write' && <>
          <button className={`icon-button ${treeOpen ? 'active' : ''}`} onClick={() => persistTree(!treeOpen)} aria-label={treeOpen ? '隐藏书稿树' : '显示书稿树'} aria-pressed={treeOpen}><PanelLeft size={18} /></button>
          <button className={`icon-button ${inspectorOpen && !readAloudOpen ? 'active' : ''}`} onClick={() => persistInspector(!inspectorOpen)} aria-label={inspectorOpen ? '隐藏检查器' : '显示检查器'} aria-pressed={inspectorOpen}><PanelRight size={18} /></button>
          <button className={`icon-button ${readAloudOpen ? 'active' : ''}`} onClick={() => setReadAloudOpen((value) => !value)} aria-label="本地朗读" aria-pressed={readAloudOpen}><Volume2 size={18} /></button>
        </>}
        <button className="icon-button" onClick={() => { setReplaceMode(false); setSearching(true) }} aria-label="搜索"><Search size={18} /></button>
        <button className="icon-button" onClick={() => void openTrash()} aria-label="项目回收站"><Trash2 size={17} /></button>
        <button className="icon-button" onClick={() => { setSettingsTab('ai'); setSettings(true) }} aria-label="设置"><Settings size={18} /></button>
      </div>
    </header>}

    {view === 'write' && <div className={`writing-layout columns-${writingColumns}`}>
      {showTree && <ManuscriptTree nodes={nodes} selectedId={selectedId} onSelect={setSelectedId} onCreateVolume={() => void createVolume()} onCreateChapter={(parentId) => void createChapter(parentId)} onCreateScene={(id) => void createScene(id)} onUpdate={(id, patch) => void updateNode(id, patch)} onTrash={setPendingTrash} onSplit={(node) => void openSplit(node)} onMerge={setPendingMerge} onSearch={() => { setReplaceMode(false); setSearching(true) }} />}
      {selectedNode ? <WritingEditor key={`${selectedNode.id}:${editorEpoch}`} node={selectedNode} focusMode={focusMode} onFocusMode={enterFocus} onSaved={onSaved} notify={notify} /> : <div className="no-scene"><BookOpenText size={28} /><h2>选择一个场景</h2><button className="button primary" onClick={() => void createChapter()}>新建章节</button></div>}
      {showReadAloud && <ReadAloudPanel projectId={project.id} nodes={nodes} currentNodeId={selectedId} onClose={() => setReadAloudOpen(false)} onSelectScene={selectScene} notify={notify} />}
      {showInspector && !inspectorDrawer && selectedNode && <Inspector projectId={project.id} node={selectedNode} entities={entities} refreshEntities={refreshEntities} onUpdateNode={async (patch) => updateNode(selectedNode.id, patch)} onRefreshTree={refreshTree} onReloadScene={() => setEditorEpoch((value) => value + 1)} notify={notify} />}
    </div>}
    {inspectorDrawer && selectedNode && <div className="inspector-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && persistInspector(false)}>
      <Inspector projectId={project.id} node={selectedNode} entities={entities} refreshEntities={refreshEntities} onUpdateNode={async (patch) => updateNode(selectedNode.id, patch)} onRefreshTree={refreshTree} onReloadScene={() => setEditorEpoch((value) => value + 1)} notify={notify} onClose={() => persistInspector(false)} />
    </div>}

    {view === 'plot' && <PlotWorkspace projectId={project.id} nodes={nodes} entities={entities} onSelectScene={selectScene} notify={notify} />}
    {view === 'canon' && <CanonWorkspace projectId={project.id} entities={entities} nodes={nodes} refresh={refreshEntities} onSelectScene={selectScene} notify={notify} />}
    {view === 'deliver' && <DeliveryWorkspace project={project} nodes={nodes} onSelectScene={selectScene} onOpenTool={(tool) => setView(tool)} notify={notify} />}
    {view === 'provenance' && <ProvenanceWorkspace project={project} nodes={nodes} onSelectScene={selectScene} onBack={() => setView('deliver')} notify={notify} />}
    {view === 'sync' && <SyncWorkspace project={project} onSynced={async () => { await Promise.all([refreshTree(), refreshEntities()]); setEditorEpoch((value) => value + 1) }} onBack={() => setView('deliver')} notify={notify} />}
    {searching && <SearchModal projectId={project.id} initialMode={replaceMode ? 'replace' : 'search'} onClose={() => setSearching(false)} onSelect={selectScene} onChanged={async () => { await Promise.all([refreshTree(), refreshEntities()]); setEditorEpoch((value) => value + 1) }} notify={notify} />}
    {settings && <SettingsModal projectId={project.id} initialTab={settingsTab} onClose={() => setSettings(false)} onOpenTool={(tool) => { setSettings(false); setView(tool) }} notify={notify} />}
    {trashOpen && <Modal title="项目回收站" onClose={() => setTrashOpen(false)} wide><div className="trash-groups"><section><h3>书稿结构</h3>{deletedNodes.length ? <div className="trash-list">{deletedNodes.filter((node) => !node.parentId || !deletedNodes.some((parent) => parent.id === node.parentId)).map((node) => <div key={node.id}><span><strong>{node.title}</strong><small>{node.type}</small></span><select aria-label={`${node.title} 恢复位置`} value={restoreParents[node.id] ?? node.parentId ?? ''} onChange={(event) => setRestoreParents((current) => ({ ...current, [node.id]: event.target.value }))}>{restoreTargets(node, nodes).map((target) => <option key={target.id} value={target.id}>{target.title}</option>)}</select><button className="button secondary compact" onClick={() => void restoreNode(node)}><RotateCcw size={14} />恢复</button></div>)}</div> : <p className="muted">没有已删除的章节或场景。</p>}</section><section><h3>正典项</h3>{deletedEntities.length ? <div className="trash-list">{deletedEntities.map((entity) => <div key={entity.id}><span><strong>{entity.canonicalName}</strong><small>{entity.type}</small></span><button className="button secondary compact" onClick={() => void restoreEntity(entity.id)}><RotateCcw size={14} />恢复</button></div>)}</div> : <p className="muted">没有已删除的正典项。</p>}</section></div></Modal>}
    {pendingTrash && <ConfirmDialog title="移到回收站" message={`把“${pendingTrash.title}”移入回收站？之后仍可恢复。`} confirmLabel="移到回收站" danger busy={sheetBusy} onConfirm={() => void confirmTrash()} onClose={() => setPendingTrash(null)} />}
    {pendingMerge && <ConfirmDialog title="合并场景" message={`把“${pendingMerge.title}”与同章下一场景合并？下一场景将进入回收站，原正文会留下版本记录。`} confirmLabel="合并场景" busy={sheetBusy} onConfirm={() => void confirmMerge()} onClose={() => setPendingMerge(null)} />}
    {pendingSplit && <SplitSceneDialog node={pendingSplit.node} document={pendingSplit.document} busy={sheetBusy} onClose={() => setPendingSplit(null)} onSplit={(offset) => void confirmSplit(offset)} />}
  </div>
}

function restoreTargets(node: ManuscriptNode, nodes: ManuscriptNode[]) { const allowed = node.type === 'scene' ? ['chapter'] : node.type === 'chapter' ? ['book','volume'] : node.type === 'volume' ? ['book'] : []; return nodes.filter((item) => allowed.includes(item.type) && !item.deletedAt) }

function shortcutCommand(event: KeyboardEvent): AppCommand | null {
  if (!matchMod(event)) {
    if (event.key === 'F11') return 'focus'
    return null
  }
  const key = event.key.toLowerCase()
  if (key === 'f') return event.shiftKey ? 'replace' : 'search'
  if (key === ',') return 'settings'
  if (key === '1') return 'view-write'
  if (key === '2') return 'view-plot'
  if (key === '3') return 'view-canon'
  if (key === '4') return 'view-deliver'
  if (key === '\\') return 'toggle-tree'
  if (key === 'i' && event.shiftKey) return 'toggle-inspector'
  if (key === '.' && event.shiftKey) return 'focus'
  return null
}
