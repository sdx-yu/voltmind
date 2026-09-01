import { useEffect, useMemo, useRef, useState } from 'react'
import { diffWords } from 'diff'
import { Bot, BrainCircuit, Check, ChevronDown, CircleAlert, Clock3, Eye, FileClock, Link2, LoaderCircle, LockKeyhole, MessageSquareText, Plus, RotateCcw, Sparkles, Square, Trash2, UserRound, WandSparkles, X } from 'lucide-react'
import type { AiContextItem, AiTaskResult, ContinuityIssue, Entity, EntityState, KnowledgeFact, ManuscriptNode, Mention, Revision } from '../../shared/types'
import { api } from '../lib/api'
import { candidateUnits, splitBrainstormDirections, splitSentenceCandidates } from '../lib/aiCandidates'
import { ConfirmDialog } from './ConfirmDialog'
import { Modal } from './Modal'
import { IconButton, SelectControl, SelectField, Tabs, TextareaField, TextField } from '../ui'

type Tab = 'scene' | 'canon' | 'check' | 'ai'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'scene', label: '场景' },
  { id: 'canon', label: '正典' },
  { id: 'check', label: '检查' },
  { id: 'ai', label: 'AI' },
]

interface Props {
  projectId: string
  node: ManuscriptNode
  entities: Entity[]
  refreshEntities: () => Promise<void>
  onUpdateNode: (patch: Partial<ManuscriptNode>) => Promise<void>
  onRefreshTree: () => Promise<void>
  onReloadScene: () => void
  notify: (type: 'success' | 'error', message: string) => void
  onClose?: () => void
}

export function Inspector({ projectId, node, entities, refreshEntities, onUpdateNode, onRefreshTree, onReloadScene, notify, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('scene')
  return <aside className="inspector" aria-label="场景检查器">
    <div className="ui-inspector-tabbar"><Tabs items={TABS} value={tab} onChange={(value) => setTab(value as Tab)} label="检查器分页" />{onClose && <IconButton size="small" className="inspector-close" onClick={onClose} label="关闭检查器"><X size={16} /></IconButton>}</div>
    <div className="inspector-scroll">
      {tab === 'scene' && <ScenePanel node={node} entities={entities} onUpdateNode={onUpdateNode} onRefreshTree={onRefreshTree} onReloadScene={onReloadScene} notify={notify} />}
      {tab === 'canon' && <CanonPanel projectId={projectId} node={node} entities={entities} refreshEntities={refreshEntities} notify={notify} />}
      {tab === 'check' && <CheckPanel node={node} notify={notify} />}
      {tab === 'ai' && <AiPanel projectId={projectId} node={node} notify={notify} />}
    </div>
  </aside>
}

function ScenePanel({ node, entities, onUpdateNode, onRefreshTree, onReloadScene, notify }: Pick<Props, 'node' | 'entities' | 'onUpdateNode' | 'onRefreshTree' | 'onReloadScene' | 'notify'>) {
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [previewRevision, setPreviewRevision] = useState<Revision | null>(null)
  const [historyFilter, setHistoryFilter] = useState<'all' | 'human' | 'ai' | 'system'>('all')
  useEffect(() => { if (showHistory) void api.listRevisions(node.id).then(setRevisions) }, [showHistory, node.id])
  const visibleRevisions = revisions.filter((revision) => historyFilter === 'all' || revisionGroup(revision) === historyFilter)

  async function update(patch: Partial<ManuscriptNode>) {
    try { await onUpdateNode(patch) } catch (error) { notify('error', error instanceof Error ? error.message : '更新失败') }
  }

  async function restore(revision: Revision) {
    try { await api.restoreRevision(node.id, revision.id); notify('success', '已恢复为一个新版本，当前历史没有被覆盖'); await onRefreshTree(); onReloadScene(); setShowHistory(false) }
    catch (error) { notify('error', error instanceof Error ? error.message : '恢复失败') }
  }
  async function complete() { try { const result = await api.completeScene(node.id); await onRefreshTree(); notify('success', result.candidates.length ? `场景已完成，${result.candidates.length} 条事实变化等待确认` : '场景已完成，并已生成快照与连续性检查') } catch (error) { notify('error', error instanceof Error ? error.message : '完成场景失败') } }

  return <div className="panel-stack">
    <section className="inspector-section"><header><span className="section-icon"><MessageSquareText size={15} /></span><h3>场景状态</h3></header>
      <SelectField label="进度" value={node.status} onValueChange={(value) => void update({ status: value as ManuscriptNode['status'] })}>
        <option value="idea">想法</option><option value="planned">计划</option><option value="draft">草稿</option><option value="revising">修订中</option><option value="complete">已完成</option><option value="published">已发布</option>
      </SelectField>
      <TextField label="故事时间" value={node.storyTime ?? ''} onChange={(event) => void update({ storyTime: event.target.value || null })} placeholder="建议 YYYY-MM-DD，便于顺序检查" />
      <SelectField label="视角人物" value={node.povEntityId ?? ''} onValueChange={(value) => void update({ povEntityId: value || null })}><option value="">未指定</option>{entities.filter((entity) => entity.type === 'character').map((entity) => <option key={entity.id} value={entity.id}>{entity.canonicalName}</option>)}</SelectField>
      {node.status !== 'complete' && <button className="button primary full" onClick={() => void complete()}><Check size={16} />完成本场景并提取事实</button>}
    </section>
    <section className="inspector-section"><button className="section-toggle" onClick={() => setShowHistory(!showHistory)}><span><FileClock size={15} />版本历史</span><ChevronDown className={showHistory ? 'rotated' : ''} size={16} /></button>
      {showHistory && <><div className="revision-filters" aria-label="版本来源筛选">{([['all','全部'],['human','人工'],['ai','AI'],['system','导入/恢复']] as const).map(([value,label]) => <button key={value} className={historyFilter === value ? 'active' : ''} onClick={() => setHistoryFilter(value)}>{label}</button>)}</div><div className="revision-list">{visibleRevisions.length === 0 ? <p className="muted">当前筛选下没有版本。</p> : visibleRevisions.map((revision) => <div key={revision.id} className="revision-item"><div><strong>{new Date(revision.createdAt).toLocaleString('zh-CN')}</strong><span>{sourceLabel(revision.provenanceLabel)} · {revision.plainText.length} 字符</span></div><span className="revision-actions"><button className="icon-button" onClick={() => setPreviewRevision(revision)} aria-label="预览版本差异"><Eye size={14}/></button><button className="icon-button" onClick={() => void restore(revision)} aria-label="恢复此版本"><RotateCcw size={14} /></button></span></div>)}</div></>}
      {previewRevision && <div className="revision-preview"><header><strong>与父版本的差异</strong><button onClick={() => setPreviewRevision(null)}>关闭</button></header><small>{sourceLabel(previewRevision.provenanceLabel)} · 内容哈希 {previewRevision.contentHash.slice(0, 12)}</small><p>{diffWords(revisions.find((item) => item.id === previewRevision.parentRevisionId)?.plainText ?? '', previewRevision.plainText).map((part, index) => <span key={index} className={part.added ? 'preview-added' : part.removed ? 'preview-removed' : ''}>{part.value}</span>)}</p><button className="button secondary full" onClick={() => void restore(previewRevision)}><RotateCcw size={14}/>恢复为新版本</button></div>}
    </section>
  </div>
}

function CanonPanel({ projectId, node, entities, refreshEntities, notify }: Pick<Props, 'projectId' | 'node' | 'entities' | 'refreshEntities' | 'notify'>) {
  const [suggestions, setSuggestions] = useState<Array<Omit<Mention, 'id' | 'createdAt'>>>([])
  const [mentions, setMentions] = useState<Mention[]>([])
  const [currentStates, setCurrentStates] = useState<EntityState[]>([])
  const [name, setName] = useState('')
  const [type, setType] = useState<Entity['type']>('character')
  const entityMap = useMemo(() => new Map(entities.map((entity) => [entity.id, entity])), [entities])

  async function refresh() {
    const [nextMentions, nextSuggestions, nextStates] = await Promise.all([api.listMentions(node.id), api.suggestMentions(node.id), api.currentStates(node.id)])
    setMentions(nextMentions); setSuggestions(nextSuggestions); setCurrentStates(nextStates)
  }
  useEffect(() => { void refresh() }, [node.id, entities.length])

  async function addEntity() {
    if (!name.trim()) return
    try { await api.createEntity(projectId, { type, canonicalName: name.trim() }); setName(''); await refreshEntities(); notify('success', '已加入正典库') }
    catch (error) { notify('error', error instanceof Error ? error.message : '创建失败') }
  }

  async function confirmMention(suggestion: Omit<Mention, 'id' | 'createdAt'>) {
    try { await api.createMention(node.id, { ...suggestion, confirmed: true }); await refresh(); notify('success', `已确认“${suggestion.quote}”的正文反链`) }
    catch (error) { notify('error', error instanceof Error ? error.message : '确认失败') }
  }

  return <div className="panel-stack">
    <section className="inspector-section"><header><span className="section-icon"><UserRound size={15} /></span><h3>场景相关正典</h3></header>
      {mentions.length === 0 ? <p className="muted">正文中提到人物或设定后，可在这里建立反链。</p> : <div className="chip-list">{mentions.map((mention) => <button key={mention.id} className="entity-chip" onClick={() => window.dispatchEvent(new CustomEvent('bbd:locate-mention', { detail: mention }))}><Link2 size={12} />{entityMap.get(mention.entityId)?.canonicalName ?? mention.quote}</button>)}</div>}
      {suggestions.length > 0 && <div className="suggestion-box"><strong>发现 {suggestions.length} 个未确认提及</strong>{suggestions.slice(0, 8).map((suggestion, index) => <button key={`${suggestion.entityId}-${suggestion.startOffset}-${index}`} onClick={() => void confirmMention(suggestion)}><span>“{suggestion.quote}”</span><Check size={13} /></button>)}</div>}
      {currentStates.filter((state) => mentions.some((mention) => mention.entityId === state.entityId)).length > 0 && <div className="current-state-box"><strong>本场景时点状态</strong>{currentStates.filter((state) => mentions.some((mention) => mention.entityId === state.entityId)).map((state) => <div key={state.id}><span>{entityMap.get(state.entityId)?.canonicalName} · {state.attributeKey}</span><b>{String(state.value)}</b></div>)}</div>}
    </section>
    <section className="inspector-section"><header><span className="section-icon"><Sparkles size={15} /></span><h3>快速加入正典</h3></header>
      <div className="inline-form"><SelectControl aria-label="正典类型" value={type} onValueChange={(value) => setType(value as Entity['type'])}><option value="character">人物</option><option value="location">地点</option><option value="item">物品</option><option value="event">事件</option></SelectControl><input value={name} onChange={(event) => setName(event.target.value)} placeholder="名称" /><button className="button secondary" disabled={!name.trim()} onClick={() => void addEntity()}>加入</button></div>
    </section>
    <KnowledgePanel projectId={projectId} node={node} entities={entities} notify={notify} />
  </div>
}

function KnowledgePanel({ projectId, node, entities, notify }: Pick<Props, 'projectId' | 'node' | 'entities' | 'notify'>) {
  const [facts, setFacts] = useState<KnowledgeFact[]>([])
  const [nodes, setNodes] = useState<ManuscriptNode[]>([])
  const [creating, setCreating] = useState(false)
  const [granting, setGranting] = useState<KnowledgeFact | null>(null)
  const pov = entities.find((entity) => entity.id === node.povEntityId)
  async function refresh() { const [nextFacts, nextNodes] = await Promise.all([api.listKnowledge(projectId), api.listNodes(projectId)]); setFacts(nextFacts); setNodes(nextNodes) }
  useEffect(() => { void refresh().catch(() => notify('error', '角色知识范围加载失败')) }, [projectId, node.id])
  const [pendingTrash, setPendingTrash] = useState<KnowledgeFact | null>(null)
  async function remove() {
    if (!pendingTrash) return
    await api.trashKnowledge(pendingTrash.id)
    setPendingTrash(null)
    await refresh()
    notify('success', '知识事实已移出当前列表')
  }
  return <div className="panel-stack knowledge-stack"><section className="inspector-section"><header><span className="section-icon"><BrainCircuit size={15}/></span><h3>POV 知情范围</h3></header>{pov ? <p className="knowledge-pov">当前视角：<strong>{pov.canonicalName}</strong><span>{facts.filter((fact) => knownAt(fact, pov.id, node.id, nodes)).length} 条已知 · {facts.filter((fact) => !knownAt(fact, pov.id, node.id, nodes)).length} 条未知</span></p> : <p className="muted">先为场景指定视角人物，系统才会检查知识泄露。</p>}<button className="button secondary full" onClick={() => setCreating(true)}><Plus size={14}/>建立知识事实</button></section>
    {facts.map((fact) => { const known = Boolean(pov && knownAt(fact, pov.id, node.id, nodes)); const grant = pov ? fact.grants.find((item) => item.entityId === pov.id) : null; return <article key={fact.id} className={`knowledge-card ${known ? 'known' : 'unknown'}`}><header><span>{known ? '当前已知' : '当前未知'}</span><button className="icon-button" aria-label={`移除知识 ${fact.title}`} onClick={() => setPendingTrash(fact)}><Trash2 size={13}/></button></header><h4>{fact.title}</h4>{fact.detail && <p>{fact.detail}</p>}<small>识别词：{fact.keywords.join('、')}</small>{grant && <small>知情起点：{nodeName(nodes, grant.knownFromNodeId)}</small>}<button className="knowledge-grant" disabled={!pov} onClick={() => setGranting(fact)}>{grant ? '调整当前 POV 知情起点' : '让当前 POV 从某场景起知情'}</button></article> })}
    {creating && <CreateKnowledgeModal projectId={projectId} nodes={nodes} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await refresh() }} notify={notify}/>} {granting && pov && <GrantKnowledgeModal fact={granting} entity={pov} nodes={nodes} onClose={() => setGranting(null)} onSaved={async () => { setGranting(null); await refresh() }} notify={notify}/>}
    {pendingTrash && <ConfirmDialog title="移出知识事实" message={`把知识事实“${pendingTrash.title}”移出当前正典？`} confirmLabel="移出当前列表" danger onConfirm={() => void remove()} onClose={() => setPendingTrash(null)} />}
    </div>
}

function CreateKnowledgeModal({ projectId, nodes, onClose, onCreated, notify }: { projectId: string; nodes: ManuscriptNode[]; onClose: () => void; onCreated: () => void; notify: Props['notify'] }) {
  const [title, setTitle] = useState(''); const [detail, setDetail] = useState(''); const [keywords, setKeywords] = useState(''); const [reveal, setReveal] = useState('')
  async function submit() { try { await api.createKnowledge(projectId, { title, detail, keywords: keywords.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean), firstRevealedNodeId: reveal || null, privacyLevel: 'author_only' }); notify('success', '知识事实已建立，尚未自动授予任何角色'); onCreated() } catch (error) { notify('error', error instanceof Error ? error.message : '知识事实创建失败') } }
  return <Modal title="建立知识事实" onClose={onClose}><div className="form-stack"><TextField label="秘密或知识名称" required autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：凶手是沈砚"/><TextareaField label="作者说明" optional value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="只对作者可见的事实说明"/><TextField label="正文识别词" required value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="用顿号分隔，如：沈砚是凶手、真凶沈砚" description="至少填写一个不少于 2 个字的明确识别词。"/><SelectField label="首次对读者揭示" optional value={reveal} onValueChange={setReveal}><option value="">未指定</option>{sceneNodes(nodes).map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</SelectField><p className="form-hint">系统只按这些明确识别词检查，不会让 AI 猜测隐含含义。</p><div className="modal-actions"><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!title.trim() || keywords.split(/[、,，\n]/).every((item) => item.trim().length < 2)} onClick={() => void submit()}>建立</button></div></div></Modal>
}

function GrantKnowledgeModal({ fact, entity, nodes, onClose, onSaved, notify }: { fact: KnowledgeFact; entity: Entity; nodes: ManuscriptNode[]; onClose: () => void; onSaved: () => void; notify: Props['notify'] }) {
  const current = fact.grants.find((item) => item.entityId === entity.id); const [from, setFrom] = useState(current?.knownFromNodeId ?? ''); const [evidence, setEvidence] = useState(current?.evidence ?? ''); const [note, setNote] = useState(current?.note ?? '')
  async function submit() { try { await api.grantKnowledge(fact.id, entity.id, { knownFromNodeId: from, sourceNodeId: from, evidence, note }); notify('success', `${entity.canonicalName}的知情起点已更新`); onSaved() } catch (error) { notify('error', error instanceof Error ? error.message : '知情范围保存失败') } }
  return <Modal title={`${entity.canonicalName}何时知道“${fact.title}”`} onClose={onClose}><div className="form-stack"><SelectField label="从场景起知情" required value={from} onValueChange={setFrom}><option value="">请选择</option>{sceneNodes(nodes).map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</SelectField><TextField label="知情证据" optional value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="例如：他亲眼看见密信落款"/><TextareaField label="作者备注" optional value={note} onChange={(event) => setNote(event.target.value)} /><div className="modal-actions"><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!from} onClick={() => void submit()}>保存知情起点</button></div></div></Modal>
}

function knownAt(fact: KnowledgeFact, entityId: string, nodeId: string, nodes: ManuscriptNode[]) { const scenes = sceneNodes(nodes); const order = new Map(scenes.map((scene, index) => [scene.id, index])); const grant = fact.grants.find((item) => item.entityId === entityId); return Boolean(grant && (order.get(grant.knownFromNodeId) ?? Number.MAX_SAFE_INTEGER) <= (order.get(nodeId) ?? -1)) }
function sceneNodes(nodes: ManuscriptNode[]) { const chapters = nodes.filter((node) => node.type === 'chapter' && !node.deletedAt).sort((a, b) => a.sortKey - b.sortKey); return chapters.flatMap((chapter) => nodes.filter((node) => node.type === 'scene' && node.parentId === chapter.id && !node.deletedAt).sort((a, b) => a.sortKey - b.sortKey)) }
function nodeName(nodes: ManuscriptNode[], id: string) { return nodes.find((node) => node.id === id)?.title ?? '未找到场景' }

function CheckPanel({ node, notify }: Pick<Props, 'node' | 'notify'>) {
  const [issues, setIssues] = useState<ContinuityIssue[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  async function runCheck() {
    setLoading(true)
    try { setIssues(await api.checkScene(node.id)) } catch (error) { notify('error', error instanceof Error ? error.message : '检查失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { void runCheck() }, [node.id])
  async function ignore(issue: ContinuityIssue) { try { await api.ignoreIssue(node.id, issue, '作者选择忽略本场景提示'); setIssues((current) => current.filter((item) => item.id !== issue.id)); notify('success', '已记录为本场景例外，后续检查不会重复提示') } catch (error) { notify('error', error instanceof Error ? error.message : '忽略失败') } }
  return <div className="panel-stack"><section className="inspector-section"><header><span className="section-icon"><Eye size={15} /></span><h3>连续性检查</h3></header>
    <p className="muted">只报告有证据的问题；系统不会替你修改正文。</p><button className="button secondary full" disabled={loading} onClick={() => void runCheck()}>{loading ? '正在检查…' : '重新检查'}</button>
  </section>{issues.length === 0 && !loading ? <div className="all-clear"><Check size={20} /><strong>暂未发现高置信度问题</strong><span>这不代表作品没有任何问题。</span></div> : issues.map((issue) => <article key={issue.id} className={`issue-card issue-${issue.severity}`}><header><CircleAlert size={16} /><span>{issue.severity === 'risk' ? '错误风险' : '建议复核'}</span><small>{Math.round(issue.confidence * 100)}%</small></header><p>{issue.message}</p><blockquote>{issue.currentEvidence.quote}</blockquote>{expanded.has(issue.id) && issue.conflictingEvidence && <blockquote className="conflicting-evidence">冲突证据：{issue.conflictingEvidence.quote}</blockquote>}<div className="issue-actions"><button onClick={() => setExpanded((current) => { const next = new Set(current); next.has(issue.id) ? next.delete(issue.id) : next.add(issue.id); return next })}>查看证据</button><button onClick={() => void ignore(issue)}>忽略一次</button></div></article>)}</div>
}

function AiPanel({ projectId, node, notify }: Pick<Props, 'projectId' | 'node' | 'notify'>) {
  const [context, setContext] = useState<AiContextItem[]>([])
  const [provider, setProvider] = useState<{ kind: 'demo' | 'ollama' | 'blocked'; model: string } | null>(null)
  const [contextOpen, setContextOpen] = useState(false)
  const [task, setTask] = useState('brainstorm')
  const [instruction, setInstruction] = useState('')
  const [result, setResult] = useState<AiTaskResult | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('正在准备本地任务')
  const [streamOutput, setStreamOutput] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [runNotice, setRunNotice] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [selectedSegments, setSelectedSegments] = useState<Set<number>>(new Set())
  const runController = useRef<AbortController | null>(null)
  useEffect(() => {
    const load = () => Promise.all([api.getContext(projectId, node.id), api.getAiSettings()])
      .then(([nextContext, settings]) => { setContext(nextContext); setProvider({ kind: settings.provider, model: settings.model }); if (settings.provider === 'ollama') void api.warmAi().catch(() => {}) })
      .catch((error) => notify('error', error instanceof Error ? error.message : 'AI 配置与上下文加载失败'))
    const reload = () => { void load() }
    void load(); window.addEventListener('bbd:ai-settings-changed', reload)
    setResult(null); setAccepted(false)
    return () => { window.removeEventListener('bbd:ai-settings-changed', reload); runController.current?.abort(); runController.current = null }
  }, [projectId, node.id])
  useEffect(() => {
    if (!running) return
    const started = Date.now(); setElapsed(0)
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1_000)), 1_000)
    return () => window.clearInterval(timer)
  }, [running])
  const selected = context.filter((item) => item.selected)
  const tokens = selected.reduce((total, item) => total + item.estimatedTokens, 0)
  const demoMode = provider?.kind !== 'ollama'
  const providerLabel = !provider ? '正在确认模型状态…' : provider.kind === 'ollama' ? `本地免费 · ${provider.model} · API 费用 ¥0` : provider.kind === 'blocked' ? '外网模型已停用 · 零费用保护生效' : '演示模式 · 固定候选 · 不联网'

  async function run() {
    const controller = new AbortController(); runController.current?.abort(); runController.current = controller
    setRunning(true); setResult(null); setAccepted(false); setStreamOutput(''); setRunNotice(''); setProgress('正在整理本地上下文')
    try {
      const next = await api.streamAiTask({ projectId, nodeId: node.id, taskType: task, instruction, selectedContextIds: selected.map((item) => item.id) }, (event) => {
        if (event.type === 'status') { if (event.resetOutput) setStreamOutput(''); setProgress(event.message) }
        if (event.type === 'delta') setStreamOutput((current) => current + event.delta)
      }, controller.signal)
      setResult(next)
      setSelectedSegments(new Set(candidateUnits(next.taskType, next.output).map((_, index) => index)))
      setStreamOutput('')
    }
    catch (error) {
      const message = controller.signal.aborted ? '已停止生成，未写入正文' : error instanceof Error ? error.message : 'AI 任务失败'
      setRunNotice(message); setStreamOutput(''); if (!controller.signal.aborted) notify('error', message)
    }
    finally { if (runController.current === controller) runController.current = null; setRunning(false) }
  }

  function stop() { runController.current?.abort(); setProgress('正在停止本地生成') }

  function toggle(id: string) { setContext((items) => items.map((item) => item.id === id && item.privacyLevel !== 'local_private' ? { ...item, selected: !item.selected } : item)) }
  async function accept() {
    if (!result || selectedSegments.size === 0) return
    try {
      await api.recordAiDecision(projectId, node.id, result.taskId, 'accepted')
      const text = candidateUnits(result.taskType, result.output).filter((_, index) => selectedSegments.has(index)).join(result.taskType === 'brainstorm' ? '\n\n' : '')
      window.dispatchEvent(new CustomEvent('bbd:accept-ai', { detail: { text, taskId: result.taskId } })); setAccepted(true)
    } catch (error) { notify('error', error instanceof Error ? error.message : 'AI 接受记录失败') }
  }
  async function reject() {
    if (!result) return
    try { await api.recordAiDecision(projectId, node.id, result.taskId, 'rejected'); setResult(null) }
    catch (error) { notify('error', error instanceof Error ? error.message : 'AI 丢弃记录失败') }
  }
  async function undoAccept() {
    if (!result) return
    try { await api.recordAiDecision(projectId, node.id, result.taskId, 'undone'); window.dispatchEvent(new Event('bbd:undo-ai')); setAccepted(false) }
    catch (error) { notify('error', error instanceof Error ? error.message : 'AI 撤销记录失败') }
  }
  return <div className="panel-stack">
    <section className="context-capsule"><button onClick={() => setContextOpen(!contextOpen)}><span><LockKeyhole size={14} />本次上下文</span><strong>{selected.length} 项 · 约 {tokens} token</strong><ChevronDown className={contextOpen ? 'rotated' : ''} size={15} /></button>
      {contextOpen && <div className="context-items">{context.map((item) => <label key={`${item.type}-${item.id}`} className={item.privacyLevel === 'local_private' ? 'private' : ''}><input type="checkbox" checked={item.selected} disabled={item.privacyLevel === 'local_private'} onChange={() => toggle(item.id)} /><span><strong>{item.title}</strong><small>{item.privacyLevel === 'local_private' ? '仅本地，不会发送' : `${item.reason} · ${item.estimatedTokens} token`}</small></span></label>)}</div>}
    </section>
    <section className="inspector-section"><header><span className="section-icon"><Bot size={15} /></span><h3>创作助手</h3></header>
      <p className={`ai-provider-status ${provider?.kind === 'ollama' ? 'is-live' : 'is-demo'}`}>{providerLabel}</p>
      <div className="task-grid">{[['brainstorm','脑暴'],['continue','续写'],['rewrite','改写'],['cold_read','冷读']].map(([value,label]) => <button key={value} className={task === value ? 'active' : ''} onClick={() => setTask(value)}>{label}</button>)}</div>
      <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="补充你的要求（可选）" rows={3} />
      <button className="button primary full" disabled={running || selected.length === 0 || provider?.kind === 'blocked'} onClick={() => void run()}><WandSparkles size={16} />{running ? '正在生成…' : provider?.kind === 'blocked' ? '请先启用本地模型' : demoMode ? '生成演示候选' : '生成候选'}</button>
    </section>
    {running && <section className="ai-progress" role="status" aria-live="polite"><header><LoaderCircle className="ui-spin" size={16}/><div><strong>{progress}</strong><span>{elapsed} 秒 · 已生成 {streamOutput.length} 字</span></div><button type="button" onClick={stop}><Square size={12}/>停止</button></header>{streamOutput && <div className="ai-stream-output">{streamOutput}<span className="ai-stream-cursor" /></div>}</section>}
    {runNotice && !running && <p className="ai-run-notice"><CircleAlert size={14}/>{runNotice}</p>}
    {result && <section className="ai-result"><header><span><Sparkles size={15} />{result.model}</span><small>{result.inputTokens} → {result.outputTokens} token</small></header>{result.taskType === 'brainstorm' ? <BrainstormChoices value={result.output} accepted={accepted} selected={selectedSegments} onToggle={(index) => setSelectedSegments((current) => { const next = new Set(current); next.has(index) ? next.delete(index) : next.add(index); return next })} /> : <DiffText original={result.taskType === 'rewrite' ? context.find((item) => item.type === 'scene')?.content ?? '' : ''} value={result.output} accepted={accepted} selected={selectedSegments} onToggle={(index) => setSelectedSegments((current) => { const next = new Set(current); next.has(index) ? next.delete(index) : next.add(index); return next })} />}
      <div className="candidate-actions">{accepted ? <><span className="accepted-label"><Check size={14} />所选{result.taskType === 'brainstorm' ? '方向' : '句子'}已插入正文，并将记录为 AI 建议后接受</span><button className="reject" onClick={() => void undoAccept()}><RotateCcw size={14}/>撤销接受</button></> : <><button className="reject" onClick={() => void reject()}><X size={14} />丢弃</button><button className="accept" disabled={selectedSegments.size === 0} onClick={() => void accept()}><Check size={14} />接受所选 {selectedSegments.size} {result.taskType === 'brainstorm' ? '个方向' : '句'}</button></>}</div>
    </section>}
  </div>
}

function BrainstormChoices({ value, accepted, selected, onToggle }: { value: string; accepted: boolean; selected: Set<number>; onToggle: (index: number) => void }) {
  const directions = splitBrainstormDirections(value)
  if (!directions.length) return <DiffText original="" value={value} accepted={accepted} selected={selected} onToggle={onToggle} />
  return <div className={`brainstorm-choices ${accepted ? 'accepted' : ''}`}>{directions.map((direction, index) => <label className={`brainstorm-choice ${selected.has(index) ? 'selected' : ''}`} key={`${direction.title}-${index}`}>
    <header><input type="checkbox" aria-label={`选择${direction.title}`} checked={selected.has(index)} disabled={accepted} onChange={() => onToggle(index)} /><span>{direction.title}</span></header>
    {direction.premise && <strong>{direction.premise}</strong>}
    <div className="brainstorm-choice-details">
      {direction.opportunity && <p><span>机会</span>{direction.opportunity}</p>}
      {direction.risk && <p className="risk"><span>风险</span>{direction.risk}</p>}
      {!direction.opportunity && !direction.risk && <p>{direction.text.replace(/^方向[^：:]+[：:]\s*/, '')}</p>}
    </div>
  </label>)}</div>
}

function DiffText({ original, value, accepted, selected, onToggle }: { original: string; value: string; accepted: boolean; selected: Set<number>; onToggle: (index: number) => void }) {
  const segments = splitSentenceCandidates(value)
  return <div className={`diff-output ${accepted ? 'accepted' : ''}`}>{original && <div className="diff-comparison"><small>原文 ↔ 候选</small><p>{diffWords(original, value).map((part, index) => <span key={index} className={part.added ? 'diff-added' : part.removed ? 'diff-removed' : ''}>{part.value}</span>)}</p></div>}{segments.map((segment, index) => <label className="diff-segment" key={index}><input type="checkbox" checked={selected.has(index)} disabled={accepted} onChange={() => onToggle(index)} /><span>{diffWords('', segment).map((part, partIndex) => <span key={partIndex} className={part.added ? 'diff-added' : ''}>{part.value}</span>)}</span></label>)}</div>
}

function sourceLabel(source: Revision['provenanceLabel']) { return ({ human: '人工编辑', human_after_ai: 'AI 后人工修订', import: '导入', ai_accepted: 'AI 建议后接受', restore: '恢复', merge: '合并' } as const)[source] }
function revisionGroup(revision: Revision): 'human' | 'ai' | 'system' { return revision.provenanceLabel === 'ai_accepted' ? 'ai' : ['human','human_after_ai'].includes(revision.provenanceLabel) ? 'human' : 'system' }
