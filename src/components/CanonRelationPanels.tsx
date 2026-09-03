import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Box, CalendarRange, GitBranch, Link2, MapPin, Plus, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import type { Entity, EntityProfileField, EntityRelationship, ManuscriptNode, PrivacyLevel, RelationshipState } from '../../shared/types'
import { api } from '../lib/api'
import { Badge, Button, Card, IconButton, SegmentedControl, SelectControl, SelectField, TextareaField, TextField } from '../ui'
import { Modal } from './Modal'

type Notify = (type: 'success' | 'error', message: string) => void

export function CanonProfilePanel({ entity, notify }: { entity: Entity; notify: Notify }) {
  const [fields, setFields] = useState<EntityProfileField[]>([])
  const [adding, setAdding] = useState(false)
  async function refresh() { setFields(await api.listProfileFields(entity.id)) }
  useEffect(() => { void refresh() }, [entity.id])
  const groups = useMemo(() => [...new Set(fields.map((field) => field.category))], [fields])
  async function update(field: EntityProfileField, patch: Partial<EntityProfileField>) {
    try { await api.updateProfileField(field.id, patch); await refresh(); notify('success', '人物档案已更新') }
    catch (error) { notify('error', error instanceof Error ? error.message : '档案更新失败') }
  }
  async function remove(field: EntityProfileField) {
    try { await api.deleteProfileField(field.id); await refresh(); notify('success', '档案字段已删除') }
    catch (error) { notify('error', error instanceof Error ? error.message : '字段删除失败') }
  }
  return <Card className="canon-card profile-card" title="自定义档案" description="只记录有助于创作的字段；会变化的事实请放到“状态”。" actions={<Button size="small" variant="primary" leadingIcon={<Plus size={14}/>} onClick={() => setAdding(true)}>添加字段</Button>}>
    {fields.length ? <div className="profile-groups">{groups.map((category) => <section key={category}><header><strong>{category}</strong><small>{fields.filter((field) => field.category === category).length} 项</small></header><div>{fields.filter((field) => field.category === category).map((field) => <ProfileFieldRow key={field.id} field={field} onSave={update} onDelete={remove}/>)}</div></section>)}</div> : <div className="empty-inline"><ShieldCheck size={19}/><span>没有强制问卷。需要时再添加身份、外貌、背景、语言或目标。</span></div>}
    {adding && <AddProfileFieldModal entity={entity} onClose={() => setAdding(false)} onCreated={async () => { setAdding(false); await refresh() }} notify={notify}/>}
  </Card>
}

function ProfileFieldRow({ field, onSave, onDelete }: { field: EntityProfileField; onSave: (field: EntityProfileField, patch: Partial<EntityProfileField>) => void; onDelete: (field: EntityProfileField) => void }) {
  const [category, setCategory] = useState(field.category); const [label, setLabel] = useState(field.label); const [value, setValue] = useState(field.value)
  useEffect(() => { setCategory(field.category); setLabel(field.label); setValue(field.value) }, [field])
  const unchanged = value === field.value && label === field.label && category === field.category
  return <article className="profile-field-row"><div><input aria-label={`${field.label}分类`} value={category} onChange={(event) => setCategory(event.target.value)}/><input aria-label={`${field.label}字段名`} value={label} onChange={(event) => setLabel(event.target.value)}/><small>{privacyLabel(field.privacyLevel)}</small></div><textarea aria-label={`${field.label}内容`} rows={value.length > 60 ? 3 : 1} value={value} onChange={(event) => setValue(event.target.value)}/><div><Button size="small" variant="secondary" disabled={unchanged || !label.trim() || !category.trim()} onClick={() => onSave(field, { category, label, value })}>保存</Button><IconButton label={`删除${field.label}`} onClick={() => onDelete(field)}><Trash2 size={14}/></IconButton></div></article>
}

function AddProfileFieldModal({ entity, onClose, onCreated, notify }: { entity: Entity; onClose: () => void; onCreated: () => void; notify: Notify }) {
  const [category, setCategory] = useState('身份'); const [label, setLabel] = useState(''); const [value, setValue] = useState(''); const [privacy, setPrivacy] = useState<PrivacyLevel>('author_only')
  async function submit() {
    try { await api.createProfileField(entity.id, { category, label, value, privacyLevel: privacy }); notify('success', '档案字段已添加'); onCreated() }
    catch (error) { notify('error', error instanceof Error ? error.message : '字段创建失败') }
  }
  return <Modal title={`添加 ${entity.canonicalName} 的档案字段`} onClose={onClose}><div className="form-stack"><TextField label="分类" required list="profile-categories" value={category} onChange={(event) => setCategory(event.target.value)}/><datalist id="profile-categories"><option value="身份"/><option value="外貌"/><option value="背景"/><option value="性格"/><option value="语言"/><option value="目标"/><option value="其他"/></datalist><TextField label="字段名" required autoFocus value={label} onChange={(event) => setLabel(event.target.value)} placeholder="如：公开身份 / 口头禅"/><TextareaField label="内容" optional rows={4} value={value} onChange={(event) => setValue(event.target.value)}/><SelectField label="隐私" value={privacy} onValueChange={(next) => setPrivacy(next as PrivacyLevel)}><option value="normal">可用于 AI 上下文</option><option value="author_only">仅作者</option><option value="local_private">仅本地</option></SelectField><div className="modal-actions"><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" disabled={!category.trim() || !label.trim()} onClick={() => void submit()}>添加</Button></div></div></Modal>
}

export function CanonRelationshipPanel({ projectId, entity, entities, nodes, onSelectEntity, onSelectScene, notify }: { projectId: string; entity: Entity; entities: Entity[]; nodes: ManuscriptNode[]; onSelectEntity: (id: string) => void; onSelectScene: (id: string) => void; notify: Notify }) {
  const scenes = nodes.filter((node) => node.type === 'scene')
  const [atNodeId, setAtNodeId] = useState('')
  const [relationships, setRelationships] = useState<EntityRelationship[]>([])
  const [view, setView] = useState<'list' | 'graph'>('list')
  const [adding, setAdding] = useState(false)
  const [addingState, setAddingState] = useState<EntityRelationship | null>(null)
  const [editing, setEditing] = useState<EntityRelationship | null>(null)
  async function refresh() { setRelationships(await api.listRelationships(projectId, entity.id, atNodeId || undefined)) }
  useEffect(() => { void refresh() }, [projectId, entity.id, atNodeId])
  const names = useMemo(() => new Map(entities.map((item) => [item.id, item.canonicalName])), [entities])
  async function remove(relationship: EntityRelationship) {
    try { await api.deleteRelationship(relationship.id); await refresh(); notify('success', '关系已移入历史') }
    catch (error) { notify('error', error instanceof Error ? error.message : '关系删除失败') }
  }
  return <div className="relationship-panel">
    <Card className="canon-card relationship-toolbar" title="正典关系" description="选择场景后，只突出该时点有效的关系状态。" actions={<Button size="small" variant="primary" leadingIcon={<Plus size={14}/>} disabled={entities.length < 2} onClick={() => setAdding(true)}>建立关系</Button>}>
      <div className="relationship-toolbar-controls"><label>观察时点<SelectControl value={atNodeId} onChange={(event) => setAtNodeId(event.target.value)}><option value="">最新记录</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}{scene.storyTime ? ` · ${scene.storyTime}` : ''}</option>)}</SelectControl></label><SegmentedControl label="关系视图" value={view} onChange={(value) => setView(value as typeof view)} items={[{ id: 'list', label: '列表' }, { id: 'graph', label: '关联图' }]}/></div>
    </Card>
    {relationships.length === 0 ? <Card className="canon-card"><div className="empty-inline"><GitBranch size={19}/><span>{entities.length < 2 ? '至少创建两个正典项后才能建立关系。' : '还没有关系。先建立一条，再按场景记录它如何变化。'}</span></div></Card> : view === 'graph' ? <RelationshipGraph entity={entity} relationships={relationships} entities={entities} onSelectEntity={onSelectEntity} onSelectScene={onSelectScene} onEdit={setEditing} onAddState={setAddingState}/> : <div className="relationship-list">{relationships.map((relationship) => {
      const otherId = relationship.sourceEntityId === entity.id ? relationship.targetEntityId : relationship.sourceEntityId
      const arrow = relationship.direction === 'mutual' ? '双向' : relationship.sourceEntityId === entity.id ? '指向' : '来自'
      return <Card key={relationship.id} className={`canon-card relationship-card${relationship.currentState ? '' : ' is-inactive'}`} title={relationship.label || relationLabel(relationship.relationType)} description={`${arrow} · ${names.get(otherId) ?? '未知正典项'}`} actions={<><Button size="small" variant="ghost" onClick={() => setEditing(relationship)}>编辑</Button><Button size="small" variant="secondary" onClick={() => setAddingState(relationship)}>添加变化</Button><IconButton label="删除关系" onClick={() => void remove(relationship)}><Trash2 size={14}/></IconButton></>}>
        <button className="relationship-counterpart" onClick={() => onSelectEntity(otherId)}><span>{names.get(otherId) ?? '未知正典项'}</span><ArrowRight size={14}/></button>
        {relationship.summary && <p>{relationship.summary}</p>}
        <div className="relationship-current"><small>{atNodeId ? '所选场景状态' : '最新状态'}</small>{relationship.currentState ? <><Badge tone="success">{relationship.currentState.statusLabel}</Badge>{relationship.currentState.note && <span>{relationship.currentState.note}</span>}{relationship.currentState.sourceNodeId && <button onClick={() => onSelectScene(relationship.currentState!.sourceNodeId!)}><Link2 size={13}/>查看证据{relationship.currentState.evidence ? `：“${relationship.currentState.evidence}”` : ''}</button>}</> : <Badge tone="neutral">此时点无有效状态</Badge>}</div>
        {relationship.states.length > 0 && <details><summary>关系历史 · {relationship.states.length}</summary><div className="relationship-history">{relationship.states.map((state) => <article key={state.id}><strong>{state.statusLabel}</strong><small>{state.worldTimeFrom || nodeName(nodes, state.validFromNodeId) || '未指定起点'} → {state.worldTimeTo || nodeName(nodes, state.validToNodeId) || '至今'}</small>{state.note && <p>{state.note}</p>}</article>)}</div></details>}
      </Card>
    })}</div>}
    {adding && <AddRelationshipModal projectId={projectId} entity={entity} entities={entities} onClose={() => setAdding(false)} onCreated={async () => { setAdding(false); await refresh() }} notify={notify}/>}
    {editing && <EditRelationshipModal relationship={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await refresh() }} notify={notify}/>}
    {addingState && <AddRelationshipStateModal relationship={addingState} nodes={nodes} onClose={() => setAddingState(null)} onCreated={async () => { setAddingState(null); await refresh() }} notify={notify}/>}
  </div>
}

function RelationshipGraph({ entity, relationships, entities, onSelectEntity, onSelectScene, onEdit, onAddState }: { entity: Entity; relationships: EntityRelationship[]; entities: Entity[]; onSelectEntity: (id: string) => void; onSelectScene: (id: string) => void; onEdit: (relationship: EntityRelationship) => void; onAddState: (relationship: EntityRelationship) => void }) {
  const allGroups = useMemo(() => groupRelationships(entity, relationships, entities), [entity, relationships, entities])
  const groups = allGroups.slice(0, 12)
  const [selectedEntityId, setSelectedEntityId] = useState(groups[0]?.entity.id ?? '')
  const [selectedRelationshipId, setSelectedRelationshipId] = useState(groups[0]?.relationships[0]?.id ?? '')
  useEffect(() => {
    if (!groups.some((group) => group.entity.id === selectedEntityId)) {
      setSelectedEntityId(groups[0]?.entity.id ?? '')
      setSelectedRelationshipId(groups[0]?.relationships[0]?.id ?? '')
    }
  }, [groups, selectedEntityId])
  const layout = graphLayout(groups.length)
  const plotted = groups.map((group, index) => ({ ...group, ...layout.positions[index] }))
  const selectedGroup = groups.find((group) => group.entity.id === selectedEntityId) ?? groups[0]
  const selectedRelationship = selectedGroup?.relationships.find((item) => item.id === selectedRelationshipId) ?? selectedGroup?.relationships[0]
  const activeCount = relationships.filter((item) => item.currentState).length
  function selectGroup(group: RelationshipGroup) { setSelectedEntityId(group.entity.id); setSelectedRelationshipId(group.relationships[0]?.id ?? '') }
  return <Card className="canon-card relationship-graph-card" title="局部关系图" description={`以“${entity.canonicalName}”为中心，只展示一层直接关系。`} actions={<div className="relationship-graph-summary"><span>{groups.length} 个相邻项</span><span>{activeCount} 条当前有效</span></div>}>
    <div className={`relationship-graph-workspace${selectedGroup ? ' has-selection' : ''}`}>
      <div className="relationship-graph-scroll"><div className={`relationship-graph graph-size-${layout.size}`} role="group" aria-label={`${entity.canonicalName}的局部关系图`}>
        <div className="relationship-graph-legend" aria-label="图例"><span className="is-focus">当前项</span><span className="is-active">有效状态</span><span className="is-inactive">无有效状态</span></div>
        <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs><marker id="relationship-arrow-active" markerWidth="5" markerHeight="5" refX="4.2" refY="2.5" orient="auto-start-reverse"><path d="M0,0 L5,2.5 L0,5 z"/></marker><marker id="relationship-arrow-inactive" markerWidth="5" markerHeight="5" refX="4.2" refY="2.5" orient="auto-start-reverse"><path d="M0,0 L5,2.5 L0,5 z"/></marker></defs>
          {plotted.map((item) => { const markers = relationshipMarkers(entity.id, item.relationships); const inactive = !item.relationships.some((relationship) => relationship.currentState); const edge = graphEdge(layout.centerX, 50, item.x, item.y); return <line key={item.entity.id} x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} className={inactive ? 'inactive' : ''} markerStart={markers.start ? `url(#relationship-arrow-${inactive ? 'inactive' : 'active'})` : undefined} markerEnd={markers.end ? `url(#relationship-arrow-${inactive ? 'inactive' : 'active'})` : undefined}/> })}
        </svg>
        <div className="graph-center" style={{ left: `${layout.centerX}%`, top: '50%' }} aria-current="true"><span className="graph-node-icon">{entityIcon(entity.type)}</span><strong>{entity.canonicalName}</strong><small>当前正典项</small></div>
        {plotted.map((item) => { const status = groupStatus(item.relationships); return <button key={`edge-${item.entity.id}`} className={`relationship-edge-label${item.relationships.some((relationship) => relationship.currentState) ? '' : ' is-inactive'}`} aria-label={`查看${item.entity.canonicalName}的关系详情`} onClick={() => selectGroup(item)} style={{ left: `${(layout.centerX + item.x) / 2}%`, top: `${(50 + item.y) / 2}%` }}>{status}{item.relationships.length > 1 ? ` · ${item.relationships.length} 条` : ''}</button>})}
        {plotted.map((item) => { const status = groupStatus(item.relationships); const selected = item.entity.id === selectedGroup?.entity.id; return <button key={item.entity.id} className={`relationship-graph-node${selected ? ' is-selected' : ''}`} style={{ left: `${item.x}%`, top: `${item.y}%` }} data-entity-type={item.entity.type} aria-pressed={selected} onClick={() => selectGroup(item)} aria-label={`查看${item.entity.canonicalName}的关系：${status}`}><span className="graph-node-icon">{entityIcon(item.entity.type)}</span><strong>{item.entity.canonicalName}</strong><small>{entityTypeLabel(item.entity.type)}</small></button>})}
        <p className="relationship-graph-hint">选择节点查看关系详情；箭头表示关系方向。</p>
      </div></div>
      {selectedGroup && selectedRelationship && <aside className="relationship-graph-inspector" aria-label={`${selectedGroup.entity.canonicalName}关系详情`}>
        <header><div><span>{entityIcon(selectedGroup.entity.type)}</span><div><small>已选择</small><h4>{selectedGroup.entity.canonicalName}</h4></div></div><Badge tone={selectedRelationship.currentState ? 'success' : 'neutral'}>{selectedRelationship.currentState ? '当前有效' : '此时无状态'}</Badge></header>
        {selectedGroup.relationships.length > 1 && <div className="relationship-graph-tabs" role="tablist" aria-label="两项间的关系">{selectedGroup.relationships.map((relationship) => <button key={relationship.id} role="tab" aria-selected={relationship.id === selectedRelationship.id} onClick={() => setSelectedRelationshipId(relationship.id)}>{relationship.label || relationLabel(relationship.relationType)}</button>)}</div>}
        <div className="relationship-graph-detail"><div><span>{selectedRelationship.label || relationLabel(selectedRelationship.relationType)}</span><small>{relationshipDirectionLabel(entity.id, selectedRelationship)}</small></div><strong>{selectedRelationship.currentState?.statusLabel || '所选时点没有有效状态'}</strong>{selectedRelationship.summary && <p>{selectedRelationship.summary}</p>}{selectedRelationship.currentState?.note && <p>{selectedRelationship.currentState.note}</p>}</div>
        {selectedRelationship.currentState?.sourceNodeId && <button className="relationship-graph-evidence" onClick={() => onSelectScene(selectedRelationship.currentState!.sourceNodeId!)}><Link2 size={14}/>查看状态证据{selectedRelationship.currentState.evidence ? `：“${selectedRelationship.currentState.evidence}”` : ''}</button>}
        <footer><Button size="small" variant="ghost" onClick={() => onEdit(selectedRelationship)}>编辑关系</Button><Button size="small" variant="secondary" onClick={() => onAddState(selectedRelationship)}>添加变化</Button><Button size="small" variant="primary" onClick={() => onSelectEntity(selectedGroup.entity.id)}>打开档案</Button></footer>
      </aside>}
    </div>
    {allGroups.length > 12 && <p className="muted">图中先显示 12 个相邻正典项；完整关系请切换列表查看。</p>}
  </Card>
}

interface RelationshipGroup { entity: Entity; relationships: EntityRelationship[] }
function groupRelationships(entity: Entity, relationships: EntityRelationship[], entities: Entity[]): RelationshipGroup[] {
  const entityMap = new Map(entities.filter((item) => !item.deletedAt).map((item) => [item.id, item]))
  const groups = new Map<string, RelationshipGroup>()
  for (const relationship of relationships) {
    const otherId = relationship.sourceEntityId === entity.id ? relationship.targetEntityId : relationship.sourceEntityId
    const other = entityMap.get(otherId)
    if (!other) continue
    const group = groups.get(otherId) ?? { entity: other, relationships: [] }
    group.relationships.push(relationship); groups.set(otherId, group)
  }
  return [...groups.values()].sort((a, b) => Number(b.relationships.some((item) => item.currentState)) - Number(a.relationships.some((item) => item.currentState)) || a.entity.canonicalName.localeCompare(b.entity.canonicalName, 'zh-CN'))
}
function graphLayout(count: number): { centerX: number; size: 'compact' | 'medium' | 'large'; positions: { x: number; y: number }[] } {
  if (count <= 4) return { centerX: 28, size: count <= 1 ? 'compact' : count <= 2 ? 'medium' : 'large', positions: Array.from({ length: count }, (_, index) => ({ x: 75, y: count === 1 ? 50 : 18 + index * (64 / (count - 1)) })) }
  return { centerX: 50, size: 'large', positions: Array.from({ length: count }, (_, index) => { const angle = Math.PI * 2 * index / count - Math.PI / 2; return { x: 50 + Math.cos(angle) * 37, y: 50 + Math.sin(angle) * 34 } }) }
}
function groupStatus(relationships: EntityRelationship[]): string {
  const active = relationships.find((item) => item.currentState)
  const first = relationships[0]
  return active?.currentState?.statusLabel || active?.label || (active ? relationLabel(active.relationType) : first?.label || (first ? relationLabel(first.relationType) : '关系'))
}
function relationshipMarkers(centerId: string, relationships: EntityRelationship[]): { start: boolean; end: boolean } {
  if (relationships.some((item) => item.direction === 'mutual')) return { start: true, end: true }
  return { start: relationships.some((item) => item.targetEntityId === centerId), end: relationships.some((item) => item.sourceEntityId === centerId) }
}
function graphEdge(x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1; const dy = y2 - y1; const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy)); const inset = 10
  return { x1: x1 + dx / distance * inset, y1: y1 + dy / distance * inset, x2: x2 - dx / distance * inset, y2: y2 - dy / distance * inset }
}
function relationshipDirectionLabel(centerId: string, relationship: EntityRelationship): string {
  if (relationship.direction === 'mutual') return '双向关系'
  return relationship.sourceEntityId === centerId ? '从当前项指向对方' : '从对方指向当前项'
}
function entityIcon(type: Entity['type']) {
  if (type === 'character') return <UserRound size={15}/>
  if (type === 'location') return <MapPin size={15}/>
  if (type === 'item') return <Box size={15}/>
  return <CalendarRange size={15}/>
}

function AddRelationshipModal({ projectId, entity, entities, onClose, onCreated, notify }: { projectId: string; entity: Entity; entities: Entity[]; onClose: () => void; onCreated: () => void; notify: Notify }) {
  const options = entities.filter((item) => item.id !== entity.id)
  const [target, setTarget] = useState(options[0]?.id ?? ''); const [type, setType] = useState('friendship'); const [direction, setDirection] = useState<EntityRelationship['direction']>('mutual'); const [label, setLabel] = useState(''); const [summary, setSummary] = useState(''); const [privacy, setPrivacy] = useState<PrivacyLevel>('normal')
  async function submit() { try { await api.createRelationship(projectId, { sourceEntityId: entity.id, targetEntityId: target, relationType: type, direction, label, summary, privacyLevel: privacy }); notify('success', '正典关系已建立'); onCreated() } catch (error) { notify('error', error instanceof Error ? error.message : '关系创建失败') } }
  return <Modal title={`为 ${entity.canonicalName} 建立关系`} onClose={onClose}><div className="form-stack"><SelectField label="关联正典项" required value={target} onValueChange={setTarget}>{options.map((item) => <option key={item.id} value={item.id}>{item.canonicalName} · {entityTypeLabel(item.type)}</option>)}</SelectField><SelectField label="关系类型" required value={type} onValueChange={setType}>{Object.entries(RELATION_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</SelectField><SelectField label="方向" value={direction} onValueChange={(next) => setDirection(next as EntityRelationship['direction'])}><option value="mutual">双向关系</option><option value="directed">从当前项指向关联项</option></SelectField><TextField label="显示名称" optional value={label} onChange={(event) => setLabel(event.target.value)} placeholder="如：表面盟友 / 监护人"/><TextareaField label="关系说明" optional rows={3} value={summary} onChange={(event) => setSummary(event.target.value)}/><SelectField label="隐私" value={privacy} onValueChange={(next) => setPrivacy(next as PrivacyLevel)}><option value="normal">可用于 AI 上下文</option><option value="author_only">仅作者</option><option value="local_private">仅本地</option></SelectField><div className="modal-actions"><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" disabled={!target || !type.trim()} onClick={() => void submit()}>建立关系</Button></div></div></Modal>
}

function AddRelationshipStateModal({ relationship, nodes, onClose, onCreated, notify }: { relationship: EntityRelationship; nodes: ManuscriptNode[]; onClose: () => void; onCreated: () => void; notify: Notify }) {
  const scenes = nodes.filter((node) => node.type === 'scene')
  const [status, setStatus] = useState(''); const [note, setNote] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [worldFrom, setWorldFrom] = useState(''); const [worldTo, setWorldTo] = useState(''); const [evidence, setEvidence] = useState('')
  async function submit() { try { await api.createRelationshipState(relationship.id, { statusLabel: status, note, validFromNodeId: from || null, validToNodeId: to || null, worldTimeFrom: worldFrom || null, worldTimeTo: worldTo || null, sourceNodeId: from || null, evidence }); notify('success', '关系状态已加入时间线'); onCreated() } catch (error) { notify('error', error instanceof Error ? error.message : '状态创建失败') } }
  return <Modal title="添加关系变化" onClose={onClose}><div className="form-stack"><TextField label="状态" required value={status} onChange={(event) => setStatus(event.target.value)} placeholder="如：互相信任 / 暂时决裂"/><TextareaField label="说明" optional rows={3} value={note} onChange={(event) => setNote(event.target.value)}/><SelectField label="从场景起生效" optional value={from} onValueChange={setFrom}><option value="">未指定</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</SelectField><SelectField label="到场景前失效" optional value={to} onValueChange={setTo}><option value="">至今</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</SelectField><TextField label="故事时间起点" optional value={worldFrom} onChange={(event) => setWorldFrom(event.target.value)} placeholder="如 2035-04-18"/><TextField label="故事时间终点" optional value={worldTo} onChange={(event) => setWorldTo(event.target.value)} placeholder="区间不含终点"/><TextareaField label="正文证据" optional rows={2} value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="粘贴能证明这次变化的原句"/><div className="modal-actions"><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" disabled={!status.trim()} onClick={() => void submit()}>加入时间线</Button></div></div></Modal>
}

function EditRelationshipModal({ relationship, onClose, onSaved, notify }: { relationship: EntityRelationship; onClose: () => void; onSaved: () => void; notify: Notify }) {
  const [type, setType] = useState(relationship.relationType); const [direction, setDirection] = useState(relationship.direction); const [label, setLabel] = useState(relationship.label); const [summary, setSummary] = useState(relationship.summary); const [privacy, setPrivacy] = useState(relationship.privacyLevel)
  async function submit() { try { await api.updateRelationship(relationship.id, { relationType: type, direction, label, summary, privacyLevel: privacy }); notify('success', '关系说明已更新'); onSaved() } catch (error) { notify('error', error instanceof Error ? error.message : '关系更新失败') } }
  return <Modal title="编辑关系" onClose={onClose}><div className="form-stack"><label>关系类型<SelectControl value={type} onChange={(event) => setType(event.target.value)}>{Object.entries(RELATION_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</SelectControl></label><label>方向<SelectControl value={direction} onChange={(event) => setDirection(event.target.value as EntityRelationship['direction'])}><option value="mutual">双向关系</option><option value="directed">从起点指向终点</option></SelectControl></label><TextField label="显示名称" value={label} onChange={(event) => setLabel(event.target.value)}/><TextareaField label="关系说明" rows={3} value={summary} onChange={(event) => setSummary(event.target.value)}/><label>隐私<SelectControl value={privacy} onChange={(event) => setPrivacy(event.target.value as PrivacyLevel)}><option value="normal">可用于 AI 上下文</option><option value="author_only">仅作者</option><option value="local_private">仅本地</option></SelectControl></label><div className="modal-actions"><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" disabled={!type.trim()} onClick={() => void submit()}>保存关系</Button></div></div></Modal>
}

const RELATION_LABELS: Record<string, string> = { family: '亲属', romance: '爱情', friendship: '朋友', rivalry: '对手', mentorship: '师徒', alliance: '同盟', command: '上下级', membership: '归属', debt: '债务', custom: '自定义' }
function relationLabel(value: string) { return RELATION_LABELS[value] ?? value }
function privacyLabel(value: PrivacyLevel) { return value === 'normal' ? '可用于上下文' : value === 'author_only' ? '仅作者' : '仅本地' }
function entityTypeLabel(value: Entity['type']) { return ({ character: '人物', location: '地点', item: '物品', event: '事件' } as const)[value] }
function nodeName(nodes: ManuscriptNode[], id: string | null) { return nodes.find((node) => node.id === id)?.title ?? null }
