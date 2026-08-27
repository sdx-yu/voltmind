import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, Download, FileCheck2, ShieldCheck, Trash2, TriangleAlert, Upload } from 'lucide-react'
import type { CohortAttestation, CohortEvidenceClass, CohortSegment, ResearchBundleInspection, ResearchCohortStatus } from '../../shared/types'
import { api } from '../lib/api'

type Props = { onBack: () => void; notify: (type: 'success' | 'error', message: string) => void }
type StagedPackage = { value: unknown; inspection: ResearchBundleInspection; fileName: string }

const segmentLabels: Record<CohortSegment, string> = { web_serial: '日更网文作者', revision_novel: '完稿 / 修订作者', ai_assisted: 'AI 辅助长篇作者', other_target: '其他目标长篇作者' }

export function ResearchCohortWorkspace({ onBack, notify }: Props) {
  const [status, setStatus] = useState<ResearchCohortStatus | null>(null)
  const [staged, setStaged] = useState<StagedPackage | null>(null)
  const [evidenceClass, setEvidenceClass] = useState<CohortEvidenceClass>('engineering_fixture')
  const [segment, setSegment] = useState<CohortSegment>('web_serial')
  const [attestation, setAttestation] = useState<CohortAttestation>({ targetAuthorConfirmed: false, independentParticipantConfirmed: false, manuscriptRightsConfirmed: false, realUseConfirmed: false })
  const [retentionDate, setRetentionDate] = useState(defaultRetentionDate)
  const [busy, setBusy] = useState(false)
  const [deleteHash, setDeleteHash] = useState<string | null>(null)
  const [confirmPurge, setConfirmPurge] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const allAttested = useMemo(() => Object.values(attestation).every(Boolean), [attestation])

  async function refresh() { setStatus(await api.getResearchCohortStatus()) }
  useEffect(() => { void refresh().catch((error) => notify('error', message(error, '种子研究台加载失败'))) }, [])

  async function stageFile(file: File) {
    setBusy(true)
    try {
      const value = JSON.parse(await file.text()) as unknown
      const inspection = await api.inspectResearch(value)
      if (!inspection.ok) throw new Error('研究包完整性或语义校验失败')
      setStaged({ value, inspection, fileName: file.name }); notify('success', '研究包预检通过；尚未计入任何样本')
    } catch (error) { setStaged(null); notify('error', message(error, '研究包读取失败')) }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function importPackage() {
    if (!staged) return
    setBusy(true)
    try {
      const result = await api.importResearchCohortPackage(staged.value, { evidenceClass, segment, attestation, retentionUntil: new Date(`${retentionDate}T23:59:59.999Z`).toISOString() })
      await refresh(); setStaged(null); setAttestation({ targetAuthorConfirmed: false, independentParticipantConfirmed: false, manuscriptRightsConfirmed: false, realUseConfirmed: false })
      notify('success', result.disposition === 'updated' ? '连续研究包已更新' : result.disposition === 'unchanged' ? '相同证据链已幂等忽略' : evidenceClass === 'engineering_fixture' ? '工程夹具已导入，但不会计入门禁' : '人工核对的外部样本已导入')
    } catch (error) { notify('error', message(error, '研究包导入失败')) }
    finally { setBusy(false) }
  }

  async function removeParticipant(hash: string) {
    setBusy(true)
    try { await api.deleteResearchCohortParticipant(hash); setDeleteHash(null); await refresh(); notify('success', '参与者提交摘要已删除，并留下不可逆删除回执') }
    catch (error) { notify('error', message(error, '参与者删除失败')) }
    finally { setBusy(false) }
  }

  async function purgeExpired() {
    setBusy(true)
    try { const result = await api.purgeExpiredResearchCohort(); setConfirmPurge(false); await refresh(); notify('success', `已清除 ${result.deletedParticipants} 名到期参与者`) }
    catch (error) { notify('error', message(error, '到期清除失败')) }
    finally { setBusy(false) }
  }

  async function exportCohort() {
    setBusy(true)
    try { const bundle = await api.exportResearchCohort(); downloadJson(`笔不怠-R1B-${bundle.manifest.exportedAt.slice(0, 10)}.bbd-cohort`, bundle); notify('success', '聚合报告已导出；仍需人工复核，R1 保持 NO-GO') }
    catch (error) { notify('error', message(error, '聚合报告导出失败')) }
    finally { setBusy(false) }
  }

  if (!status) return <div className="workspace-loading"><span className="brand-mark">笔</span><p>正在读取受控种子研究台…</p></div>
  const { aggregate } = status
  return <main className="cohort-workspace">
    <header className="workspace-topbar cohort-topbar"><div className="workspace-title"><button className="icon-button" onClick={onBack} aria-label="返回真实验证"><ArrowLeft size={18}/></button><span className="mini-brand">笔</span><div><strong>R1-B 受控种子研究台</strong><small>1.5.0 · 仅限本机研究负责人</small></div></div><span className="gate-badge no-go" aria-label="R1 决策 NO-GO"><TriangleAlert size={14}/><span>R1 决策 </span>NO-GO</span></header>
    <section className="cohort-content">
      <header className="page-header"><div><span className="eyebrow">只聚合证据，不认证身份</span><h1>把真实样本与工程夹具彻底分开</h1><p>导入在本机完成。数据库不保存原始研究包或参与码，只保存不可逆参与码哈希、负责人声明、事件哈希和有界摘要。</p></div><button className="button secondary" disabled={busy} onClick={() => void exportCohort()}><Download size={16}/>导出聚合报告</button></header>

      <section className="cohort-gate-grid" aria-label="R1-B 试点门">
        <Gate title="两周真实作者" current={aggregate.gates.twoWeek.current} required={aggregate.gates.twoWeek.required} met={aggregate.gates.twoWeek.met}/>
        <Gate title="四周真实作者" current={aggregate.gates.fourWeek.current} required={aggregate.gates.fourWeek.required} met={aggregate.gates.fourWeek.met}/>
        <Gate title="跨周核心闭环" current={aggregate.gates.coreLoop.current} required={aggregate.gates.coreLoop.required} met={aggregate.gates.coreLoop.met}/>
        <Gate title="数据丢失报告" current={aggregate.gates.zeroDataLoss.current} required={0} met={aggregate.gates.zeroDataLoss.met} zero/>
      </section>

      <div className="cohort-layout"><section className="panel-card cohort-import"><div className="section-title"><Upload size={20}/><div><h2>导入研究包</h2><p>默认按工程夹具处理；只有四项负责人声明齐全的外部包才可能计数。</p></div></div>
        {!staged ? <label className={`cohort-drop button ghost ${busy ? 'disabled' : ''}`}><FileCheck2 size={22}/><span><strong>选择 `.bbd-research`</strong><small>先做完整性、事件链和任务语义预检</small></span><input ref={fileRef} aria-label="选择研究包" disabled={busy} type="file" accept=".bbd-research,application/json" onChange={(event) => event.target.files?.[0] && void stageFile(event.target.files[0])}/></label> : <div className="cohort-staged"><CheckCircle2 size={22}/><div><strong>{staged.fileName}</strong><small>{staged.inspection.completedTasks} 个已结束任务 · 参与码仅在本次预览可见：{staged.inspection.participantCode}</small></div><button className="icon-button" aria-label="移除待导入包" onClick={() => setStaged(null)}>×</button></div>}
        <div className="form-stack cohort-form"><label>证据类型<select aria-label="证据类型" value={evidenceClass} onChange={(event) => setEvidenceClass(event.target.value as CohortEvidenceClass)}><option value="engineering_fixture">工程夹具（不计数）</option><option value="external_attested">人工核对的真实外部样本</option></select></label><label>作者分层<select aria-label="作者分层" value={segment} onChange={(event) => setSegment(event.target.value as CohortSegment)}>{(Object.keys(segmentLabels) as CohortSegment[]).map((value) => <option key={value} value={value}>{segmentLabels[value]}</option>)}</select></label><label>保留至<input aria-label="保留至" type="date" min={tomorrowDate()} max={maxRetentionDate()} value={retentionDate} onChange={(event) => setRetentionDate(event.target.value)}/></label></div>
        {evidenceClass === 'external_attested' ? <fieldset className="cohort-attestation"><legend>研究负责人逐项声明</legend><Check checked={attestation.targetAuthorConfirmed} onChange={(value) => setAttestation((current) => ({ ...current, targetAuthorConfirmed: value }))}>属于目标长篇作者，而非纯体验用户</Check><Check checked={attestation.independentParticipantConfirmed} onChange={(value) => setAttestation((current) => ({ ...current, independentParticipantConfirmed: value }))}>独立参与者，不是团队或自动化重复样本</Check><Check checked={attestation.manuscriptRightsConfirmed} onChange={(value) => setAttestation((current) => ({ ...current, manuscriptRightsConfirmed: value }))}>已核对其稿件权利或授权</Check><Check checked={attestation.realUseConfirmed} onChange={(value) => setAttestation((current) => ({ ...current, realUseConfirmed: value }))}>包来自真实任务与真实周期，不是工程夹具</Check></fieldset> : <p className="cohort-fixture-note"><TriangleAlert size={16}/>工程夹具只验证研究台，永不进入两周、四周或核心闭环门。</p>}
        <button className="button primary" disabled={!staged || busy || (evidenceClass === 'external_attested' && !allAttested)} onClick={() => void importPackage()}>确认导入本机研究台</button>
      </section>

      <section className="panel-card cohort-summary"><div className="section-title"><ShieldCheck size={20}/><div><h2>当前聚合</h2><p>只统计未过期、人工核对的最新连续提交。</p></div></div><dl className="research-metrics"><div><dt>真实外部样本</dt><dd>{aggregate.externalAttestedParticipants}</dd></div><div><dt>工程夹具</dt><dd>{aggregate.engineeringFixtures}</dd></div><div><dt>完成任务 / 核心闭环</dt><dd>{aggregate.completedTasks} / {aggregate.completedCoreLoops}</dd></div><div><dt>任务成功率</dt><dd>{Math.round(aggregate.taskCompletionRate * 100)}%</dd></div><div><dt>误报 / 漏报</dt><dd>{aggregate.falsePositiveReports} / {aggregate.missedFactReports}</dd></div><div><dt>删除回执</dt><dd>{status.deletionReceipts}</dd></div></dl><div className={`cohort-decision ${aggregate.gates.pilotThresholdMet ? 'threshold-met' : ''}`}><strong>{aggregate.gates.pilotThresholdMet ? '试点数值门已达到，等待人工复核' : '试点数值门尚未达到'}</strong><span>无论数值如何，工具都不会自动把 R1 改为 GO。</span></div>{aggregate.expiredParticipants > 0 && <div className="inline-actions">{confirmPurge ? <><button className="button danger" disabled={busy} onClick={() => void purgeExpired()}>确认清除 {aggregate.expiredParticipants} 名到期参与者</button><button className="button ghost" onClick={() => setConfirmPurge(false)}>取消</button></> : <button className="button ghost danger-ghost" onClick={() => setConfirmPurge(true)}>清除到期记录</button>}</div>}</section></div>

      <section className="panel-card cohort-participants"><header><div><h2>本机参与者摘要</h2><p>仅显示参与码哈希前缀；不保存姓名、联系方式或原始研究包。</p></div><span>{status.participants.length} 人</span></header>{status.participants.length ? <div className="cohort-table-wrap"><table><thead><tr><th>参与者哈希</th><th>证据</th><th>分层</th><th>周 / 跨度</th><th>任务 / 闭环</th><th>资格</th><th>操作</th></tr></thead><tbody>{status.participants.map((participant) => <tr key={participant.participantCodeHash} className={participant.expired ? 'expired' : ''}><td><code>{participant.participantCodeHash.slice(0, 12)}…</code><small>{participant.submissionCount} 次连续提交</small></td><td><span className={`status-pill ${participant.evidenceClass === 'external_attested' ? 'pass' : 'required'}`}>{participant.evidenceClass === 'external_attested' ? '外部核对' : '工程夹具'}</span></td><td>{segmentLabels[participant.segment]}</td><td>{participant.observedWeekBuckets} 周 / {participant.activeSpanDays} 天</td><td>{participant.completedTasks} / {participant.completedCoreLoops}</td><td><span className="cohort-qualifiers">{participant.twoWeekQualified && '2周 '}{participant.fourWeekQualified && '4周 '}{participant.coreLoopQualified && '闭环'}{!participant.twoWeekQualified && !participant.fourWeekQualified && !participant.coreLoopQualified && '收集中'}</span></td><td>{deleteHash === participant.participantCodeHash ? <div className="inline-actions compact"><button className="button danger" disabled={busy} onClick={() => void removeParticipant(participant.participantCodeHash)}>确认删除</button><button className="button ghost" onClick={() => setDeleteHash(null)}>取消</button></div> : <button className="icon-button danger-ghost" aria-label={`删除参与者 ${participant.participantCodeHash.slice(0, 12)}`} onClick={() => setDeleteHash(participant.participantCodeHash)}><Trash2 size={15}/></button>}</td></tr>)}</tbody></table></div> : <div className="cohort-empty"><FileCheck2 size={28}/><strong>还没有研究包</strong><span>先用工程夹具验证流程；它不会计入真实样本。</span></div>}</section>
    </section>
  </main>
}

function Gate({ title, current, required, met, zero = false }: { title: string; current: number; required: number; met: boolean; zero?: boolean }) {
  return <article className={met ? 'met' : ''}><span>{met ? <CheckCircle2 size={18}/> : <TriangleAlert size={18}/>}</span><div><strong>{title}</strong><small>{zero ? `${current}；要求保持 0` : `${current} / ${required}`}</small></div></article>
}
function Check({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: React.ReactNode }) { return <label className="check-row"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/><span>{children}</span></label> }
function defaultRetentionDate() { const date = new Date(); date.setUTCDate(date.getUTCDate() + 90); return date.toISOString().slice(0, 10) }
function tomorrowDate() { const date = new Date(); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10) }
function maxRetentionDate() { const date = new Date(); date.setUTCDate(date.getUTCDate() + 365); return date.toISOString().slice(0, 10) }
function downloadJson(name: string, value: unknown) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 500) }
function message(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback }
