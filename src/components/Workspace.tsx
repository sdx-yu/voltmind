import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowLeft, BookOpenText, Boxes, CloudCog, Ellipsis, Feather, FilePenLine, Fingerprint, GalleryHorizontalEnd, MessageSquareText, PackageOpen, PanelLeft, PanelRight, RotateCcw, Search, Settings, Share2, TimerReset, Trash2, Volume2, Waypoints } from 'lucide-react'
import type { Entity, ManuscriptNode, Project, SceneDocument } from '../../shared/types'
import { readChrome, writeChrome, type ChromeView } from '../lib/chrome'
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
import { RevisionWorkspace } from './RevisionWorkspace'
import { ReadAloudPanel } from './ReadAloudPanel'
import { ReviewWorkspace } from './ReviewWorkspace'
import { SearchModal } from './SearchModal'
import { SettingsModal } from './SettingsModal'
import { SplitSceneDialog } from './SplitSceneDialog'
import { SprintWorkspace } from './SprintWorkspace'
import { SyncWorkspace } from './SyncWorkspace'
import { TemplateWorkspace } from './TemplateWorkspace'
import { VisualWorkspace } from './VisualWorkspace'
import { WritingEditor } from './WritingEditor'
import { CommandPalette, Drawer, DropdownMenu, EditorTemplate, IconButton, type CommandItem } from '../ui'

type PrimaryMode = 'write' | 'plan' | 'canon' | 'revision' | 'deliver'

export function Workspace({ project, initialView, onBack, notify }: { project: Project; initialView?: 'write' | 'template'; onBack: () => void; notify: (type: 'success' | 'error', message: string) => void }) {
  const storedChrome = useMemo(() => readChrome(), [])
  const [view, setView] = useState<ChromeView>(initialView ?? storedChrome.view)
  const [returnView, setReturnView] = useState<ChromeView>(storedChrome.view === 'sync' ? 'write' : storedChrome.view)
  const [nodes, setNodes] = useState<ManuscriptNode[]>([])
  const [entities, setEntities] = useState<Entity[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [treeOpen, setTreeOpen] = useState(storedChrome.tree)
  const [inspectorOpen, setInspectorOpen] = useState(storedChrome.inspector)
  const [treeWidth, setTreeWidth] = useState(storedChrome.treeWidth)
  const [inspectorWidth, setInspectorWidth] = useState(storedChrome.inspectorWidth)
  const [resizing, setResizing] = useState<'tree' | 'inspector' | null>(null)
  const [compactLayout, setCompactLayout] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches)
  const [singleLayout, setSingleLayout] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches)
  const [treeDrawerOpen, setTreeDrawerOpen] = useState(false)
  const [inspectorDrawerOpen, setInspectorDrawerOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [replaceMode, setReplaceMode] = useState(false)
  const [settings, setSettings] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
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
  const showTree = !focusMode && treeOpen && !singleLayout
  const showReadAloud = !focusMode && view === 'write' && readAloudOpen
  const inspectorAvailable = !focusMode && view === 'write' && inspectorOpen && !readAloudOpen && Boolean(selectedNode)
  const showInspector = inspectorAvailable && !compactLayout
  const inspectorDrawer = inspectorAvailable && compactLayout && inspectorDrawerOpen

  async function refreshTree() {
    const next = await api.listNodes(project.id)
    setNodes(next)
    if (!selectedId || !next.some((node) => node.id === selectedId && node.type === 'scene')) setSelectedId(next.find((node) => node.type === 'scene')?.id ?? null)
  }
  async function refreshEntities() { setEntities(await api.listEntities(project.id)) }
  useEffect(() => { setLoading(true); void Promise.all([refreshTree(), refreshEntities()]).catch((error) => notify('error', error instanceof Error ? error.message : '项目加载失败')).finally(() => setLoading(false)) }, [project.id])
  useEffect(() => writeChrome({ tree: treeOpen, inspector: inspectorOpen, treeWidth, inspectorWidth, view }), [treeOpen, inspectorOpen, treeWidth, inspectorWidth, view])
  useEffect(() => {
    const compactMedia = window.matchMedia('(max-width: 1279px)')
    const singleMedia = window.matchMedia('(max-width: 1023px)')
    const sync = () => {
      setCompactLayout(compactMedia.matches)
      setSingleLayout(singleMedia.matches)
      if (!compactMedia.matches) setInspectorDrawerOpen(false)
      if (!singleMedia.matches) setTreeDrawerOpen(false)
    }
    sync()
    compactMedia.addEventListener('change', sync)
    singleMedia.addEventListener('change', sync)
    return () => { compactMedia.removeEventListener('change', sync); singleMedia.removeEventListener('change', sync) }
  }, [])
  useEffect(() => {
    if (focusMode) setReadAloudOpen(false)
  }, [focusMode])

  function persistTree(open: boolean) { setTreeOpen(open) }
  function persistInspector(open: boolean) { setInspectorOpen(open); if (open) setReadAloudOpen(false) }
  function toggleTree() { if (singleLayout) { setTreeOpen(true); setTreeDrawerOpen((open) => !open) } else persistTree(!treeOpen) }
  function toggleInspector() { if (compactLayout) { setInspectorOpen(true); setInspectorDrawerOpen((open) => !open); setReadAloudOpen(false) } else persistInspector(!inspectorOpen) }
  function enterFocus(value: boolean) {
    setFocusMode(value)
    if (value) setReadAloudOpen(false)
  }
  function navigate(next: ChromeView) {
    if (next === 'sync') setReturnView(view === 'sync' ? returnView : view)
    setView(next)
  }
  function handleCommand(command: AppCommand) {
    if (command === 'search') { setReplaceMode(false); setSearching(true) }
    if (command === 'replace') { setReplaceMode(true); setSearching(true) }
    if (command === 'settings') { setSettingsTab('ai'); setSettings(true) }
    if (command === 'help') { setSettingsTab('help'); setSettings(true) }
    if (command === 'focus' && view === 'write') enterFocus(!focusMode)
    if (command === 'toggle-tree') toggleTree()
    if (command === 'toggle-inspector') toggleInspector()
    if (command === 'read-aloud' && view === 'write') setReadAloudOpen((value) => !value)
    if (command === 'trash') void openTrash()
    if (command === 'bookshelf') onBack()
    if (command === 'command-palette') setPaletteOpen(true)
    if (command === 'view-write') navigate('write')
    if (command === 'view-plot' || command === 'view-plan') navigate('plot')
    if (command === 'view-canon') navigate('canon')
    if (command === 'view-revision') navigate('revision')
    if (command === 'view-deliver') navigate('deliver')
    if (command === 'view-provenance') navigate('provenance')
    if (command === 'view-sync') navigate('sync')
    if (command === 'view-review') navigate('review')
    if (command === 'view-sprint') navigate('sprint')
    if (command === 'view-template') navigate('template')
    if (command === 'view-visual') navigate('visual')
  }
  const handleCommandRef = useRef<(command: AppCommand) => void>(() => undefined)
  handleCommandRef.current = handleCommand
  useEffect(() => onCommand((command) => handleCommandRef.current(command)), [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isComposingKey(event)) return
      const command = shortcutCommand(event)
      if (!command) return
      if (isEditableTarget(event.target) && !['search', 'replace', 'settings', 'focus', 'command-palette'].includes(command) && !command.startsWith('view-')) return
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
  function selectScene(id: string) { setSelectedId(id); navigate('write') }
  function beginResize(side: 'tree' | 'inspector', event: ReactPointerEvent<HTMLButtonElement>) {
    const startX = event.clientX
    const startWidth = side === 'tree' ? treeWidth : inspectorWidth
    setResizing(side)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const move = (next: PointerEvent) => {
      const delta = side === 'tree' ? next.clientX - startX : startX - next.clientX
      const width = Math.round(startWidth + delta)
      if (side === 'tree') setTreeWidth(clampWidth(width, 220, 360))
      else setInspectorWidth(clampWidth(width, 280, 420))
    }
    const stop = () => {
      setResizing(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }
  function resizeWithKeyboard(side: 'tree' | 'inspector', event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const minimum = side === 'tree' ? 220 : 280
    const maximum = side === 'tree' ? 360 : 420
    const current = side === 'tree' ? treeWidth : inspectorWidth
    const direction = side === 'tree' ? 1 : -1
    const next = event.key === 'Home' ? minimum : event.key === 'End' ? maximum : current + (event.key === 'ArrowRight' ? 12 * direction : -12 * direction)
    if (side === 'tree') setTreeWidth(clampWidth(next, minimum, maximum))
    else setInspectorWidth(clampWidth(next, minimum, maximum))
  }

  const activeMode = modeForView(view === 'sync' ? returnView : view)
  const paletteItems: CommandItem[] = [
    { id: 'write', title: '打开写作台', description: '正文、书稿树与场景检查器', section: '工作模式', shortcut: '⌘1', icon: <Feather size={17} />, keywords: ['正文', '编辑'], onSelect: () => navigate('write') },
    { id: 'plan', title: '打开规划', description: '情节卡、结构模板与视觉故事板', section: '工作模式', shortcut: '⌘2', icon: <Waypoints size={17} />, keywords: ['剧情', '故事板'], onSelect: () => navigate('plot') },
    { id: 'canon', title: '打开正典', description: '人物、地点、物品与关系', section: '工作模式', shortcut: '⌘3', icon: <Boxes size={17} />, onSelect: () => navigate('canon') },
    { id: 'revision', title: '打开修订台', description: '连续性、审阅任务与创作来源', section: '工作模式', shortcut: '⌘4', icon: <FilePenLine size={17} />, keywords: ['审阅', '来源'], onSelect: () => navigate('revision') },
    { id: 'deliver', title: '打开交付台', description: '规则检查、导出与备份', section: '工作模式', shortcut: '⌘5', icon: <Share2 size={17} />, onSelect: () => navigate('deliver') },
    { id: 'sprint', title: '安静冲刺', description: '开始一次有本地证据的专注写作', section: '写作', icon: <TimerReset size={17} />, onSelect: () => navigate('sprint') },
    { id: 'visual', title: '视觉故事板', description: '把画面作为文字正典的候选锚点', section: '规划', icon: <GalleryHorizontalEnd size={17} />, onSelect: () => navigate('visual') },
    { id: 'template', title: '结构模板', description: '预览并安装本地结构目录', section: '规划', icon: <PackageOpen size={17} />, onSelect: () => navigate('template') },
    { id: 'review', title: '角色化审阅', description: '处理隔离的审阅任务包', section: '修订', icon: <MessageSquareText size={17} />, onSelect: () => navigate('review') },
    { id: 'provenance', title: '创作来源', description: '查看版本来源、哈希与接受关系', section: '修订', icon: <Fingerprint size={17} />, onSelect: () => navigate('provenance') },
    { id: 'search', title: '搜索书稿', description: '查找当前项目里的文字和场景', section: '全局工具', shortcut: '⌘F', icon: <Search size={17} />, onSelect: () => { setReplaceMode(false); setSearching(true) } },
    { id: 'sync', title: '加密接力', description: '在设备间导出或恢复加密接力包', section: '全局工具', icon: <CloudCog size={17} />, onSelect: () => navigate('sync') },
    { id: 'settings', title: '设置', description: 'AI、目标、显示与帮助', section: '全局工具', shortcut: '⌘,', icon: <Settings size={17} />, onSelect: () => { setSettingsTab('ai'); setSettings(true) } },
  ]

  if (loading) return <div className="workspace-loading"><span className="brand-mark">笔</span><p>正在打开故事…</p></div>
  const workspaceStyle = { '--workspace-tree-width': `${treeWidth}px`, '--workspace-inspector-width': `${inspectorWidth}px` } as CSSProperties
  return <div className={`workspace ${focusMode ? 'workspace-focus' : ''} ${singleLayout ? 'workspace-narrow' : ''}`} style={workspaceStyle}>
    {!focusMode && <header className="workspace-topbar">
      <div className="workspace-title">
        <IconButton label="返回书架" onClick={onBack}><ArrowLeft size={18} /></IconButton>
        <span className="mini-brand">笔</span>
        <div><strong>{project.title}</strong><small>已保存在本机</small></div>
      </div>
      <nav className="main-nav" aria-label="主要工作台">
        <button aria-label="写作" className={activeMode === 'write' ? 'active' : ''} onClick={() => navigate('write')}><Feather size={16} /><span className="nav-label">写作</span></button>
        <button aria-label="规划" className={activeMode === 'plan' ? 'active' : ''} onClick={() => navigate('plot')}><Waypoints size={16} /><span className="nav-label">规划</span></button>
        <button aria-label="正典" className={activeMode === 'canon' ? 'active' : ''} onClick={() => navigate('canon')}><Boxes size={16} /><span className="nav-label">正典</span></button>
        <button aria-label="修订" className={activeMode === 'revision' ? 'active' : ''} onClick={() => navigate('revision')}><FilePenLine size={16} /><span className="nav-label">修订</span></button>
        <button aria-label="交付" className={activeMode === 'deliver' ? 'active' : ''} onClick={() => navigate('deliver')}><Share2 size={16} /><span className="nav-label">交付</span></button>
      </nav>
      <div className="topbar-actions">
        <div className="topbar-action-group topbar-action-context">
          {view === 'write' && <>
            <IconButton selected={singleLayout ? treeDrawerOpen : treeOpen} onClick={toggleTree} label={singleLayout ? '打开书稿树' : treeOpen ? '隐藏书稿树' : '显示书稿树'}><PanelLeft size={18} /></IconButton>
            <IconButton selected={compactLayout ? inspectorDrawerOpen : inspectorOpen && !readAloudOpen} onClick={toggleInspector} label={compactLayout ? '打开检查器' : inspectorOpen ? '隐藏检查器' : '显示检查器'}><PanelRight size={18} /></IconButton>
            <IconButton selected={readAloudOpen} onClick={() => setReadAloudOpen((value) => !value)} label="本地朗读"><Volume2 size={18} /></IconButton>
            <IconButton onClick={() => navigate('sprint')} label="安静冲刺"><TimerReset size={18} /></IconButton>
          </>}
          {activeMode === 'plan' && <><IconButton selected={view === 'visual'} onClick={() => navigate('visual')} label="视觉故事板"><GalleryHorizontalEnd size={18} /></IconButton><IconButton selected={view === 'template'} onClick={() => navigate('template')} label="结构模板"><PackageOpen size={18} /></IconButton></>}
          {activeMode === 'revision' && <><IconButton selected={view === 'review'} onClick={() => navigate('review')} label="角色化审阅"><MessageSquareText size={18} /></IconButton><IconButton selected={view === 'provenance'} onClick={() => navigate('provenance')} label="创作来源"><Fingerprint size={18} /></IconButton></>}
        </div>
        <div className="topbar-action-group topbar-action-global">
          <IconButton onClick={() => setPaletteOpen(true)} label="打开命令面板" tooltip="打开命令面板（⌘K）"><Search size={18} /></IconButton>
          <IconButton selected={view === 'sync'} onClick={() => navigate('sync')} label="加密接力"><CloudCog size={18} /></IconButton>
          <IconButton onClick={() => { setSettingsTab('ai'); setSettings(true) }} label="设置"><Settings size={18} /></IconButton>
          <DropdownMenu label="项目更多操作" trigger={<IconButton label="项目更多操作"><Ellipsis size={18} /></IconButton>} items={[
            { id: 'search', label: '搜索书稿', icon: <Search size={15} />, hint: '⌘F', onSelect: () => { setReplaceMode(false); setSearching(true) } },
            { id: 'trash', label: '项目回收站', icon: <Trash2 size={15} />, onSelect: () => void openTrash() },
            { id: 'help', label: '帮助与恢复', icon: <BookOpenText size={15} />, onSelect: () => { setSettingsTab('help'); setSettings(true) } },
            { id: 'bookshelf', label: '返回书架', icon: <ArrowLeft size={15} />, onSelect: onBack },
          ]} />
        </div>
      </div>
    </header>}

    {view === 'write' && <EditorTemplate
      className="writing-layout"
      navigation={showTree ? <ManuscriptTree nodes={nodes} selectedId={selectedId} onSelect={setSelectedId} onCreateVolume={() => void createVolume()} onCreateChapter={(parentId) => void createChapter(parentId)} onCreateScene={(id) => void createScene(id)} onUpdate={(id, patch) => void updateNode(id, patch)} onTrash={setPendingTrash} onSplit={(node) => void openSplit(node)} onMerge={setPendingMerge} onSearch={() => { setReplaceMode(false); setSearching(true) }} /> : undefined}
      navigationResizer={showTree ? <button className={`ui-pane-resizer ui-pane-resizer-left${resizing === 'tree' ? ' is-resizing' : ''}`} type="button" role="separator" aria-label="调整书稿树宽度" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={360} aria-valuenow={treeWidth} onPointerDown={(event) => beginResize('tree', event)} onKeyDown={(event) => resizeWithKeyboard('tree', event)} /> : undefined}
      content={selectedNode ? <WritingEditor key={`${selectedNode.id}:${editorEpoch}`} node={selectedNode} focusMode={focusMode} onFocusMode={enterFocus} onSaved={onSaved} notify={notify} /> : <div className="no-scene"><BookOpenText size={28} /><h2>选择一个场景</h2><button className="button primary" onClick={() => void createChapter()}>新建章节</button></div>}
      details={showReadAloud && !compactLayout ? <ReadAloudPanel projectId={project.id} nodes={nodes} currentNodeId={selectedId} onClose={() => setReadAloudOpen(false)} onSelectScene={selectScene} notify={notify} /> : showInspector && selectedNode ? <Inspector projectId={project.id} node={selectedNode} entities={entities} refreshEntities={refreshEntities} onUpdateNode={async (patch) => updateNode(selectedNode.id, patch)} onRefreshTree={refreshTree} onReloadScene={() => setEditorEpoch((value) => value + 1)} notify={notify} /> : undefined}
      detailsResizer={(showReadAloud || showInspector) && !compactLayout ? <button className={`ui-pane-resizer ui-pane-resizer-right${resizing === 'inspector' ? ' is-resizing' : ''}`} type="button" role="separator" aria-label="调整辅助面板宽度" aria-orientation="vertical" aria-valuemin={280} aria-valuemax={420} aria-valuenow={inspectorWidth} onPointerDown={(event) => beginResize('inspector', event)} onKeyDown={(event) => resizeWithKeyboard('inspector', event)} /> : undefined}
    />}
    <Drawer className="ui-template-drawer" side="left" title="书稿结构" description="选择章节或场景" open={view === 'write' && singleLayout && treeDrawerOpen} onOpenChange={setTreeDrawerOpen}><div className="ui-template-drawer-content"><ManuscriptTree nodes={nodes} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setTreeDrawerOpen(false) }} onCreateVolume={() => void createVolume()} onCreateChapter={(parentId) => void createChapter(parentId)} onCreateScene={(id) => void createScene(id)} onUpdate={(id, patch) => void updateNode(id, patch)} onTrash={setPendingTrash} onSplit={(node) => void openSplit(node)} onMerge={setPendingMerge} onSearch={() => { setTreeDrawerOpen(false); setReplaceMode(false); setSearching(true) }} /></div></Drawer>
    {selectedNode && <Drawer className="ui-template-drawer" title="场景检查器" description={selectedNode.title} open={inspectorDrawer} onOpenChange={setInspectorDrawerOpen}><div className="ui-template-drawer-content"><Inspector projectId={project.id} node={selectedNode} entities={entities} refreshEntities={refreshEntities} onUpdateNode={async (patch) => updateNode(selectedNode.id, patch)} onRefreshTree={refreshTree} onReloadScene={() => setEditorEpoch((value) => value + 1)} notify={notify} /></div></Drawer>}
    <Drawer className="ui-template-drawer" title="本地朗读" description="只在本机播放" open={view === 'write' && compactLayout && readAloudOpen} onOpenChange={setReadAloudOpen}><div className="ui-template-drawer-content"><ReadAloudPanel projectId={project.id} nodes={nodes} currentNodeId={selectedId} onClose={() => setReadAloudOpen(false)} onSelectScene={selectScene} notify={notify} /></div></Drawer>

    {view === 'plot' && <PlotWorkspace projectId={project.id} nodes={nodes} entities={entities} onSelectScene={selectScene} notify={notify} />}
    {view === 'canon' && <CanonWorkspace projectId={project.id} entities={entities} nodes={nodes} refresh={refreshEntities} onSelectScene={selectScene} notify={notify} />}
    {view === 'revision' && <RevisionWorkspace nodes={nodes} onOpenTool={(tool) => navigate(tool)} />}
    {view === 'deliver' && <DeliveryWorkspace project={project} nodes={nodes} onSelectScene={selectScene} notify={notify} />}
    {view === 'provenance' && <ProvenanceWorkspace project={project} nodes={nodes} onSelectScene={selectScene} onBack={() => navigate('revision')} notify={notify} />}
    {view === 'sync' && <SyncWorkspace project={project} onSynced={async () => { await Promise.all([refreshTree(), refreshEntities()]); setEditorEpoch((value) => value + 1) }} onBack={() => navigate(returnView === 'sync' ? 'write' : returnView)} notify={notify} />}
    {view === 'review' && <ReviewWorkspace project={project} nodes={nodes} onSelectScene={selectScene} onChanged={async () => { await refreshTree(); setEditorEpoch((value) => value + 1) }} onBack={() => navigate('revision')} notify={notify} />}
    {view === 'sprint' && <SprintWorkspace project={project} nodes={nodes} activeSceneId={selectedId} onOpenScene={(id) => { setSelectedId(id); setFocusMode(true); navigate('write') }} onBack={() => navigate('write')} notify={notify} />}
    {view === 'template' && <TemplateWorkspace project={project} onChanged={refreshTree} onBack={() => navigate('plot')} notify={notify} />}
    {view === 'visual' && <VisualWorkspace project={project} nodes={nodes} entities={entities} onBack={() => navigate('plot')} notify={notify} />}
    {view === 'write' && <SprintWorkspace project={project} nodes={nodes} activeSceneId={selectedId} compact onOpenScene={selectScene} onOpenDetails={() => { setFocusMode(false); navigate('sprint') }} notify={notify} />}
    {searching && <SearchModal projectId={project.id} initialMode={replaceMode ? 'replace' : 'search'} onClose={() => setSearching(false)} onSelect={selectScene} onChanged={async () => { await Promise.all([refreshTree(), refreshEntities()]); setEditorEpoch((value) => value + 1) }} notify={notify} />}
    {settings && <SettingsModal projectId={project.id} initialTab={settingsTab} onClose={() => setSettings(false)} onOpenTool={(tool) => { setSettings(false); navigate(tool) }} notify={notify} />}
    <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={paletteItems} title="项目命令" placeholder="搜索模式、工具或动作…" />
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
  if (key === 'k') return 'command-palette'
  if (key === 'f') return event.shiftKey ? 'replace' : 'search'
  if (key === ',') return 'settings'
  if (key === '1') return 'view-write'
  if (key === '2') return 'view-plot'
  if (key === '3') return 'view-canon'
  if (key === '4') return 'view-revision'
  if (key === '5') return 'view-deliver'
  if (key === '\\') return 'toggle-tree'
  if (key === 'i' && event.shiftKey) return 'toggle-inspector'
  if (key === '.' && event.shiftKey) return 'focus'
  return null
}

function modeForView(view: ChromeView): PrimaryMode {
  if (view === 'write' || view === 'sprint') return 'write'
  if (view === 'plot' || view === 'template' || view === 'visual') return 'plan'
  if (view === 'canon') return 'canon'
  if (view === 'revision' || view === 'review' || view === 'provenance') return 'revision'
  return 'deliver'
}

function clampWidth(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}
