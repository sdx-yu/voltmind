import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { BookMarked, ChevronDown, ChevronRight, Combine, FilePlus2, FolderPlus, GripVertical, LibraryBig, MoreHorizontal, Search, Scissors, Trash2 } from 'lucide-react'
import type { ManuscriptNode } from '../../shared/types'
import { sceneStatusLabel } from '../lib/status'
import { Button, DropdownMenu, IconButton } from '../ui'

interface Props {
  nodes: ManuscriptNode[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreateVolume: () => void
  onCreateChapter: (parentId?: string) => void
  onCreateScene: (chapterId: string) => void
  onUpdate: (id: string, patch: Partial<ManuscriptNode>) => void
  onTrash: (node: ManuscriptNode) => void
  onSplit: (node: ManuscriptNode) => void
  onMerge: (node: ManuscriptNode) => void
  onSearch: () => void
}

export function ManuscriptTree({ nodes, selectedId, onSelect, onCreateVolume, onCreateChapter, onCreateScene, onUpdate, onTrash, onSplit, onMerge, onSearch }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [dragged, setDragged] = useState<ManuscriptNode | null>(null)
  const renameAfterMenuClose = useRef<string | null>(null)
  const chapters = nodes.filter((node) => node.type === 'chapter' && !node.deletedAt).sort((a, b) => a.sortKey - b.sortKey)
  const volumes = nodes.filter((node) => node.type === 'volume' && !node.deletedAt).sort((a, b) => a.sortKey - b.sortKey)
  const book = nodes.find((node) => node.type === 'book')
  const selectedNode = nodes.find((node) => node.id === selectedId && !node.deletedAt) ?? null
  const collapsibleIds = [...volumes, ...chapters].map((node) => node.id)
  const sceneOrder = useMemo(() => chapters.flatMap((chapter) => nodes.filter((node) => node.type === 'scene' && node.parentId === chapter.id && !node.deletedAt).sort((a, b) => a.sortKey - b.sortKey)), [chapters, nodes])

  function toggle(id: string) {
    setCollapsed((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  function dropOn(target: ManuscriptNode) {
    if (!dragged || dragged.id === target.id) return
    if (dragged.type === 'scene' && target.type === 'chapter') onUpdate(dragged.id, { parentId: target.id, sortKey: Date.now() })
    if (dragged.type === 'chapter' && target.type === 'volume') onUpdate(dragged.id, { parentId: target.id, sortKey: Date.now() })
    if (dragged.type === target.type && dragged.parentId === target.parentId) onUpdate(dragged.id, { sortKey: target.sortKey - 1 })
    setDragged(null)
  }
  function keyboardMove(event: KeyboardEvent, node: ManuscriptNode) {
    if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      const siblings = nodes.filter((item) => item.type === node.type && item.parentId === node.parentId && !item.deletedAt).sort((a, b) => a.sortKey - b.sortKey)
      const index = siblings.findIndex((item) => item.id === node.id); const target = siblings[index + (event.key === 'ArrowUp' ? -1 : 1)]
      if (!target) return
      event.preventDefault(); onUpdate(node.id, { sortKey: target.sortKey + (event.key === 'ArrowUp' ? -1 : 1) })
      return
    }
    if (node.type !== 'scene') return
    const index = sceneOrder.findIndex((item) => item.id === node.id)
    if (event.key === 'ArrowDown' && sceneOrder[index + 1]) { event.preventDefault(); onSelect(sceneOrder[index + 1].id) }
    if (event.key === 'ArrowUp' && sceneOrder[index - 1]) { event.preventDefault(); onSelect(sceneOrder[index - 1].id) }
    if (event.key === 'ArrowLeft' && node.parentId) { event.preventDefault(); setCollapsed((current) => new Set(current).add(node.parentId!)) }
    if (event.key === 'ArrowRight' && node.parentId && collapsed.has(node.parentId)) { event.preventDefault(); setCollapsed((current) => { const next = new Set(current); next.delete(node.parentId!); return next }) }
  }

  return <aside className="manuscript-sidebar" aria-label="书稿结构">
    <div className="sidebar-heading"><span>书稿</span><IconButton size="small" onClick={onSearch} label="全局搜索"><Search size={17} /></IconButton></div>
    <div className="tree-scroll">
      {volumes.map((volume) => {
        const childChapters = chapters.filter((chapter) => chapter.parentId === volume.id)
        return <div key={volume.id} className="tree-volume" onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(volume)}>
          <div className="tree-row volume-row">
            <button className="tree-toggle" onClick={() => toggle(volume.id)} aria-label={collapsed.has(volume.id) ? '展开卷' : '折叠卷'}>{collapsed.has(volume.id) ? <ChevronRight size={16}/> : <ChevronDown size={16}/>}</button>
            <LibraryBig className="tree-node-icon" size={16}/>
            {editing === volume.id ? <input className="inline-title" defaultValue={volume.title} autoFocus onBlur={(event) => { onUpdate(volume.id, { title: event.target.value || volume.title }); setEditing(null) }} onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()} /> : <button className="tree-title" onDoubleClick={() => setEditing(volume.id)} onClick={() => toggle(volume.id)} onKeyDown={(event) => keyboardMove(event, volume)} title="Alt+↑/↓ 排序"><span>{volume.title}</span><small>{childChapters.length} 章</small></button>}
            <DropdownMenu label={`${volume.title} 更多操作`} align="end" onCloseAutoFocus={(event) => completeScheduledRename(event)} trigger={<button className="tree-action" aria-label={`${volume.title} 更多操作`}><MoreHorizontal size={16}/></button>} items={[
              { id: 'add-chapter', label: '添加章节', icon: <FolderPlus size={14}/>, onSelect: () => onCreateChapter(volume.id) },
              { id: 'rename', label: '重命名卷', onSelect: () => { renameAfterMenuClose.current = volume.id } },
              { id: 'delete', label: '移到回收站', icon: <Trash2 size={14}/>, danger: true, onSelect: () => onTrash(volume) },
            ]}/>
          </div>
          {!collapsed.has(volume.id) && renderChapters(childChapters)}
        </div>
      })}
      {renderChapters(chapters.filter((chapter) => chapter.parentId === book?.id || !volumes.some((volume) => volume.id === chapter.parentId)))}
    </div>
    <div className="tree-add-actions"><Button size="small" variant="ghost" leadingIcon={<FolderPlus size={15} />} onClick={() => onCreateChapter()}>添加章节</Button><Button size="small" variant="ghost" leadingIcon={<LibraryBig size={15}/>} onClick={onCreateVolume}>添加卷</Button></div>
    <div className="tree-legend"><BookMarked size={14} /><span>双击标题重命名</span><DropdownMenu label="书稿更多操作" align="end" onCloseAutoFocus={completeScheduledRename} trigger={<IconButton className="tree-legend-more" size="small" label="书稿更多操作"><MoreHorizontal size={15} /></IconButton>} items={[
      { id: 'rename', label: '重命名当前项', hint: selectedNode?.title, disabled: !selectedNode || selectedNode.type === 'book', onSelect: () => { renameAfterMenuClose.current = selectedNode?.id ?? null } },
      { id: 'collapse-all', label: '折叠全部', icon: <ChevronRight size={14}/>, disabled: collapsibleIds.length === 0, onSelect: () => setCollapsed(new Set(collapsibleIds)) },
      { id: 'expand-all', label: '展开全部', icon: <ChevronDown size={14}/>, disabled: collapsed.size === 0, onSelect: () => setCollapsed(new Set()) },
      { id: 'search', label: '搜索书稿', icon: <Search size={14}/>, onSelect: onSearch },
    ]} /></div>
  </aside>

  function completeScheduledRename(event: Event) {
    if (!renameAfterMenuClose.current) return
    event.preventDefault()
    setEditing(renameAfterMenuClose.current)
    renameAfterMenuClose.current = null
  }

  function renderChapters(items: ManuscriptNode[]) {
    return items.map((chapter) => {
      const scenes = nodes.filter((node) => node.type === 'scene' && node.parentId === chapter.id && !node.deletedAt).sort((a, b) => a.sortKey - b.sortKey)
      const isCollapsed = collapsed.has(chapter.id)
      return <div key={chapter.id} className="tree-chapter" draggable onDragStart={() => setDragged(chapter)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(chapter)}>
        <div className="tree-row chapter-row">
          <button className="tree-toggle" onClick={() => toggle(chapter.id)} aria-label={isCollapsed ? '展开章节' : '折叠章节'}>{isCollapsed ? <ChevronRight size={16}/> : <ChevronDown size={16}/>}</button>
          <GripVertical className="drag-handle" size={14}/>
          {editing === chapter.id ? <input className="inline-title" defaultValue={chapter.title} autoFocus onBlur={(event) => { onUpdate(chapter.id, { title: event.target.value || chapter.title }); setEditing(null) }} onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}/> : <button className="tree-title" onDoubleClick={() => setEditing(chapter.id)} onClick={() => toggle(chapter.id)} onKeyDown={(event) => keyboardMove(event, chapter)} title="Alt+↑/↓ 排序"><span>{chapter.title}</span><small>{scenes.length} 场</small></button>}
          <button className="tree-action tree-primary-action" onClick={() => onCreateScene(chapter.id)} aria-label={`在 ${chapter.title} 添加场景`} title="添加场景"><FilePlus2 size={15}/></button>
          <DropdownMenu label={`${chapter.title} 更多操作`} align="end" onCloseAutoFocus={completeScheduledRename} trigger={<button className="tree-action" aria-label={`${chapter.title} 更多操作`}><MoreHorizontal size={16}/></button>} items={[
            { id: 'rename', label: '重命名章节', onSelect: () => { renameAfterMenuClose.current = chapter.id } },
            { id: 'delete', label: '移到回收站', icon: <Trash2 size={14}/>, danger: true, onSelect: () => onTrash(chapter) },
          ]}/>
        </div>
        {!isCollapsed && <div className="scene-list">{scenes.map((scene, sceneIndex) => <div key={scene.id} className={`tree-row scene-row ${selectedId === scene.id ? 'selected' : ''}`} draggable onDragStart={() => setDragged(scene)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(scene)}>
          <GripVertical className="drag-handle" size={13}/>
          {editing === scene.id ? <input className="inline-title" defaultValue={scene.title} autoFocus onBlur={(event) => { onUpdate(scene.id, { title: event.target.value || scene.title }); setEditing(null) }} onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}/> : <button className="scene-select" onClick={() => onSelect(scene.id)} onDoubleClick={() => setEditing(scene.id)} onKeyDown={(event) => keyboardMove(event, scene)} title={`${sceneStatusLabel(scene.status)} · Alt+↑/↓ 排序`}><span className={`status-dot status-${scene.status}`} aria-hidden="true"/><span className="scene-title">{scene.title}</span><small className="tree-word-count">{scene.wordCount} 字</small></button>}
          <DropdownMenu label={`${scene.title} 更多操作`} align="end" onCloseAutoFocus={completeScheduledRename} trigger={<button className="tree-action" aria-label={`${scene.title} 更多操作`}><MoreHorizontal size={16}/></button>} items={[
            { id: 'rename', label: '重命名场景', onSelect: () => { renameAfterMenuClose.current = scene.id } },
            { id: 'split', label: '拆分场景', icon: <Scissors size={14}/>, disabled: scene.wordCount === 0, onSelect: () => onSplit(scene) },
            { id: 'merge', label: '与下一场景合并', icon: <Combine size={14}/>, disabled: sceneIndex === scenes.length - 1, onSelect: () => onMerge(scene) },
            { id: 'delete', label: '移到回收站', icon: <Trash2 size={14}/>, danger: true, onSelect: () => onTrash(scene) },
          ]}/>
        </div>)}</div>}
      </div>
    })
  }
}
