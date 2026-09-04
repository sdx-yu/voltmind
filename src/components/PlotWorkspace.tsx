import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2, Clock3, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { Entity, Foreshadow, ForeshadowStatus, ManuscriptNode } from '../../shared/types'
import { compareStoryTime, describeStoryTime, storyTimeSortValue } from '../../shared/storyTime'
import { sceneStatusLabel } from '../lib/status'
import { api } from '../lib/api'
import { ConfirmDialog } from './ConfirmDialog'
import { Modal } from './Modal'
import { StoryBlueprintWorkspace } from './StoryBlueprintWorkspace'
import { BoardTemplate, Button, IconButton, PageHeader, SegmentedControl, SelectableCard, SelectField, TextareaField, TextField } from '../ui'

type PlotView = 'blueprint' | 'narrative' | 'story' | 'foreshadows'
const stages: Array<{ status: ForeshadowStatus; label: string; hint: string }> = [
  { status: 'planted', label: '建立', hint: '读者已经看见，但未必理解' },
  { status: 'reinforced', label: '强化', hint: '再次出现，增加相关性' },
  { status: 'misdirected', label: '误导', hint: '提供一个可被推翻的解释' },
  { status: 'resolved', label: '回收', hint: '让线索产生明确后果' },
]

export function PlotWorkspace({ projectId, nodes, entities, initialView = 'narrative', onSelectScene, notify }: { projectId: string; nodes: ManuscriptNode[]; entities: Entity[]; initialView?: PlotView; onSelectScene: (id: string) => void; notify: (type: 'success' | 'error', message: string) => void }) {
  const [view, setView] = useState<PlotView>(initialView)
  const [foreshadows, setForeshadows] = useState<Foreshadow[]>([])
  const [creating, setCreating] = useState(false)
  const [transitioning, setTransitioning] = useState<{ item: Foreshadow; action: ForeshadowStatus } | null>(null)
  const [pendingTrash, setPendingTrash] = useState<Foreshadow | null>(null)
  const [busy, setBusy] = useState(false)
  const chapters = useMemo(() => nodes.filter((node) => node.type === 'chapter' && !node.deletedAt).sort((a, b) => a.sortKey - b.sortKey), [nodes])
  const scenes = useMemo(() => chapters.flatMap((chapter) => nodes.filter((node) => node.parentId === chapter.id && node.type === 'scene' && !node.deletedAt).sort((a, b) => a.sortKey - b.sortKey)), [chapters, nodes])
  const storyScenes = useMemo(() => [...scenes].sort((a, b) => compareStoryTime(a, b, scenes)), [scenes])
  async function refreshForeshadows() { setForeshadows(await api.listForeshadows(projectId)) }
  useEffect(() => { void refreshForeshadows().catch(() => notify('error', '伏笔数据加载失败')) }, [projectId])

  async function create(input: ForeshadowFormInput) {
    setBusy(true)
    try { await api.createForeshadow(projectId, input); await refreshForeshadows(); setCreating(false); notify('success', '伏笔已建立，并写入生命周期') }
    catch (error) { notify('error', error instanceof Error ? error.message : '伏笔建立失败') }
    finally { setBusy(false) }
  }
  async function transition(input: TransitionInput) {
    if (!transitioning) return
    setBusy(true)
    try { await api.transitionForeshadow(transitioning.item.id, { action: transitioning.action, ...input }); await refreshForeshadows(); setTransitioning(null); notify('success', `伏笔已${stageLabel(transitioning.action)}，证据链已更新`) }
    catch (error) { notify('error', error instanceof Error ? error.message : '伏笔阶段更新失败') }
    finally { setBusy(false) }
  }
  async function trash() {
    if (!pendingTrash) return
    await api.trashForeshadow(pendingTrash.id); await refreshForeshadows(); setPendingTrash(null); notify('success', '伏笔已移出当前看板')
  }

  return <BoardTemplate className="plot-workspace"><PageHeader tone="editorial" eyebrow="规划" title={view === 'blueprint' ? '先确定故事要去哪里' : '从叙述顺序看见故事时间'} description={view === 'blueprint' ? '蓝图约束走向与结局，但不替正文规定唯一写法。' : '同一份场景数据驱动双时间轴；伏笔的每次变化都保留场景证据。'} actions={<SegmentedControl label="规划视图" value={view} onChange={(value) => setView(value as PlotView)} items={[{ id: 'blueprint', label: '故事蓝图' }, { id: 'narrative', label: '叙述顺序' }, { id: 'story', label: '故事时间' }, { id: 'foreshadows', label: '伏笔看板' }]} />} />
    {view === 'blueprint' && <StoryBlueprintWorkspace projectId={projectId} scenes={scenes} notify={notify} />}
    {view === 'narrative' && <div className="plot-grid"><div className="plot-grid-label"><span>章节 / 场景</span><small>{scenes.length} 个场景</small></div>{chapters.map((chapter) => <div key={chapter.id} className="plot-column"><header><strong>{chapter.title}</strong><small>{nodes.filter((node) => node.parentId === chapter.id && node.type === 'scene' && !node.deletedAt).length} 场</small></header>{nodes.filter((node) => node.parentId === chapter.id && node.type === 'scene' && !node.deletedAt).sort((a, b) => a.sortKey - b.sortKey).map((scene) => <SceneCard key={scene.id} scene={scene} entities={entities} onSelect={onSelectScene} />)}</div>)}</div>}
    {view === 'story' && <div className="dual-timeline"><div className="timeline-summary"><span><Clock3 size={16} />故事实际时间</span><strong>{storyScenes.filter((scene) => storyTimeSortValue(scene, scenes) !== null).length}/{scenes.length} 场可排序</strong><small>同一时间体系内按结构坐标排序；不同体系保留叙事顺序，未定场景置后。</small></div><TimelineLane label="故事时间" hint="按实际发生先后" scenes={storyScenes} alternate={scenes} suffix="叙述序" onSelect={onSelectScene}/><TimelineLane label="叙述顺序" hint="读者看到的先后" scenes={scenes} alternate={storyScenes} suffix="故事序" onSelect={onSelectScene} narrative/></div>}
    {view === 'foreshadows' && <div className="foreshadow-workspace"><div className="foreshadow-toolbar" role="group" aria-label="伏笔摘要与操作"><div className="foreshadow-summary"><strong>{foreshadows.filter((item) => item.status !== 'resolved').length} 条未回收</strong><span>高优先级 {foreshadows.filter((item) => item.status !== 'resolved' && item.importance === 'high').length} 条</span></div><Button className="foreshadow-create-action" variant="primary" size="small" leadingIcon={<Plus size={15} />} onClick={() => setCreating(true)}>建立伏笔</Button></div><div className="foreshadow-board">{stages.map((stage) => <section className={`foreshadow-column stage-${stage.status}`} key={stage.status}><header><div><strong>{stage.label}</strong><span>{foreshadows.filter((item) => item.status === stage.status).length}</span></div><small>{stage.hint}</small></header><div>{foreshadows.filter((item) => item.status === stage.status).map((item) => <article className="foreshadow-card" key={item.id}><div className="foreshadow-card-head"><span className={`importance importance-${item.importance}`}>{importanceLabel(item.importance)}</span><IconButton size="small" onClick={() => setPendingTrash(item)} label={`移除伏笔 ${item.title}`}><Trash2 size={13}/></IconButton></div><h3>{item.title}</h3>{item.summary && <p>{item.summary}</p>}{item.plannedPayoff && <div className="payoff"><Sparkles size={13}/><span>计划回收：{item.plannedPayoff}</span></div>}<ol className="foreshadow-history">{item.events.slice(-3).map((event) => <li key={event.id}><span>{stageLabel(event.action)}</span><small>{sceneTitle(event.nodeId, scenes)}{event.evidence ? ` · “${event.evidence}”` : ''}</small></li>)}</ol><div className="foreshadow-actions">{nextActions(item.status).map((action) => <button key={action} onClick={() => setTransitioning({ item, action })}>{action === 'resolved' ? <CheckCircle2 size={13}/> : <ArrowRight size={13}/>} {stageLabel(action)}</button>)}</div></article>)}</div></section>)}</div></div>}
    {creating && <ForeshadowForm scenes={scenes} busy={busy} onClose={() => setCreating(false)} onSubmit={create} />}
    {transitioning && <TransitionForm item={transitioning.item} action={transitioning.action} scenes={scenes} busy={busy} onClose={() => setTransitioning(null)} onSubmit={transition} />}
    {pendingTrash && <ConfirmDialog title="移出伏笔" message={`把伏笔“${pendingTrash.title}”移出当前看板？`} confirmLabel="移出看板" danger onConfirm={() => void trash()} onClose={() => setPendingTrash(null)} />}
  </BoardTemplate>
}

type ForeshadowFormInput = { title: string; summary: string; importance: Foreshadow['importance']; plannedPayoff: string; nodeId: string | null; evidence: string }
type TransitionInput = { nodeId: string | null; evidence: string; note: string }

function SceneCard({ scene, entities, onSelect }: { scene: ManuscriptNode; entities: Entity[]; onSelect: (id: string) => void }) { const pov = entities.find((entity) => entity.id === scene.povEntityId && entity.type === 'character' && !entity.deletedAt); return <SelectableCard className="scene-card" title={scene.title} description={`${pov ? `POV · ${pov.canonicalName}` : '未指定 POV'} · ${sceneStatusLabel(scene.status)}`} onClick={() => onSelect(scene.id)}><span className={`status-line status-${scene.status}`} /><footer><span>{scene.wordCount} 字</span><span>{describeStoryTime(scene, [scene])}</span></footer></SelectableCard> }
function TimelineLane({ label, hint, scenes, alternate, suffix, onSelect, narrative = false }: { label: string; hint: string; scenes: ManuscriptNode[]; alternate: ManuscriptNode[]; suffix: string; onSelect: (id: string) => void; narrative?: boolean }) { const all = [...new Map([...scenes, ...alternate].map((scene) => [scene.id, scene])).values()]; return <div className={`timeline-lane ${narrative ? 'narrative-lane' : ''}`}><div className="lane-label"><strong>{label}</strong><small>{hint}</small></div><div className="lane-track">{scenes.map((scene, index) => <div key={scene.id} className={`timeline-card ${storyTimeSortValue(scene, all) !== null ? '' : 'untimed'}`}><span className="timeline-index">{index + 1}</span><button onClick={() => onSelect(scene.id)}><time>{describeStoryTime(scene, all)}</time><strong>{scene.title}</strong><small>{suffix} #{alternate.indexOf(scene) + 1}</small></button></div>)}</div></div> }

function ForeshadowForm({ scenes, busy, onClose, onSubmit }: { scenes: ManuscriptNode[]; busy: boolean; onClose: () => void; onSubmit: (input: ForeshadowFormInput) => void }) {
  const [name, setName] = useState(''); const [summary, setSummary] = useState(''); const [importance, setImportance] = useState<Foreshadow['importance']>('medium'); const [plannedPayoff, setPlannedPayoff] = useState(''); const [nodeId, setNodeId] = useState(''); const [evidence, setEvidence] = useState('')
  return <Modal title="建立新伏笔" onClose={onClose}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSubmit({ title: name, summary, importance, plannedPayoff, nodeId: nodeId || null, evidence }) }}><TextField label="伏笔名称" required showCount autoFocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：反复停摆的旧怀表" /><TextareaField label="它让读者注意到什么" optional value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="只写已知线索，不提前揭底" /><TextareaField label="计划如何回收" optional value={plannedPayoff} onChange={(event) => setPlannedPayoff(event.target.value)} placeholder="作者私有的回收计划" /><div className="form-grid"><SelectField label="优先级" value={importance} onValueChange={(value) => setImportance(value as Foreshadow['importance'])}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></SelectField><SelectField label="建立场景" optional value={nodeId} onValueChange={setNodeId}><option value="">暂不关联</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</SelectField></div><TextField label="正文证据" optional value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="可粘贴一个短句，便于回看" /><div className="modal-actions"><Button variant="ghost" onClick={onClose}>取消</Button><Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>{busy ? '正在保存…' : '建立并留痕'}</Button></div></form></Modal>
}

function TransitionForm({ item, action, scenes, busy, onClose, onSubmit }: { item: Foreshadow; action: ForeshadowStatus; scenes: ManuscriptNode[]; busy: boolean; onClose: () => void; onSubmit: (input: TransitionInput) => void }) {
  const [nodeId, setNodeId] = useState(''); const [evidence, setEvidence] = useState(''); const [note, setNote] = useState('')
  return <Modal title={`${stageLabel(action)} · ${item.title}`} onClose={onClose}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSubmit({ nodeId: nodeId || null, evidence, note }) }}><p className="form-hint">本次变化会追加到证据链，不会覆盖之前的阶段记录。</p><SelectField label="发生场景" optional value={nodeId} onValueChange={setNodeId}><option value="">暂不关联</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</SelectField><TextField label="正文证据" optional value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="例如：他第三次拨动停摆的指针" /><TextareaField label="作者备注" optional value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录这次安排的意图" /><div className="modal-actions"><Button variant="ghost" onClick={onClose}>取消</Button><Button type="submit" variant="primary" loading={busy}>{busy ? '正在保存…' : `确认${stageLabel(action)}`}</Button></div></form></Modal>
}

function nextActions(status: ForeshadowStatus): ForeshadowStatus[] { return status === 'resolved' ? ['reinforced'] : status === 'planted' ? ['reinforced', 'misdirected', 'resolved'] : (['reinforced', 'misdirected', 'resolved'] as ForeshadowStatus[]).filter((item) => item !== status) }
function stageLabel(status: ForeshadowStatus) { return stages.find((stage) => stage.status === status)?.label ?? status }
function importanceLabel(value: Foreshadow['importance']) { return ({ high: '高', medium: '中', low: '低' } as const)[value] }
function sceneTitle(nodeId: string | null, scenes: ManuscriptNode[]) { return nodeId ? scenes.find((scene) => scene.id === nodeId)?.title ?? '已删除场景' : '未关联场景' }
