import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Compass, Flag, Link2, PencilLine, Plus, Route, Sparkles, Trash2 } from 'lucide-react'
import type { ManuscriptNode, StoryBeat, StoryBeatAct, StoryBlueprint, StoryPlan } from '../../shared/types'
import { api } from '../lib/api'
import { Button, CheckboxField, SelectField, TextareaField, TextField } from '../ui'
import { ConfirmDialog } from './ConfirmDialog'
import { Modal } from './Modal'

const coreFields: Array<keyof Pick<StoryBlueprint, 'premise' | 'coreConflict' | 'protagonistGoal' | 'stakes' | 'climaxChoice' | 'endingState'>> = ['premise', 'coreConflict', 'protagonistGoal', 'stakes', 'climaxChoice', 'endingState']

export function StoryBlueprintWorkspace({ projectId, scenes, notify }: { projectId: string; scenes: ManuscriptNode[]; notify: (type: 'success' | 'error', message: string) => void }) {
  const [plan, setPlan] = useState<StoryPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingBlueprint, setEditingBlueprint] = useState(false)
  const [editingBeat, setEditingBeat] = useState<StoryBeat | 'new' | null>(null)
  const [pendingDelete, setPendingDelete] = useState<StoryBeat | null>(null)
  const [busy, setBusy] = useState(false)
  async function refresh() { setPlan(await api.getStoryPlan(projectId)) }
  useEffect(() => { setLoading(true); void refresh().catch(() => notify('error', '故事蓝图加载失败')).finally(() => setLoading(false)) }, [projectId])

  const completion = useMemo(() => plan ? Math.round(coreFields.filter((field) => plan.blueprint[field].trim()).length / coreFields.length * 100) : 0, [plan])
  async function installStarter() {
    setBusy(true)
    try { setPlan(await api.installStoryStarter(projectId)); notify('success', '已建立九个关键节拍，正文结构没有被改动') }
    catch (error) { notify('error', error instanceof Error ? error.message : '节拍建立失败') }
    finally { setBusy(false) }
  }
  async function removeBeat() {
    if (!pendingDelete) return
    setBusy(true)
    try { await api.trashStoryBeat(pendingDelete.id); await refresh(); setPendingDelete(null); notify('success', '节拍已移出蓝图，关联场景保持不变') }
    catch (error) { notify('error', error instanceof Error ? error.message : '移除失败') }
    finally { setBusy(false) }
  }

  if (loading) return <div className="story-plan-loading" aria-label="正在加载故事蓝图"><span/><span/><span/></div>
  if (!plan) return <div className="story-plan-error"><AlertTriangle size={22}/><strong>暂时无法读取故事蓝图</strong><Button size="small" onClick={() => void refresh()}>重试</Button></div>

  const groups: Array<{ act: StoryBeatAct; label: string; hint: string }> = [
    { act: 'opening', label: '开端', hint: '承诺故事，并让主角跨过门槛' },
    { act: 'middle', label: '发展', hint: '让方法受压、目标转向、代价升级' },
    { act: 'ending', label: '结局', hint: '迫使抉择，兑现冲突，形成新平衡' },
    { act: 'custom', label: '自定义', hint: '支线、单元或你自己的结构节点' },
  ]
  return <div className="story-blueprint">
    <section className="story-north-star">
      <header><div className="story-section-icon"><Compass size={19}/></div><div><span>故事航向</span><h2>{plan.blueprint.premise || '先写下一句话，确定故事为什么值得发生'}</h2></div><Button size="small" variant="secondary" leadingIcon={<PencilLine size={14}/>} onClick={() => setEditingBlueprint(true)}>编辑蓝图</Button></header>
      <div className="story-compass-grid">
        <BlueprintFact label="核心冲突" value={plan.blueprint.coreConflict} placeholder="谁想要什么，什么力量阻止他" />
        <BlueprintFact label="失败代价" value={plan.blueprint.stakes} placeholder="如果失败，会具体失去什么" />
        <BlueprintFact label="高潮抉择" value={plan.blueprint.climaxChoice} placeholder="最终必须作出的两难选择" />
        <BlueprintFact label="结局状态" value={plan.blueprint.endingState} placeholder="故事结束时，世界和人物变成什么样" />
      </div>
      <footer><span><Route size={15}/>蓝图完整度 <strong>{completion}%</strong></span>{plan.blueprint.genre && <em>{plan.blueprint.genre}</em>}{plan.blueprint.targetWords && <em>目标 {plan.blueprint.targetWords.toLocaleString('zh-CN')} 字</em>}</footer>
    </section>

    {(plan.blueprint.mustKeep.length > 0 || plan.blueprint.mustAvoid.length > 0) && <section className="story-guardrails"><header><Flag size={17}/><strong>创作边界</strong><span>AI 生成时自动带入</span></header><div><GuardrailList title="必须保留" values={plan.blueprint.mustKeep} positive/><GuardrailList title="不得发生" values={plan.blueprint.mustAvoid}/></div></section>}

    <section className="story-beats-section">
      <header><div><span className="eyebrow">关键节拍</span><h2>从开场承诺走到结局兑现</h2><p>节拍是剧情任务，不是正文目录；一个节拍可以关联零到多个场景。</p></div><Button size="small" variant="secondary" leadingIcon={<Plus size={14}/>} onClick={() => setEditingBeat('new')}>添加节拍</Button></header>
      {plan.beats.length === 0 ? <div className="story-beats-empty"><Sparkles size={25}/><strong>还没有剧情骨架</strong><span>建立一套可改写的三幕关键节拍；不会自动生成章节，也不会替你决定情节。</span><Button variant="primary" loading={busy} onClick={() => void installStarter()}>建立三幕关键节拍</Button></div>
        : <div className="story-act-grid">{groups.filter((group) => plan.beats.some((beat) => beat.act === group.act)).map((group) => <section className={`story-act act-${group.act}`} key={group.act}><header><strong>{group.label}</strong><span>{plan.beats.filter((beat) => beat.act === group.act).length}</span><small>{group.hint}</small></header><div>{plan.beats.filter((beat) => beat.act === group.act).map((beat, index) => <article className={`story-beat status-${beat.status}`} key={beat.id}><div className="story-beat-index">{index + 1}</div><div className="story-beat-main"><header><strong>{beat.title}</strong><span>{beatStatusLabel(beat.status)}</span></header><p>{beat.purpose || '尚未写下这个节拍要完成的剧情任务。'}</p>{beat.expectedChange && <small><Check size={13}/>变化：{beat.expectedChange}</small>}{beat.sceneIds.length > 0 ? <div className="story-beat-links"><Link2 size={13}/>{beat.sceneIds.map((id) => scenes.find((scene) => scene.id === id)?.title).filter(Boolean).join('、')}</div> : <div className="story-beat-links is-empty">尚未关联场景</div>}</div><div className="story-beat-actions"><button aria-label={`编辑节拍 ${beat.title}`} onClick={() => setEditingBeat(beat)}><PencilLine size={14}/></button><button aria-label={`移除节拍 ${beat.title}`} onClick={() => setPendingDelete(beat)}><Trash2 size={14}/></button></div></article>)}</div></section>)}</div>}
    </section>
    {editingBlueprint && <BlueprintDialog value={plan.blueprint} busy={busy} onClose={() => setEditingBlueprint(false)} onSave={async (patch) => { setBusy(true); try { await api.updateStoryBlueprint(projectId, patch); await refresh(); setEditingBlueprint(false); notify('success', '故事蓝图已保存，AI 上下文同步更新') } catch (error) { notify('error', error instanceof Error ? error.message : '保存失败') } finally { setBusy(false) } }} />}
    {editingBeat && <BeatDialog value={editingBeat === 'new' ? null : editingBeat} scenes={scenes} busy={busy} onClose={() => setEditingBeat(null)} onSave={async (input) => { setBusy(true); try { editingBeat === 'new' ? await api.createStoryBeat(projectId, input) : await api.updateStoryBeat(editingBeat.id, input); await refresh(); setEditingBeat(null); notify('success', '剧情节拍已保存') } catch (error) { notify('error', error instanceof Error ? error.message : '保存失败') } finally { setBusy(false) } }} />}
    {pendingDelete && <ConfirmDialog title="移出剧情节拍" message={`移出“${pendingDelete.title}”？这不会删除已关联的正文场景。`} confirmLabel="移出蓝图" danger busy={busy} onConfirm={() => void removeBeat()} onClose={() => setPendingDelete(null)} />}
  </div>
}

function BlueprintFact({ label, value, placeholder }: { label: string; value: string; placeholder: string }) { return <div className={value ? '' : 'is-empty'}><span>{label}</span><p>{value || placeholder}</p></div> }
function GuardrailList({ title, values, positive = false }: { title: string; values: string[]; positive?: boolean }) { return <div className={positive ? 'positive' : 'negative'}><strong>{title}</strong>{values.length ? <ul>{values.map((value) => <li key={value}>{value}</li>)}</ul> : <span>未设置</span>}</div> }

function BlueprintDialog({ value, busy, onClose, onSave }: { value: StoryBlueprint; busy: boolean; onClose: () => void; onSave: (patch: Partial<StoryBlueprint>) => void }) {
  const [draft, setDraft] = useState(value)
  const set = (key: keyof StoryBlueprint, next: unknown) => setDraft((current) => ({ ...current, [key]: next }))
  return <Modal title="编辑故事蓝图" wide onClose={onClose}><form className="form-stack story-blueprint-form" onSubmit={(event) => { event.preventDefault(); onSave(draft) }}>
    <div className="form-grid"><SelectField label="规划方式" value={draft.approach} onValueChange={(value) => set('approach', value)}><option value="discovery">探索式 · 只定方向</option><option value="guided">引导式 · 关键节点</option><option value="structured">结构式 · 完整规划</option></SelectField><TextField label="类型 / 气质" optional maxLength={80} value={draft.genre} onChange={(event) => set('genre', event.target.value)} placeholder="如：古风悬疑、都市情感" /></div>
    <TextareaField label="一句话故事前提" optional maxLength={1200} value={draft.premise} onChange={(event) => set('premise', event.target.value)} placeholder="当……发生，一个……的人必须……否则……" />
    <div className="form-grid"><TextareaField label="核心冲突" optional value={draft.coreConflict} onChange={(event) => set('coreConflict', event.target.value)} placeholder="欲望与阻力如何持续对撞" /><TextareaField label="失败代价" optional value={draft.stakes} onChange={(event) => set('stakes', event.target.value)} placeholder="失败后具体失去什么" /></div>
    <div className="form-grid"><TextareaField label="主角想要" optional value={draft.protagonistGoal} onChange={(event) => set('protagonistGoal', event.target.value)} /><TextareaField label="主角真正需要" optional value={draft.protagonistNeed} onChange={(event) => set('protagonistNeed', event.target.value)} /></div>
    <TextareaField label="主题追问" optional value={draft.thematicQuestion} onChange={(event) => set('thematicQuestion', event.target.value)} placeholder="故事不断追问、但不急着说教的问题" />
    <div className="form-grid"><TextareaField label="高潮抉择" optional value={draft.climaxChoice} onChange={(event) => set('climaxChoice', event.target.value)} /><TextareaField label="结局状态" optional value={draft.endingState} onChange={(event) => set('endingState', event.target.value)} /></div>
    <TextareaField label="结局揭示 / 最终答案" optional value={draft.endingTruth} onChange={(event) => set('endingTruth', event.target.value)} />
    <div className="form-grid"><TextareaField label="必须保留" optional description="每行一条，最多 12 条" value={draft.mustKeep.join('\n')} onChange={(event) => set('mustKeep', lines(event.target.value))} placeholder="主角最终必须亲自作出选择" /><TextareaField label="不得发生" optional description="每行一条，最多 12 条" value={draft.mustAvoid.join('\n')} onChange={(event) => set('mustAvoid', lines(event.target.value))} placeholder="不靠突然出现的新能力解决高潮" /></div>
    <TextField label="目标字数" optional type="number" min={1000} max={10000000} value={draft.targetWords ?? ''} onChange={(event) => set('targetWords', event.target.value ? Number(event.target.value) : null)} placeholder="例如 120000" />
    <div className="modal-actions"><Button variant="ghost" onClick={onClose}>取消</Button><Button type="submit" variant="primary" loading={busy}>保存故事蓝图</Button></div>
  </form></Modal>
}

function BeatDialog({ value, scenes, busy, onClose, onSave }: { value: StoryBeat | null; scenes: ManuscriptNode[]; busy: boolean; onClose: () => void; onSave: (input: Pick<StoryBeat, 'act' | 'title' | 'purpose' | 'expectedChange' | 'caution' | 'status' | 'sceneIds'>) => void }) {
  const [act, setAct] = useState<StoryBeatAct>(value?.act ?? 'custom'); const [title, setTitle] = useState(value?.title ?? ''); const [purpose, setPurpose] = useState(value?.purpose ?? ''); const [expectedChange, setExpectedChange] = useState(value?.expectedChange ?? ''); const [caution, setCaution] = useState(value?.caution ?? ''); const [status, setStatus] = useState<StoryBeat['status']>(value?.status ?? 'planned'); const [sceneIds, setSceneIds] = useState(value?.sceneIds ?? [])
  return <Modal title={value ? '编辑剧情节拍' : '添加剧情节拍'} wide onClose={onClose}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSave({ act, title, purpose, expectedChange, caution, status, sceneIds }) }}><div className="form-grid"><SelectField label="结构位置" value={act} onValueChange={(next) => setAct(next as StoryBeatAct)}><option value="opening">开端</option><option value="middle">发展</option><option value="ending">结局</option><option value="custom">自定义</option></SelectField><SelectField label="进度" value={status} onValueChange={(next) => setStatus(next as StoryBeat['status'])}><option value="planned">待安排</option><option value="drafting">写作中</option><option value="fulfilled">已兑现</option><option value="skipped">已跳过</option></SelectField></div><TextField label="节拍名称" required maxLength={120} autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /><TextareaField label="剧情任务" optional value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="这个节点必须完成什么，而不是要写哪一章" /><div className="form-grid"><TextareaField label="发生什么变化" optional value={expectedChange} onChange={(event) => setExpectedChange(event.target.value)} /><TextareaField label="避免什么" optional value={caution} onChange={(event) => setCaution(event.target.value)} /></div><fieldset className="story-scene-picker"><legend>关联正文场景 <span>选填，可多选</span></legend>{scenes.length ? <div>{scenes.map((scene) => <CheckboxField key={scene.id} label={scene.title} checked={sceneIds.includes(scene.id)} onChange={(event) => setSceneIds((current) => event.target.checked ? [...current, scene.id] : current.filter((id) => id !== scene.id))} />)}</div> : <p>还没有可关联的正文场景。</p>}</fieldset><div className="modal-actions"><Button variant="ghost" onClick={onClose}>取消</Button><Button type="submit" variant="primary" loading={busy} disabled={!title.trim()}>保存剧情节拍</Button></div></form></Modal>
}

function lines(value: string) { return value.split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 12) }
function beatStatusLabel(status: StoryBeat['status']) { return ({ planned: '待安排', drafting: '写作中', fulfilled: '已兑现', skipped: '已跳过' } as const)[status] }
