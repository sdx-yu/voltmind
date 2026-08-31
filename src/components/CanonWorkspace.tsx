import { useEffect, useState } from 'react'
import { Archive, ArrowLeft, Box, Check, ChevronRight, Clock3, Layers3, Link2, MapPin, Plus, ShieldCheck, Sparkles, Trash2, UserRound, X } from 'lucide-react'
import type { CandidateChange, Entity, EntityState, ManuscriptNode, Mention } from '../../shared/types'
import { api } from '../lib/api'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState } from './EmptyState'
import { Modal } from './Modal'
import { SeriesWorkspace } from './SeriesWorkspace'
import { CanonProfilePanel, CanonRelationshipPanel } from './CanonRelationPanels'
import { Badge, Button, Card, IconButton, LibraryTemplate, ListRow, PageHeader, SearchField, SegmentedControl, SelectField, TextareaField, TextField } from '../ui'

export function CanonWorkspace({ projectId, entities, nodes, refresh, onSelectScene, notify }: { projectId: string; entities: Entity[]; nodes: ManuscriptNode[]; refresh: () => Promise<void>; onSelectScene: (id: string) => void; notify: (type: 'success' | 'error', message: string) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(entities[0]?.id ?? null)
  const [states, setStates] = useState<EntityState[]>([])
  const [candidates, setCandidates] = useState<CandidateChange[]>([])
  const [creating, setCreating] = useState(false)
  const [candidateMode, setCandidateMode] = useState(false)
  const [seriesMode, setSeriesMode] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
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

  const detailVisible = detailOpen || candidateMode || seriesMode
  return <LibraryTemplate className={`canon-workspace${detailVisible ? ' has-selection' : ''}`}>
    <aside className="ui-canon-pane" aria-label="正典导航"><header className="ui-canon-pane-header"><div><span className="ui-eyebrow">正典库</span><h1>故事中的事实</h1></div><Button className="canon-create-action" variant="primary" size="small" leadingIcon={<Plus size={15} />} onClick={() => setCreating(true)}>新建</Button></header>
      <div className="ui-canon-search-slot"><SearchField label="搜索正典" value={query} onValueChange={setQuery} placeholder="名称、别名或简介" /></div><div className="entity-filters"><SegmentedControl label="正典类型" value={filter} onChange={(value) => setFilter(value as typeof filter)} items={[{ id: 'all', label: '全部' }, { id: 'character', label: '人物' }, { id: 'location', label: '地点' }, { id: 'item', label: '物品' }]} /></div>
      <div className="ui-canon-list">{visible.length ? visible.map((entity) => <ListRow key={entity.id} selected={entity.id === selectedId && !candidateMode && !seriesMode} icon={<span className={`entity-icon entity-${entity.type}`}>{entityIcon(entity.type)}</span>} title={entity.canonicalName} description={entity.summary || typeLabel(entity.type)} trailing={entity.privacyLevel === 'local_private' ? <ShieldCheck size={13} aria-label="仅本地" /> : undefined} onClick={() => { setSelectedId(entity.id); setCandidateMode(false); setSeriesMode(false); setDetailOpen(true) }} />) : <div className="canon-list-empty" role="status"><p>{query ? '没有匹配的正典项' : filter === 'all' ? '还没有正典项' : `还没有${typeLabel(filter)}`}</p><button type="button" onClick={() => { if (query) setQuery(''); else if (filter !== 'all') setFilter('all'); else setCreating(true) }}>{query ? '清除搜索' : filter !== 'all' ? '查看全部' : '新建第一项'}</button></div>}</div>
      <nav className="canon-support-nav" aria-label="正典扩展功能">
        <ListRow className="candidate-inbox series-entry" selected={seriesMode} icon={<Layers3 size={16} />} title="系列共享" meta="多部作品" trailing={<ChevronRight className="canon-row-chevron" size={15} />} onClick={() => { setSeriesMode(true); setCandidateMode(false); setDetailOpen(true) }} />
        <ListRow className={`candidate-inbox${candidates.length ? ' has-items' : ''}`} selected={candidateMode} icon={<Sparkles size={16} />} title="事实候选" meta={String(candidates.length)} trailing={<ChevronRight className="canon-row-chevron" size={15} />} onClick={() => { setCandidateMode(true); setSeriesMode(false); setDetailOpen(true) }} />
      </nav>
    </aside>
    <main className="canon-detail">{detailVisible && <Button className="ui-library-mobile-back" variant="ghost" size="small" leadingIcon={<ArrowLeft size={15} />} onClick={() => { setDetailOpen(false); setCandidateMode(false); setSeriesMode(false) }}>返回正典列表</Button>}{seriesMode ? <SeriesWorkspace projectId={projectId} notify={notify}/> : candidateMode ? <CandidateInbox candidates={candidates} entities={entities} onResolve={resolve} /> : selected ? <EntityDetail projectId={projectId} entity={selected} entities={entities} states={states} nodes={nodes} onSelectEntity={(id) => { setSelectedId(id); setDetailOpen(true) }} onSelectScene={onSelectScene} onDeleted={() => { setSelectedId(null); setDetailOpen(false); void refresh() }} onRefresh={async () => { await refresh(); setStates(await api.listStates(selected.id)) }} notify={notify} /> : <EmptyState title="正典库还是空的" description="先创建人物、地点或重要物品。写作时，正文会自动建议反链。" action={<Button variant="primary" leadingIcon={<Plus size={16} />} onClick={() => setCreating(true)}>创建第一项</Button>} />}</main>
    {creating && <CreateEntityModal projectId={projectId} onClose={() => setCreating(false)} onCreated={async (entity) => { await refresh(); setSelectedId(entity.id); setCreating(false) }} notify={notify} />}
  </LibraryTemplate>
}

function EntityDetail({ projectId, entity, entities, states, nodes, onRefresh, onDeleted, onSelectEntity, onSelectScene, notify }: { projectId: string; entity: Entity; entities: Entity[]; states: EntityState[]; nodes: ManuscriptNode[]; onRefresh: () => Promise<void>; onDeleted: () => void; onSelectEntity: (id: string) => void; onSelectScene: (id: string) => void; notify: (type: 'success' | 'error', message: string) => void }) {
  const [summary, setSummary] = useState(entity.summary)
  const [aliases, setAliases] = useState(entity.aliases.join('、')); const [mentions, setMentions] = useState<Mention[]>([])
  const [adding, setAdding] = useState(false)
  const [confirmTrash, setConfirmTrash] = useState(false)
  const [tab, setTab] = useState<'overview' | 'profile' | 'state' | 'relationship' | 'evidence'>('overview')
  useEffect(() => { setSummary(entity.summary); setAliases(entity.aliases.join('、')); setTab('overview'); void api.listEntityMentions(entity.id).then(setMentions) }, [entity])
  async function save() { try { await api.updateEntity(entity.id, { summary, aliases: aliases.split(/[、,，]/).map((value) => value.trim()).filter(Boolean) }); await onRefresh(); notify('success', '正典已更新') } catch (error) { notify('error', error instanceof Error ? error.message : '保存失败') } }
  async function remove() { await api.trashEntity(entity.id); notify('success', '正典项已移入回收站'); setConfirmTrash(false); onDeleted() }
  const privacyLabel = entity.privacyLevel === 'local_private' ? '仅本地' : entity.privacyLevel === 'author_only' ? '仅作者' : '可用于上下文'
  return <div className="entity-detail-content">
    <PageHeader tone="editorial" eyebrow={typeLabel(entity.type)} title={entity.canonicalName} description={entity.aliases.length ? `别名：${entity.aliases.join('、')}` : '暂无别名'} actions={<><Badge tone={entity.privacyLevel === 'local_private' ? 'success' : 'neutral'}>{privacyLabel}</Badge><IconButton onClick={() => setConfirmTrash(true)} label="移入回收站"><Trash2 size={16}/></IconButton></>} />
    <div className="canon-detail-tabs"><SegmentedControl label="正典详情" value={tab} onChange={(value) => setTab(value as typeof tab)} items={[{ id: 'overview', label: '概览' }, { id: 'profile', label: '档案' }, { id: 'state', label: '状态' }, { id: 'relationship', label: '关系' }, { id: 'evidence', label: '证据' }]}/></div>
    {tab === 'overview' && <Card className="canon-card" title="简介与恒定事实" actions={<Button size="small" variant="secondary" onClick={() => void save()}>保存</Button>}><div className="ui-detail-form"><TextField label="别名" value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="用顿号分隔" /><TextareaField label="简介" rows={5} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="只写不会随剧情频繁变化的身份、背景或规则。" /></div></Card>}
    {tab === 'profile' && <CanonProfilePanel entity={entity} notify={notify}/>}
    {tab === 'state' && <Card className="canon-card" title="时态状态" description="描述它在不同故事时间点如何变化。" actions={<Button size="small" variant="primary" leadingIcon={<Plus size={14} />} onClick={() => setAdding(true)}>添加状态</Button>}>
      {states.length === 0 ? <div className="empty-inline"><Clock3 size={19} /><span>还没有状态变化</span></div> : <div className="state-timeline">{states.map((state) => <article key={state.id}><span className="timeline-dot" /><div><strong>{state.attributeKey}</strong><p>{String(state.value)}</p><small>{state.worldTimeFrom || nodeTitle(nodes, state.validFromNodeId) || '生效时间未指定'}{state.worldTimeTo ? ` → ${state.worldTimeTo}` : ' → 至今'}</small></div></article>)}</div>}
    </Card>}
    {tab === 'relationship' && <CanonRelationshipPanel projectId={projectId} entity={entity} entities={entities} nodes={nodes} onSelectEntity={onSelectEntity} onSelectScene={onSelectScene} notify={notify}/>}
    {tab === 'evidence' && <Card className="canon-card" title="正文反链" description="点击定位到确认过的原句。">{mentions.length ? <div className="backlink-list">{mentions.map((mention) => <button key={mention.id} onClick={() => { onSelectScene(mention.nodeId); window.setTimeout(() => window.dispatchEvent(new CustomEvent('bbd:locate-mention', { detail: mention })), 80) }}><Link2 size={14}/><span><strong>{nodeTitle(nodes, mention.nodeId) || '场景'}</strong><small>“{mention.quote}”</small></span></button>)}</div> : <p className="muted">还没有确认的正文提及。</p>}</Card>}
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
    setEditValue(String(after?.value ?? after?.statusLabel ?? ''))
  }
  function acceptModified() {
    if (!editing) return
    const after = editing.after as Record<string, unknown>
    onResolve(editing, 'accepted_modified', editing.targetType === 'relationship_state' ? { ...after, statusLabel: editValue } : { ...after, value: editValue })
    setEditing(null)
  }
  return <div className="candidate-page"><PageHeader eyebrow="待作者确认" title="事实变化候选" description="只有接受后才会更新正典。忽略不会删除记录。" />{candidates.length === 0 ? <EmptyState title="没有待处理候选" description="完成场景或使用事实抽取后，变化会先来到这里。" /> : <div className="candidate-list">{candidates.map((candidate) => <article key={candidate.id}><header><span className="confidence">{Math.round(candidate.confidence * 100)}% 置信度</span><small>{new Date(candidate.createdAt).toLocaleString('zh-CN')}</small></header><h3>{candidate.targetType === 'relationship_state' ? '关系变化' : entities.find((entity) => entity.id === candidate.targetId)?.canonicalName ?? candidate.targetType}</h3><div className="before-after"><div><small>原状态</small><pre>{formatValue(candidate.before)}</pre></div><span>→</span><div><small>候选状态</small><pre>{formatValue(candidate.after)}</pre></div></div>{candidate.evidence.quote && <blockquote>“{candidate.evidence.quote}”</blockquote>}<footer><button className="button ghost" onClick={() => onResolve(candidate, 'ignored')}><X size={14} />忽略一次</button><button className="button secondary" onClick={() => modify(candidate)}>修改后接受</button><button className="button primary" onClick={() => onResolve(candidate, 'accepted')}><Check size={14} />接受并更新正典</button></footer></article>)}</div>}
    {editing && <ConfirmDialog title="修改后接受" message="输入最终值后再写入正典。" confirmLabel="接受修改" onConfirm={acceptModified} onClose={() => setEditing(null)}><TextField label="最终值" required autoFocus value={editValue} onChange={(event) => setEditValue(event.target.value)} /></ConfirmDialog>}
  </div>
}

function CreateEntityModal({ projectId, onClose, onCreated, notify }: { projectId: string; onClose: () => void; onCreated: (entity: Entity) => void; notify: (type: 'success' | 'error', message: string) => void }) {
  const [type, setType] = useState<Entity['type']>('character'); const [name, setName] = useState(''); const [summary, setSummary] = useState(''); const [privacy, setPrivacy] = useState<Entity['privacyLevel']>('normal')
  async function submit() { try { const entity = await api.createEntity(projectId, { type, canonicalName: name, summary, privacyLevel: privacy }); notify('success', '正典项已创建'); onCreated(entity) } catch (error) { notify('error', error instanceof Error ? error.message : '创建失败') } }
  return <Modal title="新建正典项" onClose={onClose}><div className="form-stack"><SelectField label="类型" value={type} onValueChange={(value) => setType(value as Entity['type'])}><option value="character">人物</option><option value="location">地点</option><option value="item">物品</option><option value="event">事件</option></SelectField><TextField label="名称" required autoFocus value={name} onChange={(event) => setName(event.target.value)} /><TextareaField label="简介" optional rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} /><SelectField label="隐私" value={privacy} onValueChange={(value) => setPrivacy(value as Entity['privacyLevel'])}><option value="normal">可用于 AI 上下文</option><option value="author_only">仅作者可见</option><option value="local_private">仅本地，不发送给云端 AI</option></SelectField><div className="modal-actions"><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!name.trim()} onClick={() => void submit()}>创建</button></div></div></Modal>
}

function AddStateModal({ entity, nodes, onClose, onCreated, notify }: { entity: Entity; nodes: ManuscriptNode[]; onClose: () => void; onCreated: () => void; notify: (type: 'success' | 'error', message: string) => void }) {
  const [key, setKey] = useState(entity.type === 'item' ? 'holder' : 'life_status'); const [value, setValue] = useState(''); const [fromNode, setFromNode] = useState(''); const [worldTime, setWorldTime] = useState(''); const [worldTimeTo, setWorldTimeTo] = useState('')
  async function submit() { try { await api.createState(entity.id, { attributeKey: key, value, validFromNodeId: fromNode || null, validToNodeId: null, worldTimeFrom: worldTime || null, worldTimeTo: worldTimeTo || null, sourceMentionId: null }); notify('success', '状态已加入时间线'); onCreated() } catch (error) { notify('error', error instanceof Error ? error.message : '状态创建失败') } }
  return <Modal title={`添加 ${entity.canonicalName} 的状态`} onClose={onClose}><div className="form-stack"><TextField label="属性" required value={key} onChange={(event) => setKey(event.target.value)} placeholder="如：holder / life_status" /><TextField label="值" required value={value} onChange={(event) => setValue(event.target.value)} placeholder="如：林照 / 已死亡" /><SelectField label="从场景起生效" optional value={fromNode} onValueChange={setFromNode}><option value="">未指定</option>{nodes.filter((node) => node.type === 'scene').map((node) => <option key={node.id} value={node.id}>{node.title}</option>)}</SelectField><TextField label="故事时间起点" optional value={worldTime} onChange={(event) => setWorldTime(event.target.value)} placeholder="建议 YYYY-MM-DD；用于倒叙和并行时间" /><TextField label="故事时间终点" optional value={worldTimeTo} onChange={(event) => setWorldTimeTo(event.target.value)} placeholder="区间按 [起点, 终点) 计算" /><div className="modal-actions"><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!key.trim() || !value.trim()} onClick={() => void submit()}>添加状态</button></div></div></Modal>
}

function entityIcon(type: Entity['type']) { return type === 'character' ? <UserRound size={17} /> : type === 'location' ? <MapPin size={17} /> : type === 'item' ? <Box size={17} /> : <Archive size={17} /> }
function typeLabel(type: Entity['type']) { return ({ character: '人物', location: '地点', item: '物品', event: '事件' } as const)[type] }
function nodeTitle(nodes: ManuscriptNode[], id: string | null) { return nodes.find((node) => node.id === id)?.title ?? null }
function formatValue(value: unknown) { return value == null ? '未设置' : typeof value === 'string' ? value : JSON.stringify(value, null, 2) }
