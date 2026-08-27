import { useEffect, useMemo, useState } from 'react'
import { diffWords } from 'diff'
import { ArrowLeft, Bot, CheckCircle2, Download, FileCheck2, FileJson2, Fingerprint, LocateFixed, ShieldCheck, Upload, UserRound, XCircle } from 'lucide-react'
import type { ManuscriptNode, Project, ProvenanceEvent, ProvenanceExportRecord, ProvenanceVerification, Revision } from '../../shared/types'
import { api } from '../lib/api'
import { Modal } from './Modal'

type Props = {
  project: Project
  nodes: ManuscriptNode[]
  onSelectScene: (id: string) => void
  onBack?: () => void
  notify: (type: 'success' | 'error', message: string) => void
}

type EventFilter = 'all' | 'human' | 'ai' | 'system'

export function ProvenanceWorkspace({ project, nodes, onSelectScene, onBack, notify }: Props) {
  const [events, setEvents] = useState<ProvenanceEvent[]>([])
  const [exports, setExports] = useState<ProvenanceExportRecord[]>([])
  const [nodeId, setNodeId] = useState('')
  const [filter, setFilter] = useState<EventFilter>('all')
  const [includeText, setIncludeText] = useState(false)
  const [busy, setBusy] = useState(false)
  const [verification, setVerification] = useState<ProvenanceVerification | null>(null)
  const [diff, setDiff] = useState<{ revision: Revision; parentText: string } | null>(null)
  const scenes = useMemo(() => nodes.filter((node) => node.type === 'scene' && !node.deletedAt), [nodes])

  async function refresh() {
    const [nextEvents, nextExports] = await Promise.all([api.listProvenance(project.id), api.listProvenanceExports(project.id)])
    setEvents(nextEvents); setExports(nextExports)
  }
  useEffect(() => { void refresh().catch((error) => notify('error', error instanceof Error ? error.message : '创作来源加载失败')) }, [project.id])

  const visible = events.filter((event) => (!nodeId || event.nodeId === nodeId) && (filter === 'all' || eventGroup(event) === filter)).slice().reverse()
  const humanCount = events.filter((event) => event.actorType === 'human').length
  const aiCount = events.filter((event) => event.actorType === 'ai' || event.sourceTaskId).length
  const systemCount = events.filter((event) => event.actorType === 'system').length
  const chainHead = events.at(-1)?.eventHash ?? ''

  async function exportBundle(format: 'json' | 'html') {
    setBusy(true)
    try {
      const result = await api.exportProvenance(project.id, format, includeText)
      const url = URL.createObjectURL(new Blob([result.content], { type: result.mimeType }))
      const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = result.fileName; anchor.click(); URL.revokeObjectURL(url)
      await refresh(); notify('success', `来源报告已导出：${result.eventCount} 条事件，清单 ${result.manifestHash.slice(0, 12)}`)
    } catch (error) { notify('error', error instanceof Error ? error.message : '来源报告导出失败') }
    finally { setBusy(false) }
  }

  async function verifyFile(file: File) {
    try {
      const value = JSON.parse(await file.text()) as unknown
      setVerification(await api.verifyProvenance(value))
    } catch (error) { setVerification({ ok: false, manifestHashValid: false, chainValid: false, eventCount: 0, message: error instanceof Error ? `验证失败：${error.message}` : '验证失败：文件无法读取' }) }
  }

  async function showDiff(event: ProvenanceEvent) {
    if (!event.nodeId || !event.revisionId) return
    try {
      const revisions = await api.listRevisions(event.nodeId)
      const revision = revisions.find((item) => item.id === event.revisionId)
      if (!revision) throw new Error('对应版本已不可用')
      setDiff({ revision, parentText: revisions.find((item) => item.id === revision.parentRevisionId)?.plainText ?? '' })
    } catch (error) { notify('error', error instanceof Error ? error.message : '版本差异加载失败') }
  }

  return <section className="provenance-workspace">
    <header className="page-header"><div>{onBack && <button className="button ghost compact" onClick={onBack}><ArrowLeft size={15} />返回交付</button>}<span className="eyebrow">创作来源</span><h2>每一次选择，都有来处</h2><p>默认只记录动作、关系与哈希，不保存提示词或 AI 输出正文；作者可明确选择在导出中加入正文摘录。</p></div></header>
    <div className="provenance-summary">
      <Summary icon={<UserRound size={19}/>} value={humanCount} label="人工决策与编辑" />
      <Summary icon={<Bot size={19}/>} value={aiCount} label="AI 参与事件" />
      <Summary icon={<ShieldCheck size={19}/>} value={systemCount} label="导入、恢复与系统动作" />
      <Summary icon={<Fingerprint size={19}/>} value={chainHead ? chainHead.slice(0, 12) : '尚无'} label="当前事件链头" code />
    </div>

    <div className="provenance-layout">
      <section className="provenance-card timeline-card-large">
        <header><div><h3>项目时间线</h3><small>{visible.length} / {events.length} 条事件</small></div><div className="provenance-filters"><select aria-label="按场景筛选" value={nodeId} onChange={(event) => setNodeId(event.target.value)}><option value="">全部场景</option>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</select><div>{([['all','全部'],['human','人工'],['ai','AI'],['system','系统']] as const).map(([value,label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div></div></header>
        <div className="provenance-timeline">{visible.length ? visible.map((event) => <article key={event.id} className={`provenance-event event-${eventGroup(event)}`}><span className="event-dot"/><div><header><strong>{eventLabel(event)}</strong><time>{new Date(event.createdAt).toLocaleString('zh-CN')}</time></header><p>{event.nodeTitle || '项目级动作'} · {actorLabel(event.actorType)}</p><footer><code>内容 {event.contentHash ? event.contentHash.slice(0, 12) : '—'}</code><code>事件 {event.eventHash.slice(0, 12)}</code>{event.sourceTaskId && <span>关联 AI 任务</span>}</footer></div><aside>{event.nodeId && <button className="button ghost compact" onClick={() => onSelectScene(event.nodeId!)}><LocateFixed size={12}/>定位</button>}{event.revisionId && <button className="button ghost compact" onClick={() => void showDiff(event)}>版本差异</button>}</aside></article>) : <div className="provenance-empty">当前筛选下没有来源事件。</div>}</div>
      </section>

      <aside className="provenance-side">
        <section className="provenance-card"><header><div><h3>可验证来源包</h3><small>bbd-provenance-v1 · SHA-256</small></div></header><p className="provenance-note">JSON 可离线复验完整事件链；HTML 适合阅读。报告用于说明本地记录的创作过程，不自动构成版权或司法证明。</p><label className="include-text"><input type="checkbox" checked={includeText} onChange={(event) => setIncludeText(event.target.checked)}/><span><strong>包含正文摘录</strong><small>明确选择后，每个版本最多加入 500 字；提示词和密钥仍不会导出。</small></span></label><div className="provenance-export-buttons"><button className="button primary" disabled={busy} onClick={() => void exportBundle('json')}><FileJson2 size={15}/>{busy ? '处理中…' : '导出 JSON'}</button><button className="button secondary" disabled={busy} onClick={() => void exportBundle('html')}><Download size={15}/>导出 HTML</button></div></section>
        <section className="provenance-card"><header><div><h3>校验已有来源包</h3><small>所有计算均在本机完成</small></div></header><label className="verify-drop"><Upload size={20}/><span>选择 JSON 来源包</span><input aria-label="选择 JSON 来源包" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void verifyFile(file) }}/></label>{verification && <div className={`verification-result ${verification.ok ? 'valid' : 'invalid'}`}>{verification.ok ? <CheckCircle2 size={18}/> : <XCircle size={18}/>}<span><strong>{verification.ok ? '校验通过' : '校验未通过'}</strong><small>{verification.message}</small></span></div>}</section>
        <section className="provenance-card"><header><div><h3>最近导出</h3><small>{exports.length} 次</small></div></header><div className="provenance-exports">{exports.slice(0, 5).map((record) => <div key={record.id}><FileCheck2 size={15}/><span><strong>{new Date(record.createdAt).toLocaleString('zh-CN')}</strong><small>{record.eventCount} 条 · {record.includedText ? '含正文摘录' : '不含正文'} · {record.manifestHash.slice(0, 10)}</small></span></div>)}{!exports.length && <p>尚未导出来源包。</p>}</div></section>
      </aside>
    </div>
    {diff && <Modal title="版本与父版本差异" onClose={() => setDiff(null)} wide><div className="provenance-diff"><header><span>{sourceLabel(diff.revision.provenanceLabel)}</span><code>{diff.revision.contentHash}</code></header><p>{diffWords(diff.parentText, diff.revision.plainText).map((part, index) => <span key={index} className={part.added ? 'preview-added' : part.removed ? 'preview-removed' : ''}>{part.value}</span>)}</p></div></Modal>}
  </section>
}

function Summary({ icon, value, label, code = false }: { icon: React.ReactNode; value: string | number; label: string; code?: boolean }) { return <article><span>{icon}</span><div><strong className={code ? 'hash-value' : ''}>{value}</strong><small>{label}</small></div></article> }
function eventGroup(event: ProvenanceEvent): Exclude<EventFilter, 'all'> { return event.actorType === 'ai' ? 'ai' : event.actorType === 'human' ? 'human' : 'system' }
function actorLabel(actor: ProvenanceEvent['actorType']) { return actor === 'human' ? '作者操作' : actor === 'ai' ? 'AI 生成' : '本地系统' }
function eventLabel(event: ProvenanceEvent) { if (event.eventType === 'ai_accepted') return event.metadata.decision === 'accepted' ? '作者接受 AI 候选' : event.revisionId ? 'AI 内容写入版本' : '接受 AI 建议'; return ({ human_edit: '人工编辑', ai_generated: 'AI 候选生成', ai_failed: 'AI 任务失败', ai_rejected: '丢弃 AI 候选', ai_undone: '撤销 AI 接受', human_after_ai: 'AI 后人工修订', import: '导入', restore: '恢复版本', merge: '拆分或合并', replace: '批量替换', replace_undone: '撤销批量替换', candidate_created: '建立事实候选', candidate_accepted: '接受事实候选', candidate_rejected: '拒绝事实候选', sync_merge: '同步合并', sync_conflict: '发现同步冲突', sync_conflict_resolved: '解决同步冲突', review_suggestion_accepted: '接受审阅改写建议', review_feedback_decided: '处理审阅意见', template_applied: '应用结构模板', template_reverted: '撤销结构模板', visual_anchor_created: '建立视觉锚点', visual_anchor_refreshed: '刷新视觉锚点', visual_candidate_imported: '导入视觉候选', visual_candidate_accepted: '接受视觉候选', visual_candidate_rejected: '拒绝视觉候选', storyboard_updated: '更新场景故事板' } as const)[event.eventType] }
function sourceLabel(source: Revision['provenanceLabel']) { return ({ human: '人工编辑', human_after_ai: 'AI 后人工修订', ai_accepted: 'AI 建议后接受', import: '导入', restore: '恢复', merge: '合并' } as const)[source] }
