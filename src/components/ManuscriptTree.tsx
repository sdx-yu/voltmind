import { useMemo, useState, type KeyboardEvent } from 'react'
import { BookMarked, ChevronDown, ChevronRight, Combine, FilePlus2, FolderPlus, GripVertical, LibraryBig, MoreHorizontal, Search, Scissors, Trash2 } from 'lucide-react'
import type { ManuscriptNode } from '../../shared/types'
import { sceneStatusLabel, sceneStatusShort } from '../lib/status'

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
  const chapters = nodes.filter((node) => node.type === 'chapter' && !node.deletedAt).sort((a, b) => a.sortKey - b.sortKey)
  const volumes = nodes.filter((node) => node.type === 'volume' && !node.deletedAt).sort((a, b) => a.sortKey - b.sortKey)
  const book = nodes.find((node) => node.type === 'book')
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
    <div className="sidebar-heading"><span>书稿</span><button className="icon-button" onClick={onSearch} aria-label="全局搜索"><Search size={17} /></button></div>
    <div className="tree-scroll">
      {volumes.map((volume) => <div key={volume.id} className="tree-volume" onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(volume)}><div className="tree-row volume-row"><button className="tree-toggle" onClick={() => toggle(volume.id)} aria-label={collapsed.has(volume.id) ? '展开卷' : '折叠卷'}>{collapsed.has(volume.id) ? <ChevronRight size={15}/> : <ChevronDown size={15}/>}</button><LibraryBig size={14}/>{editing === volume.id ? <input className="inline-title" defaultValue={volume.title} autoFocus onBlur={(event) => { onUpdate(volume.id, { title: event.target.value || volume.title }); setEditing(null) }} /> : <button className="tree-title" onDoubleClick={() => setEditing(volume.id)} onClick={() => toggle(volume.id)} onKeyDown={(event) => keyboardMove(event, volume)} title="Alt+↑/↓ 排序"><span>{volume.title}</span></button>}<button className="tree-action" onClick={() => onCreateChapter(volume.id)} aria-label="在卷中添加章节"><FolderPlus size={13}/></button><button className="tree-action danger-hover" onClick={() => onTrash(volume)} aria-label={`删除 ${volume.title}`}><Trash2 size={13}/></button></div>{!collapsed.has(volume.id) && renderChapters(chapters.filter((chapter) => chapter.parentId === volume.id))}</div>)}
      {renderChapters(chapters.filter((chapter) => chapter.parentId === book?.id || !volumes.some((volume) => volume.id === chapter.parentId)))}
    </div>
    <div className="tree-add-actions"><button className="add-chapter" onClick={() => onCreateChapter()}><FolderPlus size={15} />添加章节</button><button className="add-chapter" onClick={onCreateVolume}><LibraryBig size={15}/>添加卷</button></div>
    <div className="tree-legend"><BookMarked size={14} /><span>双击标题重命名</span><MoreHorizontal size={14} /></div>
  </aside>

  function renderChapters(items: ManuscriptNode[]) { return items.map((chapter, chapterIndex) => { const scenes = nodes.filter((node) => node.type === 'scene' && node.parentId === chapter.id && !node.deletedAt).sort((a, b) => a.sortKey - b.sortKey); const isCollapsed = collapsed.has(chapter.id); return <div key={chapter.id} className="tree-chapter" draggable onDragStart={() => setDragged(chapter)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(chapter)}><div className="tree-row chapter-row"><button className="tree-toggle" onClick={() => toggle(chapter.id)} aria-label={isCollapsed ? '展开章节' : '折叠章节'}>{isCollapsed ? <ChevronRight size={15}/> : <ChevronDown size={15}/>}</button><GripVertical className="drag-handle" size={14}/>{editing === chapter.id ? <input className="inline-title" defaultValue={chapter.title} autoFocus onBlur={(event) => { onUpdate(chapter.id, { title: event.target.value || chapter.title }); setEditing(null) }} onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}/> : <button className="tree-title" onDoubleClick={() => setEditing(chapter.id)} onClick={() => toggle(chapter.id)} onKeyDown={(event) => keyboardMove(event, chapter)} title="Alt+↑/↓ 排序"><span>{chapter.title}</span><small>{chapterIndex + 1}</small></button>}<button className="tree-action" onClick={() => onCreateScene(chapter.id)} aria-label={`在 ${chapter.title} 添加场景`}><FilePlus2 size={14}/></button><button className="tree-action danger-hover" onClick={() => onTrash(chapter)} aria-label={`删除 ${chapter.title}`}><Trash2 size={13}/></button></div>{!isCollapsed && <div className="scene-list">{scenes.map((scene) => <div key={scene.id} className={`tree-row scene-row ${selectedId === scene.id ? 'selected' : ''}`} draggable onDragStart={() => setDragged(scene)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(scene)}><GripVertical className="drag-handle" size={13}/>{editing === scene.id ? <input className="inline-title" defaultValue={scene.title} autoFocus onBlur={(event) => { onUpdate(scene.id, { title: event.target.value || scene.title }); setEditing(null) }} onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}/> : <button className="scene-select" onClick={() => onSelect(scene.id)} onDoubleClick={() => setEditing(scene.id)} onKeyDown={(event) => keyboardMove(event, scene)} title={`${sceneStatusLabel(scene.status)} · Alt+↑/↓ 排序`}><span className={`status-dot status-${scene.status}`} /><span className="status-word">{sceneStatusShort(scene.status)}</span><span>{scene.title}</span><small>{scene.wordCount}</small></button>}<button className="tree-action" onClick={() => onSplit(scene)} aria-label={`拆分 ${scene.title}`}><Scissors size={13}/></button><button className="tree-action" onClick={() => onMerge(scene)} aria-label={`合并 ${scene.title} 与下一场景`}><Combine size={13}/></button><button className="tree-action danger-hover" onClick={() => onTrash(scene)} aria-label={`删除 ${scene.title}`}><Trash2 size={13}/></button></div>)}</div>}</div> }) }
}
