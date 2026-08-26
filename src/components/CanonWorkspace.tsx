import { useEffect, useState } from 'react'
import { Archive, Box, Check, Clock3, Layers3, Link2, MapPin, Plus, Search, ShieldCheck, Sparkles, Trash2, UserRound, X } from 'lucide-react'
import type { CandidateChange, Entity, EntityState, ManuscriptNode, Mention } from '../../shared/types'
import { api } from '../lib/api'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState } from './EmptyState'
import { Modal } from './Modal'
import { SeriesWorkspace } from './SeriesWorkspace'

export function CanonWorkspace({ projectId, entities, nodes, refresh, onSelectScene, notify }: { projectId: string; entities: Entity[]; nodes: ManuscriptNode[]; refresh: () => Promise<void>; onSelectScene: (id: string) => void; notify: (type: 'success' | 'error', message: string) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(entities[0]?.id ?? null)
  const [states, setStates] = useState<EntityState[]>([])
  const [candidates, setCandidates] = useState<CandidateChange[]>([])
  const [creating, setCreating] = useState(false)
  const [candidateMode, setCandidateMode] = useState(false)
  const [seriesMode, setSeriesMode] = useState(false)
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState<'all' | Entity['type']>('all')
  const selected = entities.find((entity) => entity.id === selectedId) ?? null
  const visible = entities.filter((entity) => (filter === 'all' || entity.type === filter) && (`${entity.canonicalName} ${entity.aliases.join(' ')} ${entity.summary}`).toLowerCase().includes(query.toLowerCase()))

  async function loadCandidates() { setCandidates(await api.listCandidates(projectId)) }
  useEffect(() => { void loadCandidates() }, [projectId])
  useEffect(() => { if (selectedId) void api.listStates(selectedId).then(setStates); else setStates([]) }, [selectedId])
  useEffect(() => { if (!selectedId && entities[0]) setSelectedId(entities[0].id) }, [entities, selectedId])

  async function resolve(candidate: CandidateChange, status: CandidateChange['status'], modifiedAfter?: unknown) {
    try { await api.resolveCandidate(candidate.id, status, modifiedAfter); await Promise.all([loadCandidates(), refresh()]); if (selectedId) setStates(await api.listStates(selectedId)); notify('success', status.startsWith('accepted') ? '候选已写入正典并记录事件' : '候选已忽略，记录仍保留') }
    catch (error) { notify('error', error instanceof Error ? error.message : '处理失败') }
  }

  return <section className="canon-workspace">
    <aside className="canon-list"><header><div><span className="eyebrow">正典库</span><h2>故事中的事实</h2></div><button className="button primary compact" onClick={() => setCreating(true)}><Plus size={15} />新建</button></header>
      <div className="canon-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、别名或简介" /></div><div className="entity-filters">{([['all','全部'],['character','人物'],['location','地点'],['item','物品']] as const).map(([value,label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div>
      <div className="entity-list">{visible.map((entity) => <button key={entity.id} className={entity.id === selectedId && !candidateMode && !seriesMode ? 'active' : ''} onClick={() => { setSelectedId(entity.id); setCandidateMode(false); setSeriesMode(false) }}><span className={`entity-icon entity-${entity.type}`}>{entityIcon(entity.type)}</span><span><strong>{entity.canonicalName}</strong><small>{entity.summary || typeLabel(entity.type)}</small></span>{entity.privacyLevel === 'local_private' && <ShieldCheck size={13} />}</button>)}</div>
      <button className={`candidate-inbox series-entry ${seriesMode ? 'active' : ''}`} onClick={() => { setSeriesMode(true); setCandidateMode(false) }}><Layers3 size={16} /><span>系列共享</span><strong>V1-C</strong></button>
      <button className={`candidate-inbox ${candidates.length ? 'has-items' : ''}`} onClick={() => { setCandidateMode(!candidateMode); setSeriesMode(false) }}><Sparkles size={16} /><span>事实候选</span><strong>{candidates.length}</strong></button>
    </aside>
    <main className="canon-detail">{seriesMode ? <SeriesWorkspace projectId={projectId} notify={notify}/> : candidateMode ? <CandidateInbox candidates={candidates} entities={entities} onResolve={resolve} /> : selected ? <EntityDetail entity={selected} states={states} nodes={nodes} onSelectScene={onSelectScene} onDeleted={() => { setSelectedId(null); void refresh() }} onRefresh={async () => { await refresh(); setStates(await api.listStates(selected.id)) }} notify={notify} /> : <EmptyState title="正典库还是空的" description="先创建人物、地点或重要物品。写作时，正文会自动建议反链。" action={<button className="button primary" onClick={() => setCreating(true)}><Plus size={16} />创建第一项</button>} />}</main>
    {creating && <CreateEntityModal projectId={projectId} onClose={() => setCreating(false)} onCreated={async (entity) => { await refresh(); setSelectedId(entity.id); setCreating(false) }} notify={notify} />}
  </section>
}

function EntityDetail({ entity, states, nodes, onRefresh, onDeleted, onSelectScene, notify }: { entity: Entity; states: EntityState[]; nodes: ManuscriptNode[]; onRefresh: () => Promise<void>; onDeleted: () => void; onSelectScene: (id: string) => void; notify: (type: 'success' | 'error', message: string) => void }) {
  const [summary, setSummary] = useState(entity.summary)
  const [aliases, setAliases] = useState(entity.aliases.join('、')); const [mentions, setMentions] = useState<Mention[]>([])
  const [adding, setAdding] = useState(false)
  const [confirmTrash, setConfirmTrash] = useState(false)
  useEffect(() => { setSummary(entity.summary); setAliases(entity.aliases.join('、')); void api.listEntityMentions(entity.id).then(setMentions) }, [entity])
  async function save() { try { await api.updateEntity(entity.id, { summary, aliases: aliases.split(/[、,，]/).map((value) => value.trim()).filter(Boolean) }); await onRefresh(); notify('success', '正典已更新') } catch (error) { notify('error', error instanceof Error ? error.message : '保存失败') } }
  async function remove() { await api.trashEntity(entity.id); notify('success', '正典项已移入回收站'); setConfirmTrash(false); onDeleted() }
  return <div className="entity-detail-content">
    <header className="entity-hero"><span className={`large-entity-icon entity-${entity.type}`}>{entityIcon(entity.type)}</span><div><span className="eyebrow">{typeLabel(entity.type)}</span><h2>{entity.canonicalName}</h2><p>{entity.aliases.length ? `别名：${entity.aliases.join('、')}` : '暂无别名'}</p></div><span className={`privacy-pill privacy-${entity.privacyLevel}`}>{entity.privacyLevel === 'local_private' ? '仅本地' : entity.privacyLevel === 'author_only' ? '仅作者' : '可用于上下文'}</span><button className="icon-button" onClick={() => setConfirmTrash(true)} aria-label="移入回收站"><Trash2 size={16}/></button></header>
    <section className="canon-card"><header><h3>简介与恒定事实</h3><button className="button secondary compact" onClick={() => void save()}>保存</button></header><label className="field-label">别名<input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="用顿号分隔" /></label><textarea rows={5} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="只写不会随剧情频繁变化的身份、背景或规则。" /></section>
    <section className="canon-card"><header><div><h3>时态状态</h3><p>描述它在不同故事时间点如何变化。</p></div><button className="button primary compact" onClick={() => setAdding(true)}><Plus size={14} />添加状态</button></header>
      {states.length === 0 ? <div className="empty-inline"><Clock3 size={19} /><span>还没有状态变化</span></div> : <div className="state-timeline">{states.map((state) => <article key={state.id}><span className="timeline-dot" /><div><strong>{state.attributeKey}</strong><p>{String(state.value)}</p><small>{state.worldTimeFrom || nodeTitle(nodes, state.validFromNodeId) || '生效时间未指定'}{state.worldTimeTo ? ` → ${state.worldTimeTo}` : ' → 至今'}</small></div></article>)}</div>}
    </section>
    <section className="canon-card"><header><div><h3>正文反链</h3><p>点击定位到确认过的原句。</p></div></header>{mentions.length ? <div className="backlink-list">{mentions.map((mention) => <button key={mention.id} onClick={() => { onSelectScene(mention.nodeId); window.setTimeout(() => window.dispatchEvent(new CustomEvent('bbd:locate-mention', { detail: mention })), 80) }}><Link2 size={14}/><span><strong>{nodeTitle(nodes, mention.nodeId) || '场景'}</strong><small>“{mention.quote}”</small></span></button>)}</div> : <p className="muted">还没有确认的正文提及。</p>}</section>
    {adding && <AddStateModal entity={entity} nodes={nodes} onClose={() => setAdding(false)} onCreated={async () => { setAdding(false); await onRefresh() }} notify={notify} />}
    {confirmTrash && <ConfirmDialog title="移到回收站" message={`把“${entity.canonicalName}”移入回收站？正文反链和状态不会被物理删除。`} confirmLabel="移到回收站" danger onConfirm={() => void remove()} onClose={() => setConfirmTrash(false)} />}
  </div>
}

function CandidateInbox({ candidates, entities, onResolve }: { candidates: CandidateChange[]; entities: Entity[]; onResolve: (candidate: CandidateChange, status: CandidateChange['status'], modifiedAfter?: unknown) => void }) {
  const [editing, setEditing] = useState<CandidateChange | null>(null)
  const [editValue, setEditValue] = useState('')
  function modify(candidate: CandidateChange) {
    const after = candidate.after as Record<string, unknown>
    setEditing(candidate)
    setEditValue(String(after?.value ?? ''))
  }
  function acceptModified() {
    if (!editing) return
    const after = editing.after as Record<string, unknown>
    onResolve(editing, 'accepted_modified', { ...after, value: editValue })
    setEditing(null)
  }
  return <div className="candidate-page"><header><span className="eyebrow">待作者确认</span><h2>事实变化候选</h2><p>只有接受后才会更新正典。忽略不会删除记录。</p></header>{candidates.length === 0 ? <EmptyState title="没有待处理候选" description="完成场景或使用事实抽取后，变化会先来到这里。" /> : <div className="candidate-list">{candidates.map((candidate) => <article key={candidate.id}><header><span className="confidence">{Math.round(candidate.confidence * 100)}% 置信度</span><small>{new Date(candidate.createdAt).toLocaleString('zh-CN')}</small></header><h3>{entities.find((entity) => entity.id === candidate.targetId)?.canonicalName ?? candidate.targetType}</h3><div className="before-after"><div><small>原状态</small><pre>{formatValue(candidate.before)}</pre></div><span>→</span><div><small>候选状态</small><pre>{formatValue(candidate.after)}</pre></div></div>{candidate.evidence.quote && <blockquote>“{candidate.evidence.quote}”</blockquote>}<footer><button className="button ghost" onClick={() => onResolve(candidate, 'ignored')}><X size={14} />忽略一次</button><button className="button secondary" onClick={() => modify(candidate)}>修改后接受</button><button className="button primary" onClick={() => onResolve(candidate, 'accepted')}><Check size={14} />接受并更新正典</button></footer></article>)}</div>}
    {editing && <ConfirmDialog title="修改后接受" message="输入最终值后再写入正典。" confirmLabel="接受修改" onConfirm={acceptModified} onClose={() => setEditing(null)}><label>最终值<input autoFocus value={editValue} onChange={(event) => setEditValue(event.target.value)} /></label></ConfirmDialog>}
  </div>
}

function CreateEntityModal({ projectId, onClose, onCreated, notify }: { projectId: string; onClose: () => void; onCreated: (entity: Entity) => void; notify: (type: 'success' | 'error', message: string) => void }) {
  const [type, setType] = useState<Entity['type']>('character'); const [name, setName] = useState(''); const [summary, setSummary] = useState(''); const [privacy, setPrivacy] = useState<Entity['privacyLevel']>('normal')
  async function submit() { try { const entity = await api.createEntity(projectId, { type, canonicalName: name, summary, privacyLevel: privacy }); notify('success', '正典项已创建'); onCreated(entity) } catch (error) { notify('error', error instanceof Error ? error.message : '创建失败') } }
  return <Modal title="新建正典项" onClose={onClose}><div className="form-stack"><label>类型<select value={type} onChange={(event) => setType(event.target.value as Entity['type'])}><option value="character">人物</option><option value="location">地点</option><option value="item">物品</option><option value="event">事件</option></select></label><label>名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><label>简介<textarea rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} /></label><label>隐私<select value={privacy} onChange={(event) => setPrivacy(event.target.value as Entity['privacyLevel'])}><option value="normal">可用于 AI 上下文</option><option value="author_only">仅作者可见</option><option value="local_private">仅本地，不发送给云端 AI</option></select></label><div className="modal-actions"><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!name.trim()} onClick={() => void submit()}>创建</button></div></div></Modal>
}

function AddStateModal({ entity, nodes, onClose, onCreated, notify }: { entity: Entity; nodes: ManuscriptNode[]; onClose: () => void; onCreated: () => void; notify: (type: 'success' | 'error', message: string) => void }) {
  const [key, setKey] = useState(entity.type === 'item' ? 'holder' : 'life_status'); const [value, setValue] = useState(''); const [fromNode, setFromNode] = useState(''); const [worldTime, setWorldTime] = useState(''); const [worldTimeTo, setWorldTimeTo] = useState('')
  async function submit() { try { await api.createState(entity.id, { attributeKey: key, value, validFromNodeId: fromNode || null, validToNodeId: null, worldTimeFrom: worldTime || null, worldTimeTo: worldTimeTo || null, sourceMentionId: null }); notify('success', '状态已加入时间线'); onCreated() } catch (error) { notify('error', error instanceof Error ? error.message : '状态创建失败') } }
  return <Modal title={`添加 ${entity.canonicalName} 的状态`} onClose={onClose}><div className="form-stack"><label>属性<input value={key} onChange={(event) => setKey(event.target.value)} placeholder="如：holder / life_status" /></label><label>值<input value={value} onChange={(event) => setValue(event.target.value)} placeholder="如：林照 / 已死亡" /></label><label>从场景起生效<select value={fromNode} onChange={(event) => setFromNode(event.target.value)}><option value="">未指定</option>{nodes.filter((node) => node.type === 'scene').map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</select></label><label>故事时间起点<input value={worldTime} onChange={(event) => setWorldTime(event.target.value)} placeholder="建议 YYYY-MM-DD；用于倒叙和并行时间" /></label><label>故事时间终点<input value={worldTimeTo} onChange={(event) => setWorldTimeTo(event.target.value)} placeholder="可选；区间按 [起点, 终点) 计算" /></label><div className="modal-actions"><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!key.trim() || !value.trim()} onClick={() => void submit()}>添加状态</button></div></div></Modal>
}

function entityIcon(type: Entity['type']) { return type === 'character' ? <UserRound size={17} /> : type === 'location' ? <MapPin size={17} /> : type === 'item' ? <Box size={17} /> : <Archive size={17} /> }
function typeLabel(type: Entity['type']) { return ({ character: '人物', location: '地点', item: '物品', event: '事件' } as const)[type] }
function nodeTitle(nodes: ManuscriptNode[], id: string | null) { return nodes.find((node) => node.id === id)?.title ?? null }
function formatValue(value: unknown) { return value == null ? '未设置' : typeof value === 'string' ? value : JSON.stringify(value, null, 2) }
