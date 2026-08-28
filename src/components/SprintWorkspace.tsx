import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Bell, CalendarDays, Download, Flag, Pause, Play, Square, TimerReset, Upload, Users } from 'lucide-react'
import type { ManuscriptNode, Project, SprintBoard, SprintPackage, SprintPackageInspection, SprintSession } from '../../shared/types'
import { api } from '../lib/api'
import { SelectControl } from '../ui'

interface Props {
  project: Project
  nodes: ManuscriptNode[]
  activeSceneId: string | null
  compact?: boolean
  onOpenScene: (sceneId: string) => void
  onOpenDetails?: () => void
  onBack?: () => void
  notify: (type: 'success' | 'error', message: string) => void
}

export function SprintWorkspace({ project, nodes, activeSceneId, compact = false, onOpenScene, onOpenDetails, onBack, notify }: Props) {
  const scenes = useMemo(() => nodes.filter((node) => node.type === 'scene' && !node.deletedAt), [nodes])
  const [sessions, setSessions] = useState<SprintSession[]>([])
  const [boards, setBoards] = useState<SprintBoard[]>([])
  const [scope, setScope] = useState<'scene' | 'project'>('scene')
  const [sceneId, setSceneId] = useState(activeSceneId ?? scenes[0]?.id ?? '')
  const [durationMinutes, setDurationMinutes] = useState(25)
  const [goalWords, setGoalWords] = useState(500)
  const [participantLabel, setParticipantLabel] = useState(() => localStorage.getItem('bbd-sprint-label') ?? '')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(Date.now())
  const [boardName, setBoardName] = useState('本周写作小组')
  const [boardPeriod, setBoardPeriod] = useState<'day' | 'week'>('week')
  const [boardGoal, setBoardGoal] = useState(10_000)
  const [selectedBoardId, setSelectedBoardId] = useState('')
  const [importPackage, setImportPackage] = useState<SprintPackage | null>(null)
  const [inspection, setInspection] = useState<SprintPackageInspection | null>(null)
  const [packageName, setPackageName] = useState('')
  const sleepHandled = useRef(false)
  const active = sessions.find((session) => session.status === 'running' || session.status === 'paused') ?? null

  async function refresh() {
    const [nextSessions, nextBoards] = await Promise.all([api.listSprints(project.id), api.listSprintBoards(project.id)])
    setSessions(nextSessions); setBoards(nextBoards)
    setSelectedBoardId((current) => current && nextBoards.some((board) => board.id === current) ? current : nextBoards[0]?.id ?? '')
  }

  useEffect(() => { void refresh().catch((error) => notify('error', message(error, '冲刺数据加载失败'))) }, [project.id])
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => { void api.listSprints(project.id).then(setSessions).catch(() => undefined) }, 3_000)
    return () => window.clearInterval(timer)
  }, [project.id, active?.id])
  useEffect(() => { if (activeSceneId) setSceneId(activeSceneId) }, [activeSceneId])
  useEffect(() => { const timer = window.setInterval(() => setTick(Date.now()), 500); return () => window.clearInterval(timer) }, [])
  useEffect(() => {
    if (!active || active.status !== 'running') return
    let hiddenAt: string | null = null
    const visibility = () => {
      if (document.hidden) { hiddenAt = new Date().toISOString(); return }
      if (!hiddenAt || Date.now() - Date.parse(hiddenAt) < 5_000 || sleepHandled.current) return
      sleepHandled.current = true
      void api.reconcileSprint(active.id, { sleepDetected: true, lastObservedAt: hiddenAt, reason: 'page_hidden_gap' }).then((next) => {
        setSessions((current) => current.map((session) => session.id === next.id ? next : session)); notify('error', '检测到离开或系统睡眠，冲刺已在最后可见时间保守暂停，请核对后恢复')
      }).catch((error) => notify('error', message(error, '睡眠对账失败')))
    }
    document.addEventListener('visibilitychange', visibility)
    return () => document.removeEventListener('visibilitychange', visibility)
  }, [active?.id, active?.status])
  useEffect(() => { if (!active || active.status === 'running') sleepHandled.current = false }, [active?.id, active?.status])

  const elapsed = active ? liveElapsed(active, tick) : 0
  const remaining = active ? Math.max(0, active.durationMinutes * 60_000 - elapsed) : 0
  const finishedNotice = useRef<string | null>(null)
  useEffect(() => {
    if (!active || remaining > 0 || finishedNotice.current === active.id) return
    finishedNotice.current = active.id; notify('success', '冲刺时间已到；正文仍按原规则自动保存，请显式结束并生成成果卡')
    if ('Notification' in window && Notification.permission === 'granted') new Notification('笔不怠 · 冲刺完成', { body: `净新增 ${active.netWords} 字，请回到笔不怠确认成果。` })
  }, [active?.id, remaining])

  async function start() {
    setBusy(true)
    try {
      const next = await api.startSprint(project.id, { scope, sceneId: scope === 'scene' ? sceneId : null, durationMinutes, goalWords })
      setSessions((current) => [next, ...current]); notify('success', '安静冲刺已开始；只按保存版本计算净新增')
      if (scope === 'scene' && sceneId) onOpenScene(sceneId)
    } catch (error) { notify('error', message(error, '冲刺开始失败')) } finally { setBusy(false) }
  }

  async function pauseOrResume() {
    if (!active) return
    setBusy(true)
    try { const next = active.status === 'running' ? await api.pauseSprint(active.id) : await api.resumeSprint(active.id); setSessions((current) => current.map((item) => item.id === next.id ? next : item)) }
    catch (error) { notify('error', message(error, '冲刺状态更新失败')) } finally { setBusy(false) }
  }

  async function complete() {
    if (!active) return
    setBusy(true)
    try {
      if (compact) await flushEditor()
      localStorage.setItem('bbd-sprint-label', participantLabel.trim())
      const next = await api.completeSprint(active.id, participantLabel)
      setSessions((current) => current.map((item) => item.id === next.id ? next : item)); notify('success', `成果卡已生成：净新增 ${next.netWords} 字`)
    } catch (error) { notify('error', message(error, '冲刺结束失败')) } finally { setBusy(false) }
  }

  async function cancel() {
    if (!active) return
    setBusy(true)
    try { const next = await api.cancelSprint(active.id); setSessions((current) => current.map((item) => item.id === next.id ? next : item)); notify('success', '冲刺已取消，正文和版本记录不受影响') }
    catch (error) { notify('error', message(error, '取消失败')) } finally { setBusy(false) }
  }

  async function exportCard(cardId: string) {
    try { downloadJson(await api.exportSprintCard(cardId), `sprint-${cardId.slice(0, 8)}.bbd-sprint`); notify('success', '成果卡已导出，不包含书名或正文') }
    catch (error) { notify('error', message(error, '成果卡导出失败')) }
  }

  async function readPackage(file?: File) {
    setInspection(null); setImportPackage(null); setPackageName('')
    if (!file) return
    try { const value = JSON.parse(await file.text()) as SprintPackage; const checked = await api.inspectSprintCard(value); setImportPackage(value); setInspection(checked); setPackageName(file.name) }
    catch (error) { notify('error', message(error, '成果卡读取或校验失败')) }
  }

  async function importCard() {
    if (!selectedBoardId || !importPackage || !inspection) return
    try { const result = await api.importSprintCard(selectedBoardId, importPackage); await refresh(); notify('success', result.duplicate ? '这张成果卡已经在看板中，没有重复累计' : '成果卡已加入离线小组看板') }
    catch (error) { notify('error', message(error, '成果卡导入失败')) }
  }

  async function createBoard() {
    try { const board = await api.createSprintBoard(project.id, { name: boardName, period: boardPeriod, targetWords: boardGoal, periodStartedAt: periodStart(boardPeriod).toISOString() }); await refresh(); setSelectedBoardId(board.id); notify('success', '离线小组看板已创建；参与者名称仅是自填标签') }
    catch (error) { notify('error', message(error, '看板创建失败')) }
  }

  async function addLocal(boardId: string, cardId: string) {
    try { const result = await api.addLocalSprintCard(boardId, cardId); await refresh(); notify('success', result.duplicate ? '该成果已在看板中' : '本机成果已加入看板') }
    catch (error) { notify('error', message(error, '加入看板失败')) }
  }

  if (compact) {
    if (!active) return null
    return <aside className={`sprint-hud ${active.clockStatus !== 'ok' ? 'needs-review' : ''}`} aria-label="安静冲刺计时">
      <div className="sprint-hud-time"><TimerReset size={20}/><strong>{formatDuration(remaining)}</strong><span>{active.status === 'paused' ? '已暂停' : remaining ? '安静写作中' : '已到时'}</span></div>
      <div className="sprint-hud-progress"><span>净新增 <strong>{signed(active.netWords)}</strong> 字</span><span>目标 {active.goalWords}</span></div>
      {active.clockStatus !== 'ok' && <p>{active.clockStatus === 'sleep_reconciled' ? '已排除不可确认的离开/睡眠时段' : '系统时钟异常，计时已暂停'}</p>}
      <div className="sprint-hud-actions"><button onClick={() => void pauseOrResume()} disabled={busy}>{active.status === 'running' ? <><Pause size={14}/>暂停</> : <><Play size={14}/>恢复</>}</button><button onClick={() => void complete()} disabled={busy}><Flag size={14}/>结束</button>{onOpenDetails && <button onClick={onOpenDetails}>详情</button>}</div>
    </aside>
  }

  const completed = sessions.filter((session) => session.resultCard)
  const selectedBoard = boards.find((board) => board.id === selectedBoardId) ?? boards[0]
  return <section className="sprint-workspace">
    <header className="page-header"><div>{onBack && <button className="button ghost compact" onClick={onBack}><ArrowLeft size={14}/>返回写作</button>}<span className="eyebrow">安静冲刺与离线小组目标</span><h2>专注在字句，成果由版本证明</h2><p>计时不等于在线状态；净新增只看已保存版本。结果卡不含书名和正文，参与者名称不是认证身份。</p></div><button className="button ghost compact" onClick={() => void requestNotification(notify)}><Bell size={15}/>本地结束提醒</button></header>
    {active ? <section className={`sprint-active-card ${active.clockStatus !== 'ok' ? 'needs-review' : ''}`}>
      <div className="sprint-clock"><span>{active.status === 'paused' ? '暂停中' : remaining ? '剩余时间' : '时间已到'}</span><strong>{formatDuration(remaining)}</strong><small>已计入 {formatDuration(elapsed)} · {active.scope === 'scene' ? '当前场景' : '整个项目'}</small></div>
      <div className="sprint-live-metrics"><article><strong>{signed(active.netWords)}</strong><span>净新增字数</span></article><article><strong>{active.goalWords}</strong><span>本次目标</span></article><article><strong>{active.samples.length}</strong><span>不可变采样点</span></article></div>
      {active.clockStatus !== 'ok' && <div className="sprint-reconcile"><strong>计时需要核对</strong><p>{active.clockStatus === 'sleep_reconciled' ? '检测到页面离开或系统睡眠，未知时段没有算作连续写作。确认后可恢复。' : '检测到系统时钟回拨，计时已保守暂停。'}</p></div>}
      <label className="sprint-alias">成果卡笔名（自填标签）<input value={participantLabel} maxLength={40} placeholder="匿名作者" onChange={(event) => setParticipantLabel(event.target.value)}/></label>
      <div className="sprint-active-actions"><button className="button secondary" disabled={busy} onClick={() => void pauseOrResume()}>{active.status === 'running' ? <><Pause size={15}/>暂停</> : <><Play size={15}/>核对后恢复</>}</button><button className="button primary" disabled={busy} onClick={() => void complete()}><Flag size={15}/>结束并生成成果卡</button><button className="button ghost" disabled={busy} onClick={() => void cancel()}><Square size={14}/>取消冲刺</button>{active.scope === 'scene' && active.sceneId && <button className="button ghost" onClick={() => onOpenScene(active.sceneId!)}>回到正文</button>}</div>
    </section> : <section className="sprint-start-card">
      <header><div><h3>开始一次可信冲刺</h3><p>10–120 分钟；开始与结束各冻结一次版本快照。</p></div><TimerReset size={26}/></header>
      <div className="sprint-form-grid"><label>范围<SelectControl value={scope} onChange={(event) => setScope(event.target.value as 'scene' | 'project')}><option value="scene">一个场景</option><option value="project">整个项目</option></SelectControl></label>{scope === 'scene' && <label>场景<SelectControl value={sceneId} onChange={(event) => setSceneId(event.target.value)}>{scenes.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</SelectControl></label>}<label>时长（分钟）<input type="number" min={10} max={120} value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))}/></label><label>净新增目标<input type="number" min={1} max={50000} value={goalWords} onChange={(event) => setGoalWords(Number(event.target.value))}/></label></div>
      <button className="button primary" disabled={busy || (scope === 'scene' && !sceneId)} onClick={() => void start()}><Play size={15}/>开始并进入安静写作</button>
    </section>}

    <div className="sprint-columns">
      <section className="sprint-card"><header><h3>可验证成果卡</h3><span>{completed.length} 张</span></header><div className="sprint-result-list">{completed.map((session) => { const card = session.resultCard!; return <article key={card.id}><div><strong>{signed(card.netWords)} 字</strong><span>{card.participantLabel} · {Math.round(card.activeDurationMs / 60_000)} 分钟</span><small>{new Date(card.endedAt).toLocaleString('zh-CN')} · {card.eventCount} 个链式事件</small></div><div><button className="button ghost compact" onClick={() => void exportCard(card.id)}><Download size={13}/>导出</button>{selectedBoard && <button className="button ghost compact" onClick={() => void addLocal(selectedBoard.id, card.id)}>加入看板</button>}</div></article>})}{!completed.length && <p className="empty-copy">完成一次冲刺后，这里会出现不含正文的成果卡。</p>}</div></section>
      <section className="sprint-card"><header><h3>离线小组看板</h3><span>手动交换成果卡</span></header>
        <div className="board-create"><input aria-label="看板名称" value={boardName} onChange={(event) => setBoardName(event.target.value)}/><SelectControl aria-label="目标周期" value={boardPeriod} onChange={(event) => setBoardPeriod(event.target.value as 'day' | 'week')}><option value="day">今日</option><option value="week">本周</option></SelectControl><input aria-label="小组目标字数" type="number" min={1} value={boardGoal} onChange={(event) => setBoardGoal(Number(event.target.value))}/><button className="button secondary compact" onClick={() => void createBoard()}><Users size={14}/>新建</button></div>
        {boards.length > 0 && <label>当前看板<SelectControl value={selectedBoard?.id ?? ''} onChange={(event) => setSelectedBoardId(event.target.value)}>{boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}</SelectControl></label>}
        {selectedBoard && <div className="board-summary"><div className="board-total"><CalendarDays size={20}/><span><strong>{selectedBoard.totalNetWords.toLocaleString('zh-CN')} / {selectedBoard.targetWords.toLocaleString('zh-CN')}</strong><small>{selectedBoard.period === 'day' ? '当日目标' : '本周目标'} · {selectedBoard.entries.length} 张成果卡</small></span></div><progress value={Math.max(0, selectedBoard.totalNetWords)} max={selectedBoard.targetWords}/><div className="board-participants">{selectedBoard.participants.map((person) => <span key={person.participantLabel}><strong>{person.participantLabel}</strong><em>{person.netWords} 字 · {person.sprintCount} 次</em></span>)}</div></div>}
        <label className="review-file"><Upload size={18}/><span>{packageName || '选择 .bbd-sprint 成果卡'}</span><input aria-label="选择冲刺成果卡" type="file" accept=".bbd-sprint,application/json" onChange={(event) => void readPackage(event.target.files?.[0])}/></label>
        {inspection && <div className="sprint-inspection"><strong>{inspection.participantLabel} · {signed(inspection.netWords)} 字</strong><span>{Math.round(inspection.activeDurationMs / 60_000)} 分钟 · 事件链 {inspection.eventCount} 项</span></div>}
        <button className="button primary full" disabled={!selectedBoard || !inspection} onClick={() => void importCard()}>校验后加入当前看板</button>
      </section>
    </div>
  </section>
}

function liveElapsed(session: SprintSession, now: number) { return session.status === 'running' ? Math.max(0, now - Date.parse(session.startedAt) - session.totalPausedMs) : session.activeElapsedMs }
function formatDuration(ms: number) { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` }
function signed(value: number) { return value > 0 ? `+${value}` : String(value) }
function message(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback }
function periodStart(period: 'day' | 'week') { const date = new Date(); date.setHours(0, 0, 0, 0); if (period === 'week') { const day = (date.getDay() + 6) % 7; date.setDate(date.getDate() - day) } return date }
function downloadJson(value: unknown, fileName: string) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; anchor.click(); URL.revokeObjectURL(url) }
async function requestNotification(notify: Props['notify']) { if (!('Notification' in window)) return notify('error', '当前系统不支持本地通知'); const permission = await Notification.requestPermission(); notify(permission === 'granted' ? 'success' : 'error', permission === 'granted' ? '冲刺结束提醒已允许' : '未获得通知权限，应用内计时仍可用') }
async function flushEditor() { await new Promise<void>((resolve) => { let settled = false; const done = () => { if (!settled) { settled = true; resolve() } }; window.dispatchEvent(new CustomEvent('bbd:flush-editor', { detail: { done } })); window.setTimeout(done, 1_200) }) }
