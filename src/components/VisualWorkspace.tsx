import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Check, Clipboard, ImagePlus, Images, Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react'
import type { Entity, EntityState, ManuscriptNode, Project, Storyboard, VisualAnchor, VisualSelectedField } from '../../shared/types'
import { api } from '../lib/api'
import { Modal } from './Modal'
import { SelectControl } from '../ui'

type Props = {
  project: Project
  nodes: ManuscriptNode[]
  entities: Entity[]
  onBack: () => void
  notify: (type: 'success' | 'error', message: string) => void
}

export function VisualWorkspace({ project, nodes, entities, onBack, notify }: Props) {
  const [anchors, setAnchors] = useState<VisualAnchor[]>([])
  const [storyboards, setStoryboards] = useState<Storyboard[]>([])
  const [anchorId, setAnchorId] = useState('')
  const [sceneId, setSceneId] = useState('')
  const [creatingAnchor, setCreatingAnchor] = useState(false)
  const [busy, setBusy] = useState(false)
  const scenes = useMemo(() => nodes.filter((node) => node.type === 'scene' && !node.deletedAt), [nodes])
  const anchor = anchors.find((item) => item.id === anchorId) ?? anchors[0] ?? null
  const storyboard = storyboards.find((item) => item.sceneId === sceneId) ?? null

  async function refresh(preferredAnchorId?: string) {
    const [nextAnchors, nextBoards] = await Promise.all([api.listVisualAnchors(project.id), api.listStoryboards(project.id)])
    setAnchors(nextAnchors); setStoryboards(nextBoards)
    const nextAnchorId = preferredAnchorId || anchorId || nextAnchors[0]?.id || ''
    if (nextAnchors.some((item) => item.id === nextAnchorId)) setAnchorId(nextAnchorId)
    if (!sceneId && scenes[0]) setSceneId(scenes[0].id)
  }
  useEffect(() => { void refresh().catch((error) => notify('error', error instanceof Error ? error.message : '视觉工作台加载失败')) }, [project.id])

  async function createAnchor(input: { entityId: string; selectedFields: VisualSelectedField[]; styleNote: string }) {
    setBusy(true)
    try { const created = await api.createVisualAnchor(project.id, input); await refresh(created.id); setCreatingAnchor(false); notify('success', '视觉锚点已绑定当前文字正典') }
    catch (error) { notify('error', error instanceof Error ? error.message : '视觉锚点创建失败') }
    finally { setBusy(false) }
  }

  async function refreshAnchor() {
    if (!anchor) return
    setBusy(true)
    try { await api.refreshVisualAnchor(anchor.id, { selectedFields: anchor.selectedFields, styleNote: anchor.styleNote }); await refresh(anchor.id); notify('success', '已从明确选择的正典字段刷新视觉描述；既有图片仍需复核') }
    catch (error) { notify('error', error instanceof Error ? error.message : '视觉锚点刷新失败') }
    finally { setBusy(false) }
  }

  async function importImage(file: File) {
    if (!anchor) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) return notify('error', '只接受真实 PNG 或 JPEG 图片')
    if (!file.size || file.size > 10 * 1024 * 1024) return notify('error', '图片需小于 10 MiB')
    setBusy(true)
    try {
      await api.importVisualCandidate(anchor.id, { fileName: file.name, mimeType: file.type as 'image/png' | 'image/jpeg', contentBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer())) })
      await refresh(anchor.id); notify('success', '图片已作为候选导入；确认前不会绑定正典')
    } catch (error) { notify('error', error instanceof Error ? error.message : '图片候选导入失败') }
    finally { setBusy(false) }
  }

  async function resolveCandidate(id: string, decision: 'accepted' | 'rejected') {
    setBusy(true)
    try { await api.resolveVisualCandidate(id, decision); await refresh(anchor?.id); notify('success', decision === 'accepted' ? '候选已绑定当前正典版本；文字正典未被修改' : '候选已拒绝并保留审计记录') }
    catch (error) { notify('error', error instanceof Error ? error.message : '候选处理失败') }
    finally { setBusy(false) }
  }

  async function ensureStoryboard() {
    if (!sceneId) return
    setBusy(true)
    try { await api.getOrCreateStoryboard(project.id, sceneId); await refresh(anchor?.id); notify('success', storyboard ? '故事板已打开' : '场景故事板已建立，不含正文') }
    catch (error) { notify('error', error instanceof Error ? error.message : '故事板创建失败') }
    finally { setBusy(false) }
  }

  async function addCard(input: { purpose: string; note: string; anchorIds: string[]; assetHash: string | null; visualDescription: string }) {
    if (!storyboard) return
    setBusy(true)
    try { await api.addStoryboardCard(storyboard.id, input); await refresh(anchor?.id); notify('success', '分镜卡已加入叙述顺序；未复制场景正文') }
    catch (error) { notify('error', error instanceof Error ? error.message : '分镜卡创建失败') }
    finally { setBusy(false) }
  }

  async function moveCard(id: string, direction: 'up' | 'down') {
    try { await api.moveStoryboardCard(id, direction); await refresh(anchor?.id) }
    catch (error) { notify('error', error instanceof Error ? error.message : '分镜顺序更新失败') }
  }

  async function deleteCard(id: string) {
    try { await api.deleteStoryboardCard(id); await refresh(anchor?.id); notify('success', '分镜卡已删除，图片与正典未受影响') }
    catch (error) { notify('error', error instanceof Error ? error.message : '分镜卡删除失败') }
  }

  async function copyDescription() {
    if (!anchor) return
    try { await navigator.clipboard.writeText(anchor.visualDescription); notify('success', '视觉描述已复制，可自行交给明确选择的图像工具') }
    catch { notify('error', '系统未允许写入剪贴板') }
  }

  return <section className="visual-workspace">
    <header className="page-header"><div><button className="button ghost compact" onClick={onBack}><ArrowLeft size={15}/>返回规划</button><span className="eyebrow">文字正典视觉锚点</span><h2>让画面服从文字正典</h2><p>图片始终先成为候选；接受只绑定当前正典快照，不会用图片反写人物、地点、物品或剧情事实。</p></div><button className="button primary" onClick={() => setCreatingAnchor(true)}><Plus size={15}/>建立视觉锚点</button></header>

    <div className="visual-guardrail"><ShieldCheck size={19}/><div><strong>本阶段不连接远程图像 Provider</strong><p>视觉描述完全在本机由明确勾选的字段生成；`local_private` 正典、正文、密钥和未选择字段不会进入描述。作者可复制描述并在外部工具生成，再把结果作为本地候选导入。</p></div></div>

    <div className="visual-layout">
      <section className="visual-panel visual-anchor-list"><header><div><h3>正典视觉锚点</h3><small>{anchors.length} 个</small></div></header>{anchors.length ? <div>{anchors.map((item) => <button key={item.id} className={item.id === anchor?.id ? 'active' : ''} onClick={() => setAnchorId(item.id)}>{item.acceptedAsset ? <img src={item.acceptedAsset.url} alt=""/> : <span className="visual-placeholder"><Images size={19}/></span>}<span><strong>{item.entityName}</strong><small>{entityTypeLabel(item.entityType)} · {bindingLabel(item.bindingStatus)}</small></span><em className={`binding-${item.bindingStatus}`}>{item.bindingStatus === 'current' ? '已绑定' : item.bindingStatus === 'stale' ? '待复核' : '无定稿'}</em></button>)}</div> : <div className="visual-empty"><Images size={26}/><strong>还没有视觉锚点</strong><p>先从人物、地点或物品正典选择允许进入描述的字段。</p></div>}</section>

      <section className="visual-panel visual-anchor-detail"><header><div><h3>{anchor?.entityName ?? '选择视觉锚点'}</h3><small>{anchor ? `${entityTypeLabel(anchor.entityType)} · 正典 ${anchor.canonHash.slice(0, 12)}` : '图片不会自动成为正典'}</small></div>{anchor && <button className="button ghost compact" disabled={busy} onClick={() => void refreshAnchor()}><RefreshCw size={14}/>刷新正典</button>}</header>{anchor ? <>
        <div className={`visual-binding-banner binding-${anchor.bindingStatus}`}><strong>{bindingLabel(anchor.bindingStatus)}</strong><span>{anchor.bindingStatus === 'stale' ? '已接受图片绑定的是旧正典快照。刷新描述后仍需导入并接受新候选。' : anchor.bindingStatus === 'current' ? '定稿图片与当前所选正典字段一致。' : '尚未接受任何视觉候选。'}</span></div>
        <div className="visual-description"><header><strong>本地视觉描述</strong><button className="icon-button" aria-label="复制视觉描述" onClick={() => void copyDescription()}><Clipboard size={14}/></button></header><p>{anchor.visualDescription}</p><footer>{anchor.selectedFields.map((field) => <span key={field}>{fieldLabel(field, anchor)}</span>)}</footer></div>
        <label className="visual-upload"><ImagePlus size={20}/><span><strong>{busy ? '正在处理…' : '导入 PNG / JPEG 候选'}</strong><small>真实类型校验 · 最大 10 MiB · SHA-256 去重</small></span><input aria-label="导入视觉候选" disabled={busy} type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importImage(file); event.currentTarget.value = '' }}/></label>
        <div className="visual-candidates">{anchor.candidates.map((candidate) => <article key={candidate.id} className={`candidate-${candidate.status}`}><img src={candidate.asset.url} alt={`${anchor.entityName} 的视觉候选`}/><div><strong>{candidate.fileName}</strong><small>{candidate.asset.width}×{candidate.asset.height} · {formatBytes(candidate.asset.byteSize)}</small><span>{candidate.status === 'pending' ? '待作者决定' : candidate.status === 'accepted' ? '当前定稿' : candidate.status === 'superseded' ? '旧版定稿' : '已拒绝'}</span></div>{candidate.status === 'pending' && <footer><button aria-label={`接受 ${candidate.fileName}`} disabled={busy} onClick={() => void resolveCandidate(candidate.id, 'accepted')}><Check size={14}/></button><button aria-label={`拒绝 ${candidate.fileName}`} disabled={busy} onClick={() => void resolveCandidate(candidate.id, 'rejected')}><X size={14}/></button></footer>}</article>)}{!anchor.candidates.length && <p className="muted">尚无候选图片。视觉描述不会自动发送到任何服务。</p>}</div>
      </> : <div className="visual-empty"><ShieldCheck size={26}/><p>选择左侧锚点查看正典快照与候选。</p></div>}</section>

      <section className="visual-panel storyboard-panel"><header><div><h3>场景故事板</h3><small>镜头卡不含正文</small></div></header><label className="storyboard-scene">场景<SelectControl aria-label="故事板场景" value={sceneId} onChange={(event) => setSceneId(event.target.value)}><option value="">选择场景</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</SelectControl></label>{sceneId && !storyboard && <button className="button secondary full" disabled={busy} onClick={() => void ensureStoryboard()}><Plus size={14}/>为该场景建立故事板</button>}{storyboard && <><StoryboardCardForm anchors={anchors} busy={busy} onSubmit={addCard}/><div className="storyboard-cards">{storyboard.cards.map((card, index) => <article key={card.id}>{card.asset ? <img src={card.asset.url} alt=""/> : <span className="visual-placeholder"><Images size={20}/></span>}<div><span>镜头 {index + 1}</span><strong>{card.purpose}</strong>{card.note && <p>{card.note}</p>}<small>{card.anchorIds.map((id) => anchors.find((item) => item.id === id)?.entityName).filter(Boolean).join('、') || '未绑定视觉锚点'}</small></div><footer><button aria-label="上移分镜" disabled={index === 0} onClick={() => void moveCard(card.id, 'up')}><ArrowUp size={13}/></button><button aria-label="下移分镜" disabled={index === storyboard.cards.length - 1} onClick={() => void moveCard(card.id, 'down')}><ArrowDown size={13}/></button><button aria-label="删除分镜" onClick={() => void deleteCard(card.id)}><Trash2 size={13}/></button></footer></article>)}{!storyboard.cards.length && <p className="muted">故事板为空。添加镜头目的，不需要复制场景正文。</p>}</div></>}</section>
    </div>
    {creatingAnchor && <AnchorForm entities={entities} busy={busy} onClose={() => setCreatingAnchor(false)} onSubmit={createAnchor}/>}
  </section>
}

function AnchorForm({ entities, busy, onClose, onSubmit }: { entities: Entity[]; busy: boolean; onClose: () => void; onSubmit: (input: { entityId: string; selectedFields: VisualSelectedField[]; styleNote: string }) => void }) {
  const eligible = entities.filter((entity) => ['character', 'location', 'item'].includes(entity.type))
  const [entityId, setEntityId] = useState(eligible.find((entity) => entity.privacyLevel !== 'local_private')?.id ?? '')
  const [states, setStates] = useState<EntityState[]>([])
  const [fields, setFields] = useState<VisualSelectedField[]>(['canonicalName'])
  const [styleNote, setStyleNote] = useState('')
  useEffect(() => { if (!entityId) return setStates([]); void api.listStates(entityId).then(setStates).catch(() => setStates([])) }, [entityId])
  function toggle(field: VisualSelectedField, checked: boolean) { setFields((current) => checked ? [...new Set([...current, field])] : current.filter((value) => value !== field)) }
  const entity = eligible.find((item) => item.id === entityId)
  return <Modal title="建立正典视觉锚点" onClose={onClose}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); onSubmit({ entityId, selectedFields: fields, styleNote }) }}><p className="form-hint">只有下方明确勾选的字段会进入本地视觉描述。仅本地正典不可选。</p><label>正典项<SelectControl required value={entityId} onChange={(event) => setEntityId(event.target.value)}><option value="">选择人物、地点或物品</option>{eligible.map((item) => <option key={item.id} value={item.id} disabled={item.privacyLevel === 'local_private'}>{item.canonicalName}{item.privacyLevel === 'local_private' ? '（仅本地，不可读取）' : ''}</option>)}</SelectControl></label><fieldset className="visual-field-picker"><legend>允许读取的字段</legend><label><input type="checkbox" checked disabled/>正典名称（必需）</label><label><input type="checkbox" checked={fields.includes('summary')} onChange={(event) => toggle('summary', event.target.checked)}/>简介{entity?.summary ? `：${entity.summary.slice(0, 50)}` : '（为空）'}</label><label><input type="checkbox" checked={fields.includes('aliases')} onChange={(event) => toggle('aliases', event.target.checked)}/>别名{entity?.aliases.length ? `：${entity.aliases.join('、')}` : '（为空）'}</label>{states.map((state) => <label key={state.id}><input type="checkbox" checked={fields.includes(`state:${state.id}`)} onChange={(event) => toggle(`state:${state.id}`, event.target.checked)}/>{state.attributeKey}：{String(state.value)}</label>)}</fieldset><label>作者视觉要求<textarea maxLength={1000} value={styleNote} onChange={(event) => setStyleNote(event.target.value)} placeholder="例如：写实概念设定、冷灰色调；这是作者输入，不是文字正典"/></label><div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={busy || !entityId || entity?.privacyLevel === 'local_private'}>{busy ? '正在建立…' : '绑定当前正典'}</button></div></form></Modal>
}

function StoryboardCardForm({ anchors, busy, onSubmit }: { anchors: VisualAnchor[]; busy: boolean; onSubmit: (input: { purpose: string; note: string; anchorIds: string[]; assetHash: string | null; visualDescription: string }) => void }) {
  const [purpose, setPurpose] = useState(''); const [note, setNote] = useState(''); const [anchorId, setAnchorId] = useState('')
  const anchor = anchors.find((item) => item.id === anchorId)
  return <form className="storyboard-form" onSubmit={(event) => { event.preventDefault(); onSubmit({ purpose, note, anchorIds: anchor ? [anchor.id] : [], assetHash: anchor?.acceptedAsset?.contentHash ?? null, visualDescription: anchor?.visualDescription ?? '' }); setPurpose(''); setNote('') }}><input aria-label="镜头目的" required maxLength={160} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="镜头目的，如：建立空间关系"/><SelectControl aria-label="镜头视觉锚点" value={anchorId} onChange={(event) => setAnchorId(event.target.value)}><option value="">不绑定锚点</option>{anchors.map((item) => <option key={item.id} value={item.id}>{item.entityName}{item.bindingStatus === 'stale' ? '（待复核）' : ''}</option>)}</SelectControl><textarea aria-label="镜头备注" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="连续性或调度备注，不粘贴正文"/><button className="button primary full" disabled={busy || !purpose.trim()}><Plus size={14}/>添加分镜卡</button></form>
}

function bindingLabel(status: VisualAnchor['bindingStatus']) { return status === 'current' ? '与当前正典一致' : status === 'stale' ? '正典已变化，图片待复核' : '尚无定稿图片' }
function entityTypeLabel(type: VisualAnchor['entityType']) { return ({ character: '人物', location: '地点', item: '物品' } as const)[type] }
function fieldLabel(field: VisualSelectedField, anchor: VisualAnchor) { if (field === 'canonicalName') return '正典名称'; if (field === 'summary') return '简介'; if (field === 'aliases') return '别名'; const value = anchor.canonSnapshot.values[field] as { attributeKey?: string } | undefined; return value?.attributeKey || '状态' }
function formatBytes(value: number) { return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KiB` }
function bytesToBase64(bytes: Uint8Array) { let binary = ''; const chunk = 0x8000; for (let offset = 0; offset < bytes.length; offset += chunk) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk)); return btoa(binary) }
