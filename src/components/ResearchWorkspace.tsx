import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, Download, FileHeart, FlaskConical, ShieldCheck, Stethoscope, TriangleAlert } from 'lucide-react'
import type { Project, ReleaseReadiness, ResearchIssueCode, ResearchStatus, ResearchTaskType } from '../../shared/types'
import { api } from '../lib/api'
import { Button, PageHeader, SelectControl, WorkflowSteps, WorkflowTemplate } from '../ui'

type Props = { projects: Project[]; onBack: () => void; onOpenCohort: () => void; notify: (type: 'success' | 'error', message: string) => void }

const taskLabels: Record<ResearchTaskType, string> = {
  canon_loop: '完成场景—确认候选—推进正典',
  fact_lookup: '回查人物、物品或时间事实',
  restore_drill: '执行备份或快照恢复演练',
  legacy_import: '导入旧稿并建立首批正典',
  weekly_reflection: '完成本周使用回顾',
}
const issueLabels: Record<ResearchIssueCode, string> = {
  hard_to_find: '入口或信息难找', false_positive: '出现误报', missed_fact: '遗漏事实', confusing_candidate: '候选难理解', slow: '处理过慢', recovery_failed: '恢复失败', data_loss: '发生数据丢失',
}

export function ResearchWorkspace({ projects, onBack, onOpenCohort, notify }: Props) {
  const [status, setStatus] = useState<ResearchStatus | null>(null)
  const [readiness, setReadiness] = useState<ReleaseReadiness | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmations, setConfirmations] = useState({ adultOrAuthorized: false, manuscriptRights: false, localOnlyUnderstood: false, voluntary: false })
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [taskType, setTaskType] = useState<ResearchTaskType>('canon_loop')
  const [goalAchieved, setGoalAchieved] = useState(true)
  const [difficulty, setDifficulty] = useState(3)
  const [minutesSaved, setMinutesSaved] = useState(0)
  const [issues, setIssues] = useState<ResearchIssueCode[]>([])
  const [confirmWithdraw, setConfirmWithdraw] = useState(false)
  const activeTask = useMemo(() => status?.tasks.find((task) => task.status === 'active') ?? null, [status])

  async function refresh() {
    const [nextStatus, nextReadiness] = await Promise.all([api.getResearchStatus(), api.getReleaseReadiness()])
    setStatus(nextStatus); setReadiness(nextReadiness)
  }
  useEffect(() => { void refresh().catch((error) => notify('error', message(error, '验证计划加载失败'))) }, [])

  async function enroll() {
    setBusy(true)
    try {
      const input = { adultOrAuthorized: true as const, manuscriptRights: true as const, localOnlyUnderstood: true as const, voluntary: true as const }
      setStatus(await api.enrollResearch(input)); notify('success', '同意回执已留在本机；没有上传任何稿件或研究数据')
    } catch (error) { notify('error', message(error, '加入验证失败')) }
    finally { setBusy(false) }
  }

  async function startTask() {
    if (!projectId) return
    setBusy(true)
    try { await api.startResearchTask(projectId, taskType); await refresh(); notify('success', '验证任务已开始，只记录任务类型和时间') }
    catch (error) { notify('error', message(error, '任务开始失败')) }
    finally { setBusy(false) }
  }

  async function finishTask(outcome: 'completed' | 'abandoned') {
    if (!activeTask) return
    setBusy(true)
    try {
      await api.completeResearchTask(activeTask.id, { outcome, goalAchieved: outcome === 'completed' && goalAchieved, difficulty, minutesSaved, issueCodes: issues })
      setIssues([]); setDifficulty(3); setMinutesSaved(0); await refresh(); notify('success', outcome === 'completed' ? '本次验证记录已完成' : '已记录中止，没有伪记为成功')
    } catch (error) { notify('error', message(error, '任务记录失败')) }
    finally { setBusy(false) }
  }

  async function exportResearch() {
    setBusy(true)
    try { const bundle = await api.exportResearch(); downloadJson(`笔不怠-R1-${bundle.manifest.participantCode}.bbd-research`, bundle); notify('success', '研究包已导出；导出本身不代表 R1 验收通过') }
    catch (error) { notify('error', message(error, '研究包导出失败')) }
    finally { setBusy(false) }
  }

  async function exportSupport() {
    setBusy(true)
    try { const bundle = await api.getSupportBundle(); downloadJson(`笔不怠-${bundle.manifest.appVersion}-support.json`, bundle); notify('success', '无正文支持诊断包已导出') }
    catch (error) { notify('error', message(error, '诊断包导出失败')) }
    finally { setBusy(false) }
  }

  async function withdraw() {
    setBusy(true)
    try { await api.withdrawResearch(); setConfirmWithdraw(false); await refresh(); notify('success', '已退出验证，当前数据库中的参与码、任务和研究事件已清除') }
    catch (error) { notify('error', message(error, '退出验证失败')) }
    finally { setBusy(false) }
  }

  if (!status) return <div className="workspace-loading"><span className="brand-mark">笔</span><p>正在读取验证计划…</p></div>
  const allConfirmed = Object.values(confirmations).every(Boolean)
  return <main className="research-workspace">
    <header className="workspace-topbar research-topbar"><div className="workspace-title"><button className="icon-button" onClick={onBack} aria-label="返回书架"><ArrowLeft size={18}/></button><span className="mini-brand">笔</span><div><strong>真实作者验证</strong><small>本机记录 · 不自动上传</small></div></div><span className="gate-badge no-go" aria-label="公开发布 NO-GO"><TriangleAlert size={14}/><span>公开发布 </span>NO-GO</span></header>
    <WorkflowTemplate className="research-content">
      <PageHeader eyebrow="真实验证，不造数据" title="验证它是否真的减少翻资料、返工和穿帮" description="这里建立可校验的本机研究记录。自动化和导出动作不能替代真实作者与真实周期。" actions={<Button variant="ghost" leadingIcon={<FlaskConical size={16}/>} onClick={onOpenCohort}>研究负责人工作台</Button>} />
      <WorkflowSteps label="真实验证步骤" items={[{ id: 'consent', label: '知情同意', description: '自愿参与并可退出', state: status.enrollment ? 'complete' : 'current' }, { id: 'task', label: '完成真实任务', description: '只记录任务与结果', state: activeTask ? 'current' : status.progress.completedTasks ? 'complete' : status.enrollment ? 'current' : 'upcoming' }, { id: 'export', label: '自主导出证据', description: '决定是否交给负责人', state: status.progress.completedTasks ? 'current' : 'upcoming' }]} />

      {!status.enrollment ? <section className="research-consent panel-card"><div className="section-title"><ShieldCheck size={22}/><div><h2>知情同意</h2><p>版本 {status.consent.version} · 文本 SHA-256 {status.consent.textHash.slice(0, 12)}…</p></div></div><p className="consent-copy">{status.consent.text}</p><div className="consent-checks">
        <CheckBox checked={confirmations.adultOrAuthorized} onChange={(value) => setConfirmations((current) => ({ ...current, adultOrAuthorized: value }))}>我已成年或有权自行作出参与决定</CheckBox>
        <CheckBox checked={confirmations.manuscriptRights} onChange={(value) => setConfirmations((current) => ({ ...current, manuscriptRights: value }))}>我只会使用自己拥有权利或获授权的稿件</CheckBox>
        <CheckBox checked={confirmations.localOnlyUnderstood} onChange={(value) => setConfirmations((current) => ({ ...current, localOnlyUnderstood: value }))}>我理解记录默认只在本机，主动导出才会离开本机</CheckBox>
        <CheckBox checked={confirmations.voluntary} onChange={(value) => setConfirmations((current) => ({ ...current, voluntary: value }))}>我自愿参加，并知道可以随时退出和清除本机研究记录</CheckBox>
      </div><button className="button primary" disabled={!allConfirmed || busy} onClick={() => void enroll()}><FileHeart size={16}/>同意并生成匿名参与码</button></section> : <>
        <section className="research-summary"><article><span><FlaskConical size={20}/></span><div><strong>{status.enrollment.participantCode}</strong><small>匿名参与码；不是账号或认证身份</small></div></article><article><span><CheckCircle2 size={20}/></span><div><strong>{status.progress.completedTasks}</strong><small>已结束任务 / {status.progress.completedCoreLoops} 次核心闭环</small></div></article><article><span><FileHeart size={20}/></span><div><strong>{status.progress.observedWeekBuckets}</strong><small>有完成记录的自然周</small></div></article></section>

        <div className="research-grid"><section className="panel-card"><div className="section-title"><FlaskConical size={20}/><div><h2>{activeTask ? '正在验证' : '开始一次真实任务'}</h2><p>项目只在本机用于生成不可逆范围指纹，书名与项目 ID 不导出。</p></div></div>
          {activeTask ? <div className="active-research-task"><strong>{taskLabels[activeTask.taskType]}</strong><small>开始于 {formatDate(activeTask.startedAt)} · 范围 {activeTask.projectScopeHash.slice(0, 10)}…</small><label>是否达到本次目标<SelectControl value={goalAchieved ? 'yes' : 'no'} onChange={(event) => setGoalAchieved(event.target.value === 'yes')}><option value="yes">是</option><option value="no">否</option></SelectControl></label><label>操作难度（1 容易—5 困难）<input aria-label="操作难度" type="number" min={1} max={5} value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))}/></label><label>相比原工作流预估节省分钟<input aria-label="预估节省分钟" type="number" min={0} max={480} value={minutesSaved} onChange={(event) => setMinutesSaved(Number(event.target.value))}/></label><fieldset><legend>遇到的问题（只选代码，不写稿件内容）</legend>{(Object.keys(issueLabels) as ResearchIssueCode[]).map((code) => <CheckBox key={code} checked={issues.includes(code)} onChange={(checked) => setIssues((current) => checked ? [...current, code] : current.filter((item) => item !== code))}>{issueLabels[code]}</CheckBox>)}</fieldset><div className="inline-actions"><button className="button primary" disabled={busy} onClick={() => void finishTask('completed')}>完成并记录</button><button className="button ghost" disabled={busy} onClick={() => void finishTask('abandoned')}>中止并如实记录</button></div></div> : <div className="form-stack"><label>本机项目<SelectControl aria-label="验证项目" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">选择项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</SelectControl></label><label>真实任务<SelectControl aria-label="验证任务" value={taskType} onChange={(event) => setTaskType(event.target.value as ResearchTaskType)}>{(Object.keys(taskLabels) as ResearchTaskType[]).map((type) => <option key={type} value={type}>{taskLabels[type]}</option>)}</SelectControl></label><button className="button primary" disabled={!projectId || busy} onClick={() => void startTask()}>开始计时</button>{!projects.length && <p className="warning-note">需要先在书架建立或导入一个真实、已获授权的项目。</p>}</div>}
        </section>

        <section className="panel-card"><div className="section-title"><Download size={20}/><div><h2>最小披露证据</h2><p>研究包与支持包都不包含正文、标题、正典、Prompt、密钥或路径。</p></div></div><dl className="research-metrics"><div><dt>预估累计节省</dt><dd>{status.progress.reportedMinutesSaved} 分钟</dd></div><div><dt>数据丢失报告</dt><dd className={status.progress.dataLossReports ? 'danger-text' : ''}>{status.progress.dataLossReports}</dd></div><div><dt>同意回执</dt><dd title={status.enrollment.consentReceiptHash}>{status.enrollment.consentReceiptHash.slice(0, 12)}…</dd></div></dl><div className="form-stack"><button className="button secondary" disabled={busy} onClick={() => void exportResearch()}><Download size={16}/>导出可校验研究包</button><button className="button ghost" disabled={busy} onClick={() => void exportSupport()}><Stethoscope size={16}/>导出无正文支持诊断</button><p className="form-hint">导出仍由你决定交给谁。研究负责人必须另外核验参与资格、真实周期和跨参与者汇总。</p></div></section></div>

        <section className="panel-card research-history"><h2>本机任务记录</h2>{status.tasks.length ? <div className="task-history">{status.tasks.map((task) => <article key={task.id}><span className={`status-pill ${task.status}`}>{task.status === 'active' ? '进行中' : task.status === 'completed' ? '已完成' : '已中止'}</span><div><strong>{taskLabels[task.taskType]}</strong><small>{formatDate(task.startedAt)} · 范围 {task.projectScopeHash.slice(0, 10)}…{task.difficulty ? ` · 难度 ${task.difficulty}` : ''}</small></div></article>)}</div> : <p className="muted">还没有任务记录。</p>}</section>

        <section className="research-gates panel-card"><h2>公开发布门</h2><div className="gate-columns"><div><h3>本机工程检查</h3>{readiness?.engineering.map((gate) => <p key={gate.gate}><span className={`status-pill ${gate.status}`}>{gate.status === 'pass' ? '通过' : '未执行'}</span><strong>{gate.gate}</strong><small>{gate.evidence}</small></p>)}</div><div><h3>仍需外部证据</h3>{readiness?.external.map((gate) => <p key={gate.gate}><span className="status-pill required">必需</span><strong>{gate.gate}</strong><small>{gate.evidence}</small></p>)}</div></div></section>

        <section className="withdraw-card"><div><strong>退出真实验证</strong><p>退出会删除当前数据库中的参与码、任务与研究事件，不影响书稿和版本；已有历史数据库快照需按备份策略另行管理。</p></div>{confirmWithdraw ? <div className="inline-actions"><button className="button danger" disabled={busy} onClick={() => void withdraw()}>确认退出并清除</button><button className="button ghost" onClick={() => setConfirmWithdraw(false)}>保留记录</button></div> : <button className="button ghost danger-ghost" onClick={() => setConfirmWithdraw(true)}>退出验证</button>}</section>
      </>}
    </WorkflowTemplate>
  </main>
}

function CheckBox({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: React.ReactNode }) {
  return <label className="check-row"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/><span>{children}</span></label>
}

function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 500)
}
function formatDate(value: string) { return new Date(value).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }) }
function message(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback }
