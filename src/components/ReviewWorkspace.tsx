import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Download, FileKey2, LocateFixed, MessageSquareText, Send, Upload, X } from 'lucide-react'
import type { ManuscriptNode, Project, ReviewDecisionType, ReviewFeedback, ReviewPackage, ReviewRole, ReviewSession } from '../../shared/types'
import { api } from '../lib/api'
import { Button, InlineNotice, PageHeader, SegmentedControl, SelectControl, WorkflowSteps, WorkflowTemplate } from '../ui'

type Props = {
  project: Project | null
  nodes: ManuscriptNode[]
  reviewerOnly?: boolean
  onSelectScene: (id: string) => void
  onChanged: () => Promise<void>
  onBack: () => void
  notify: (type: 'success' | 'error', message: string) => void
}

const roleNames: Record<ReviewRole, string> = { editor: '编辑', beta_reader: '试读者', co_writer: '合著者' }
const anchorNames = { exact: '原位', candidate: '候选位置', lost: '锚点失效' } as const

export function ReviewWorkspace({ project, nodes, reviewerOnly = false, onSelectScene, onChanged, onBack, notify }: Props) {
  const scenes = useMemo(() => nodes.filter((node) => node.type === 'scene' && !node.deletedAt), [nodes])
  const [mode, setMode] = useState<'author' | 'reviewer'>(reviewerOnly ? 'reviewer' : 'author')
  const [authored, setAuthored] = useState<ReviewSession[]>([])
  const [received, setReceived] = useState<ReviewSession[]>([])
  const [reviewerName, setReviewerName] = useState('')
  const [role, setRole] = useState<ReviewRole>('editor')
  const [sceneIds, setSceneIds] = useState<string[]>([])
  const [includeProvenance, setIncludeProvenance] = useState(false)
  const [busy, setBusy] = useState(false)
  const [oneTime, setOneTime] = useState<{ phrase: string; session: ReviewSession } | null>(null)
  const [reviewPackage, setReviewPackage] = useState<unknown>(null)
  const [packageName, setPackageName] = useState('')
  const [importPhrase, setImportPhrase] = useState('')
  const [exportPhrases, setExportPhrases] = useState<Record<string, string>>({})
  const [activeReceivedId, setActiveReceivedId] = useState('')
  const [activeSceneId, setActiveSceneId] = useState('')
  const [paragraphIndex, setParagraphIndex] = useState(0)
  const [quote, setQuote] = useState('')
  const [kind, setKind] = useState<ReviewFeedback['kind']>('comment')
  const [body, setBody] = useState('')
  const [replacementText, setReplacementText] = useState('')

  async function refresh() {
    const [nextAuthored, nextReceived] = await Promise.all([project ? api.listProjectReviews(project.id) : Promise.resolve([]), api.listReceivedReviews()])
    setAuthored(nextAuthored); setReceived(nextReceived)
    setActiveReceivedId((current) => nextReceived.some((session) => session.id === current) ? current : nextReceived[0]?.id ?? '')
  }
  useEffect(() => { setSceneIds(scenes.map((scene) => scene.id)); void refresh().catch(showError) }, [project?.id])

  const activeReceived = received.find((session) => session.id === activeReceivedId) ?? null
  const activeScene = activeReceived?.scenes.find((scene) => scene.id === activeSceneId) ?? activeReceived?.scenes[0] ?? null
  const paragraphs = activeScene?.plainText.split(/\n+/).filter(Boolean) ?? []
  useEffect(() => { if (activeReceived?.role === 'beta_reader') setKind('comment'); setActiveSceneId(activeReceived?.scenes[0]?.id ?? ''); setParagraphIndex(0); setQuote('') }, [activeReceivedId])

  function showError(error: unknown) { notify('error', error instanceof Error ? error.message : '审阅操作失败') }
  async function createAssignment() {
    if (!project) return
    if (!reviewerName.trim() || !sceneIds.length) return notify('error', '请填写审阅者并选择至少一个场景')
    setBusy(true)
    try {
      const created = await api.createReviewAssignment(project.id, { reviewerName, role, sceneIds, includeProvenance, expiresAt: null })
      downloadPackage(created.package, `${project.title}-${roleNames[role]}-任务.bbd-review`)
      setOneTime({ phrase: created.recoveryPhrase, session: created.session }); setReviewerName(''); await refresh()
      notify('success', '审阅任务包已生成；请单独、安全地传递恢复短语')
    } catch (error) { showError(error) } finally { setBusy(false) }
  }
  async function readPackage(file?: File) {
    if (!file) return
    try { setReviewPackage(JSON.parse(await file.text())); setPackageName(file.name) }
    catch { setReviewPackage(null); notify('error', '无法读取该审阅包') }
  }
  async function importSelected() {
    if (!reviewPackage || !importPhrase) return notify('error', '请选择审阅包并填写恢复短语')
    setBusy(true)
    try {
      const inspection = await api.inspectReviewPackage(reviewPackage, importPhrase)
      if (mode === 'author' && inspection.mode !== 'response') throw new Error('作者端只能导入回应包')
      if (mode === 'reviewer' && inspection.mode !== 'assignment') throw new Error('审阅者端只能导入任务包')
      const result = await api.importReviewPackage(reviewPackage, importPhrase, mode === 'author' ? project?.id : undefined)
      await refresh(); setReviewPackage(null); setPackageName(''); setImportPhrase('')
      notify('success', result.duplicate ? '这个包已导入过，没有产生重复意见' : inspection.mode === 'response' ? `已收到 ${inspection.feedbackCount} 条审阅意见` : `已打开《${inspection.projectTitle}》的隔离审阅副本`)
    } catch (error) { showError(error) } finally { setBusy(false) }
  }
  async function exportPackage(session: ReviewSession) {
    const phrase = exportPhrases[session.id]?.trim(); if (!phrase) return notify('error', '请填写该会话的恢复短语')
    setBusy(true)
    try {
      const value = session.direction === 'received' ? await api.exportReviewResponse(session.id, phrase) : await api.exportReviewAssignment(session.id, phrase)
      downloadPackage(value, `${session.projectTitle}-${session.direction === 'received' ? '审阅回应' : '审阅任务'}.bbd-review`)
      notify('success', session.direction === 'received' ? '回应包已生成，请发回作者' : '任务包已重新导出')
    } catch (error) { showError(error) } finally { setBusy(false) }
  }
  async function addFeedback() {
    if (!activeReceived || !activeScene || !body.trim() || !quote.trim()) return notify('error', '请选择原文片段并填写意见')
    const paragraph = paragraphs[paragraphIndex] ?? ''; const startOffset = paragraph.indexOf(quote)
    if (startOffset < 0) return notify('error', '所选原文不在当前段落中')
    setBusy(true)
    try {
      await api.createReviewFeedback(activeReceived.id, { sceneId: activeScene.id, kind, body, paragraphIndex, startOffset, endOffset: startOffset + quote.length, replacementText: kind === 'suggestion' ? replacementText : undefined })
      setBody(''); setQuote(''); setReplacementText(''); await refresh(); notify('success', '意见已保存在隔离副本中，导出回应包后才会交给作者')
    } catch (error) { showError(error) } finally { setBusy(false) }
  }
  async function decide(feedback: ReviewFeedback, decision: ReviewDecisionType) {
    if (!project) return
    setBusy(true)
    try { await api.decideReviewFeedback(project.id, feedback.id, decision); await Promise.all([refresh(), onChanged()]); notify('success', decision === 'accepted' ? '已采纳并留下版本与来源记录' : decision === 'rejected' ? '已拒绝，原稿未改变' : '已暂缓，稍后仍可决定') }
    catch (error) { showError(error) } finally { setBusy(false) }
  }

  async function copyOneTimePhrase() {
    if (!oneTime) return
    try { await navigator.clipboard.writeText(oneTime.phrase); notify('success', '恢复短语已复制') }
    catch { notify('error', '复制失败，请手动选中恢复短语并复制') }
  }

  return <WorkflowTemplate className="review-workspace">
    <PageHeader eyebrow="角色化审阅" title="把意见带回来，不把项目权限交出去" description="任务与回应均为本地加密包；审阅者只拿到指定场景的隔离副本，作者逐条决定。" backAction={<Button variant="ghost" size="small" leadingIcon={<ArrowLeft size={14}/>} onClick={onBack}>{reviewerOnly ? '返回书架' : '返回修订台'}</Button>} actions={!reviewerOnly ? <SegmentedControl label="审阅身份" value={mode} onChange={(value) => setMode(value as typeof mode)} items={[{ id: 'author', label: '作者处理' }, { id: 'reviewer', label: '审阅者工作台' }]} /> : undefined} />
    <WorkflowSteps label="审阅接力步骤" items={mode === 'author' ? [
      { id: 'assign', label: '限定范围', description: '选择角色和场景', state: authored.length ? 'complete' : 'current' },
      { id: 'relay', label: '收回回应', description: '先预检再导入', state: authored.length ? 'current' : 'upcoming' },
      { id: 'decide', label: '逐条决定', description: '采纳、暂缓或拒绝', state: authored.some((session) => session.feedback.length) ? 'current' : 'upcoming' },
    ] : [
      { id: 'open', label: '打开任务', description: '校验任务与短语', state: received.length ? 'complete' : 'current' },
      { id: 'comment', label: '写下意见', description: '只在隔离副本中', state: received.length ? 'current' : 'upcoming' },
      { id: 'return', label: '交回作者', description: '导出加密回应包', state: received.some((session) => session.feedback.length) ? 'current' : 'upcoming' },
    ]} />
    <InlineNotice className="review-security" tone="info" title="权限边界">不创建账号、不联网，审阅者不能直接修改正典或来源记录；恢复短语不会写入包内。</InlineNotice>
    {mode === 'author' && project ? <div className="review-grid">
      <section className="review-card"><header><h3>建立审阅任务</h3><span>1–100 个场景 · 5 MiB</span></header><label>审阅者<input value={reviewerName} maxLength={120} placeholder="例如：林编辑" onChange={(event) => setReviewerName(event.target.value)}/></label><label>角色<SelectControl value={role} onChange={(event) => setRole(event.target.value as ReviewRole)}><option value="editor">编辑 · 可评论、提改写</option><option value="beta_reader">试读者 · 只可评论</option><option value="co_writer">合著者 · 可评论、提改写</option></SelectControl></label><fieldset><legend>授权场景</legend>{scenes.map((scene) => <label key={scene.id} className="review-scene-check"><input type="checkbox" checked={sceneIds.includes(scene.id)} onChange={(event) => setSceneIds((current) => event.target.checked ? [...current, scene.id] : current.filter((id) => id !== scene.id))}/><span>{scene.title}<small>{scene.wordCount} 字</small></span></label>)}</fieldset><label className="review-inline"><input type="checkbox" checked={includeProvenance} onChange={(event) => setIncludeProvenance(event.target.checked)}/>随场景附上最近版本的来源标签</label><button className="button primary full" disabled={busy} onClick={() => void createAssignment()}><FileKey2 size={15}/>生成并下载任务包</button>{oneTime && <div className="review-secret"><strong>恢复短语只显示这一次</strong><code>{oneTime.phrase}</code><p>请复制后通过不同渠道发给 {oneTime.session.reviewerName}。遗失后无法解密，可重新建立任务。</p><button className="button secondary compact" onClick={() => void copyOneTimePhrase()}>复制短语</button></div>}</section>
      <section className="review-card review-import"><header><h3>导入审阅回应</h3><span>先验包，再入库</span></header><PackageImport packageName={packageName} phrase={importPhrase} onFile={readPackage} onPhrase={setImportPhrase}/><button className="button secondary full" disabled={busy || !reviewPackage} onClick={() => void importSelected()}><Upload size={15}/>校验并导入回应</button></section>
      <section className="review-card review-sessions"><header><h3>作者会话</h3><span>{authored.length} 个</span></header>{authored.length ? authored.map((session) => <SessionCard key={session.id} session={session} phrase={exportPhrases[session.id] ?? ''} onPhrase={(value) => setExportPhrases((current) => ({ ...current, [session.id]: value }))} onExport={() => void exportPackage(session)} busy={busy}>{session.feedback.length ? session.feedback.map((feedback) => <FeedbackCard key={feedback.id} feedback={feedback} busy={busy} onLocate={() => locateFeedback(feedback, onSelectScene)} onDecide={(decision) => void decide(feedback, decision)}/>) : <p className="muted">尚未收到意见。</p>}</SessionCard>) : <p className="muted">尚未建立审阅任务。</p>}</section>
    </div> : <div className="review-grid reviewer-grid">
      <section className="review-card review-import"><header><h3>打开作者任务</h3><span>仅保存隔离副本</span></header><PackageImport packageName={packageName} phrase={importPhrase} onFile={readPackage} onPhrase={setImportPhrase}/><button className="button primary full" disabled={busy || !reviewPackage} onClick={() => void importSelected()}><Upload size={15}/>校验并打开任务</button></section>
      <section className="review-card reviewer-compose"><header><h3>写审阅意见</h3><span>{activeReceived ? roleNames[activeReceived.role] : '未选择任务'}</span></header><label>任务<SelectControl value={activeReceivedId} onChange={(event) => setActiveReceivedId(event.target.value)}><option value="">选择已导入任务</option>{received.map((session) => <option key={session.id} value={session.id}>{session.projectTitle} · {session.reviewerName}</option>)}</SelectControl></label><label>场景<SelectControl value={activeScene?.id ?? ''} onChange={(event) => { setActiveSceneId(event.target.value); setParagraphIndex(0); setQuote('') }}>{activeReceived?.scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</SelectControl></label>{activeReceived && activeScene && <><label>段落<SelectControl value={String(paragraphIndex)} onChange={(event) => { setParagraphIndex(Number(event.target.value)); setQuote('') }}>{paragraphs.map((paragraph, index) => <option key={index} value={index}>第 {index + 1} 段 · {paragraph.slice(0, 28)}</option>)}</SelectControl></label><blockquote className="review-paragraph">{paragraphs[paragraphIndex]}</blockquote><label>引用原文<input value={quote} placeholder="复制当前段中要评论的连续文字" onChange={(event) => setQuote(event.target.value)}/></label><label>意见<textarea value={body} rows={3} maxLength={5000} onChange={(event) => setBody(event.target.value)}/></label><label>类型<SelectControl value={kind} onChange={(event) => setKind(event.target.value as ReviewFeedback['kind'])}><option value="comment">评论</option>{activeReceived.role !== 'beta_reader' && <option value="suggestion">改写建议</option>}</SelectControl></label>{kind === 'suggestion' && <label>建议替换为<textarea value={replacementText} rows={2} onChange={(event) => setReplacementText(event.target.value)}/></label>}<button className="button primary full" disabled={busy} onClick={() => void addFeedback()}><MessageSquareText size={15}/>保存到隔离副本</button></>}</section>
      <section className="review-card review-sessions"><header><h3>回应包</h3><span>交回作者后才生效</span></header>{received.map((session) => <SessionCard key={session.id} session={session} phrase={exportPhrases[session.id] ?? ''} onPhrase={(value) => setExportPhrases((current) => ({ ...current, [session.id]: value }))} onExport={() => void exportPackage(session)} busy={busy}>{session.feedback.map((feedback) => <FeedbackCard key={feedback.id} feedback={feedback}/>)}</SessionCard>)}</section>
    </div>}
  </WorkflowTemplate>
}

function PackageImport({ packageName, phrase, onFile, onPhrase }: { packageName: string; phrase: string; onFile: (file?: File) => void; onPhrase: (value: string) => void }) { return <><label className="review-file"><Upload size={20}/><span>{packageName || '选择 .bbd-review 文件'}</span><input aria-label="选择审阅包" type="file" accept=".bbd-review,application/json" onChange={(event) => void onFile(event.target.files?.[0])}/></label><label>恢复短语<input type="password" value={phrase} autoComplete="off" placeholder="从另一条安全渠道取得" onChange={(event) => onPhrase(event.target.value)}/></label></> }

function SessionCard({ session, phrase, onPhrase, onExport, busy, children }: { session: ReviewSession; phrase: string; onPhrase: (value: string) => void; onExport: () => void; busy: boolean; children?: React.ReactNode }) { return <article className="review-session"><header><div><strong>{session.reviewerName}</strong><small>{roleNames[session.role]} · {session.sceneIds.length} 个场景 · {session.feedback.length} 条意见</small></div><span>{new Date(session.createdAt).toLocaleDateString('zh-CN')}</span></header><div className="review-export"><input aria-label={`${session.reviewerName} 恢复短语`} type="password" value={phrase} placeholder="恢复短语" onChange={(event) => onPhrase(event.target.value)}/><button className="button ghost compact" disabled={busy} onClick={onExport}><Download size={13}/>{session.direction === 'received' ? '导出回应' : '重下任务'}</button></div>{children}</article> }

function FeedbackCard({ feedback, busy = false, onLocate, onDecide }: { feedback: ReviewFeedback; busy?: boolean; onLocate?: () => void; onDecide?: (decision: ReviewDecisionType) => void }) { const final = feedback.currentDecision === 'accepted' || feedback.currentDecision === 'rejected'; const applied = feedback.currentDecision === 'accepted' && feedback.kind === 'suggestion'; const anchorLabel = applied ? '已应用' : anchorNames[feedback.anchorStatus]; return <article className={`review-feedback anchor-${applied ? 'exact' : feedback.anchorStatus}`}><header><span>{feedback.kind === 'suggestion' ? '改写建议' : '评论'} · {feedback.sceneTitle}</span><em>{anchorLabel}</em></header><blockquote>“{feedback.anchor.quote}”</blockquote><p>{feedback.body}</p>{feedback.kind === 'suggestion' && <div className="review-diff"><del>{feedback.originalText}</del><ins>{feedback.replacementText}</ins></div>}<footer>{feedback.currentDecision && <strong className={`decision-${feedback.currentDecision}`}>{feedback.currentDecision === 'accepted' ? '已采纳' : feedback.currentDecision === 'rejected' ? '已拒绝' : '已暂缓'}</strong>}{onLocate && <button className="button ghost compact" onClick={onLocate}><LocateFixed size={12}/>定位</button>}{onDecide && !final && <><button className="button ghost compact" disabled={busy || feedback.anchorStatus === 'lost' && feedback.kind === 'suggestion'} onClick={() => onDecide('accepted')}><Check size={12}/>采纳</button><button className="button ghost compact" disabled={busy} onClick={() => onDecide('deferred')}><Send size={12}/>暂缓</button><button className="button ghost compact danger-text" disabled={busy} onClick={() => onDecide('rejected')}><X size={12}/>拒绝</button></>}</footer></article> }

function locateFeedback(feedback: ReviewFeedback, onSelectScene: (id: string) => void) { onSelectScene(feedback.sceneId); window.setTimeout(() => window.dispatchEvent(new CustomEvent('bbd:read-position', { detail: { nodeId: feedback.sceneId, startOffset: feedback.resolvedStartOffset ?? 0, endOffset: (feedback.resolvedStartOffset ?? 0) + feedback.anchor.quote.length } })), 80) }
function downloadPackage(value: ReviewPackage, name: string) { const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 500) }
