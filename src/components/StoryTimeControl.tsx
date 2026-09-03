import { useEffect, useState } from 'react'
import { CalendarDays, ChevronRight, Clock3, Link2, RotateCcw } from 'lucide-react'
import type { ManuscriptNode, StoryTimeMode, StoryTimePrecision, StoryTimeSettings, StoryTimeSpec } from '../../shared/types'
import { defaultStoryTimeSettings, describeStoryTime, emptyStoryTimeSpec, legacyStoryTimeSpec, normalizeStoryTimeSettings, storyTimeLabel } from '../../shared/storyTime'
import { api } from '../lib/api'
import { Modal } from './Modal'
import { Button, SelectField, TextField } from '../ui'

type Notify = (type: 'success' | 'error', message: string) => void

const modeLabels: Record<StoryTimeMode, string> = { calendar: '现代日期', custom: '古风／自定义纪年', relative: '相对场景', sequence: '仅确定先后' }
const precisionLabels: Record<StoryTimePrecision, string> = { exact: '准确', day: '约在当日', month: '约在当月', year: '约在当年', approximate: '大致时间' }

export function StoryTimeControl({ projectId, node, onUpdateNode, notify, onOpenSettings }: { projectId: string; node: ManuscriptNode; onUpdateNode: (patch: Partial<ManuscriptNode>) => Promise<void>; notify: Notify; onOpenSettings?: () => void }) {
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [nodes, setNodes] = useState<ManuscriptNode[]>([])
  const [settings, setSettings] = useState<StoryTimeSettings>(defaultStoryTimeSettings)
  const [draft, setDraft] = useState<StoryTimeSpec>(() => node.storyTimeSpec ?? legacyStoryTimeSpec(node.storyTime))
  const [error, setError] = useState('')
  useEffect(() => { setDraft(node.storyTimeSpec ?? legacyStoryTimeSpec(node.storyTime, settings)) }, [node.id, node.storyTime, node.storyTimeSpec])

  async function openEditor() {
    setEditing(true); setLoading(true); setError('')
    try {
      const [tree, saved] = await Promise.all([api.listNodes(projectId), api.getSetting<StoryTimeSettings | null>(projectId, 'story_time_system')])
      const nextSettings = normalizeStoryTimeSettings(saved.value)
      setNodes(tree.filter((item) => item.type === 'scene' && !item.deletedAt))
      setSettings(nextSettings)
      setDraft(node.storyTimeSpec ?? legacyStoryTimeSpec(node.storyTime, nextSettings))
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : '故事时间加载失败') }
    finally { setLoading(false) }
  }
  function changeMode(mode: StoryTimeMode) { setDraft(emptyStoryTimeSpec(mode, settings)); setError('') }
  async function save() {
    const message = validate(draft)
    if (message) { setError(message); return }
    const label = describeStoryTime({ ...node, storyTimeSpec: draft, storyTime: storyTimeLabel(draft) }, nodes)
    const next = { ...draft, displayLabel: draft.displayLabel.trim() }
    setSaving(true)
    try { await onUpdateNode({ storyTime: label, storyTimeSpec: next }); setEditing(false); notify('success', '故事时间已结构化保存') }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : '故事时间保存失败') }
    finally { setSaving(false) }
  }
  async function clear() {
    setSaving(true)
    try { await onUpdateNode({ storyTime: null, storyTimeSpec: null }); setEditing(false); notify('success', '本场故事时间已清除') }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : '故事时间清除失败') }
    finally { setSaving(false) }
  }
  const summary = node.storyTimeSpec ? describeStoryTime(node, nodes) : node.storyTime || '时间未定'
  return <>
    <button type="button" className={`story-time-trigger${node.storyTime ? ' has-value' : ''}`} onClick={() => void openEditor()} aria-label={`编辑故事时间：${summary}`}>
      <span><Clock3 size={15}/><strong>故事时间</strong></span><span>{summary}</span><ChevronRight size={15}/>
    </button>
    {editing && <Modal
      title="设置本场故事时间"
      onClose={() => setEditing(false)}
      className="story-time-dialog"
      footer={!loading ? <div className="story-time-footer-actions">
        <div>{(node.storyTime || node.storyTimeSpec) && <Button variant="ghost" leadingIcon={<RotateCcw size={14}/>} disabled={saving} onClick={() => void clear()}>清除时间</Button>}</div>
        <div><Button disabled={saving} onClick={() => setEditing(false)}>取消</Button><Button variant="primary" loading={saving} onClick={() => void save()}>保存故事时间</Button></div>
      </div> : undefined}
    >
      <div className="story-time-editor">
        <div className="story-time-principle"><CalendarDays size={17}/><div><strong>原样显示，结构排序</strong><span>古风纪年不会被换算成公历；这里填写的结构信息只用于判断先后。</span></div></div>
        {loading ? <p className="muted">正在读取本书时间体系…</p> : <>
          <section className="story-time-section" aria-labelledby="story-time-structure-title">
            <div className="story-time-section-heading"><div><span>1</span><strong id="story-time-structure-title">确定时间结构</strong></div><small>决定系统如何理解与排序</small></div>
            <div className="story-time-basics"><SelectField label="时间方式" value={draft.mode} onValueChange={(value) => changeMode(value as StoryTimeMode)}>{Object.entries(modeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="时间精度" value={draft.precision} onValueChange={(value) => setDraft({ ...draft, precision: value as StoryTimePrecision })}>{Object.entries(precisionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField></div>
          </section>
          {draft.mode === 'calendar' && <CalendarDateFields draft={draft} onChange={setDraft}/>}
          {draft.mode === 'custom' && <><div className="form-grid"><TextField label="纪年／年号" optional value={draft.era} onChange={(event) => setDraft({ ...draft, era: event.target.value })} placeholder="如：承平"/><TextField label="纪年顺序" type="number" min="1" value={draft.eraOrder} onChange={(event) => setDraft({ ...draft, eraOrder: Number(event.target.value) || 1 })} description="改元后依次填 2、3…"/></div><div className="story-time-number-grid"><TextField label="年" required type="number" min="0" value={draft.year ?? ''} onChange={(event) => setDraft({ ...draft, year: nullableNumber(event.target.value) })}/><TextField label="月" optional type="number" min="1" max="99" value={draft.month ?? ''} onChange={(event) => setDraft({ ...draft, month: nullableNumber(event.target.value) })}/><TextField label="日" optional type="number" min="1" max="99" value={draft.day ?? ''} onChange={(event) => setDraft({ ...draft, day: nullableNumber(event.target.value) })}/></div><SelectField label="时辰" optional value={draft.period} onValueChange={(value) => setDraft({ ...draft, period: value })}><option value="">未指定</option>{['子时','丑时','寅时','卯时','辰时','巳时','午时','未时','申时','酉时','戌时','亥时'].map((value) => <option key={value} value={value}>{value}</option>)}</SelectField></>}
          {(draft.mode === 'relative' || draft.mode === 'sequence') && <><SelectField label="锚点场景" required value={draft.anchorNodeId ?? ''} onValueChange={(value) => setDraft({ ...draft, anchorNodeId: value || null })}><option value="">请选择场景</option>{nodes.filter((item) => item.id !== node.id).map((item) => <option key={item.id} value={item.id}>{item.title}{item.storyTime ? ` · ${item.storyTime}` : ''}</option>)}</SelectField><SelectField label="相对位置" value={draft.relation} onValueChange={(value) => setDraft({ ...draft, relation: value as StoryTimeSpec['relation'] })}><option value="before">之前</option><option value="same">同时</option><option value="after">之后</option></SelectField>{draft.mode === 'relative' && draft.relation !== 'same' && <div className="form-grid"><TextField label="间隔" required type="number" min="1" value={draft.offsetValue} onChange={(event) => setDraft({ ...draft, offsetValue: Math.max(0, Number(event.target.value) || 0) })}/><SelectField label="单位" value={draft.offsetUnit} onValueChange={(value) => setDraft({ ...draft, offsetUnit: value as StoryTimeSpec['offsetUnit'] })}><option value="hour">小时</option><option value="day">日</option><option value="month">月</option><option value="year">年</option><option value="scene">场</option></SelectField></div>}</>}
          <details key={draft.mode} className="story-time-display-options" open={draft.displayLabel ? true : undefined}>
            <summary><span>自定义显示文字</span><small>选填</small></summary>
            <TextField label="作者显示文字" value={draft.displayLabel} onChange={(event) => setDraft({ ...draft, displayLabel: event.target.value })} placeholder={draft.mode === 'custom' ? '如：承平十二年腊月廿三子时' : draft.mode === 'relative' ? '如：三日后的雪夜' : '留空则自动生成'} description="只影响界面和 AI 描述，不改变系统排序。"/>
          </details>
          {error && <p className="test-result error" role="alert">{error}</p>}
          <div className="story-time-preview"><CalendarDays size={17}/><div><span>保存后显示</span><strong>{validate(draft) ? '填写完整后显示预览' : describeStoryTime({ ...node, storyTimeSpec: draft }, nodes)}</strong></div></div>
          {onOpenSettings && <button type="button" className="story-time-settings-link" onClick={() => { setEditing(false); onOpenSettings() }}><Link2 size={14}/>修改本书默认时间体系</button>}
        </>}
      </div>
    </Modal>}
  </>
}

export function StoryTimeSettingsPanel({ projectId, notify }: { projectId: string; notify: Notify }) {
  const [settings, setSettings] = useState<StoryTimeSettings>(defaultStoryTimeSettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  useEffect(() => { void api.getSetting<StoryTimeSettings | null>(projectId, 'story_time_system').then(({ value }) => setSettings(normalizeStoryTimeSettings(value))).catch((error) => notify('error', error instanceof Error ? error.message : '时间体系加载失败')).finally(() => setLoading(false)) }, [projectId])
  async function save() {
    setSaving(true)
    try { await api.setSetting(projectId, 'story_time_system', settings); window.dispatchEvent(new Event('bbd:story-time-settings-changed')); notify('success', '本书默认时间体系已保存') }
    catch (error) { notify('error', error instanceof Error ? error.message : '时间体系保存失败') }
    finally { setSaving(false) }
  }
  return <><span className="eyebrow">时间体系</span><h3>让显示符合题材，让排序保持准确</h3><p className="muted">这里只决定新场景默认打开哪种时间表单，不会批量改写已有场景。</p>{loading ? <p className="muted">正在读取设置…</p> : <div className="form-stack"><SelectField label="默认时间方式" value={settings.defaultMode} onValueChange={(value) => setSettings({ ...settings, defaultMode: value as StoryTimeMode })}>{Object.entries(modeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>{settings.defaultMode === 'custom' && <TextField label="默认纪年／年号" optional value={settings.customEra} onChange={(event) => setSettings({ ...settings, customEra: event.target.value })} placeholder="如：承平；每个场景仍可覆盖"/>}<div className="time-system-examples"><article><strong>现代日期</strong><span>适合现实、都市、历史考据；按标准日期精确排序。</span></article><article><strong>古风／架空</strong><span>保留年号、时辰和作者原话，通过纪年序号处理改元。</span></article><article><strong>相对／仅排序</strong><span>只知道“三日后”或前后关系时，不强迫作者编造日期。</span></article></div><div className="modal-actions"><Button variant="primary" loading={saving} onClick={() => void save()}>保存默认体系</Button></div></div>}</>
}

function nullableNumber(value: string): number | null { return value === '' ? null : Number(value) }
function validate(spec: StoryTimeSpec): string {
  if (spec.mode === 'calendar' && !isValidCalendarDate(spec.calendarDate)) return '请填写完整、有效的日期。'
  if (spec.mode === 'calendar' && spec.clockTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(spec.clockTime)) return '时刻请使用 00:00 至 23:59 的格式。'
  if (spec.mode === 'custom' && spec.year === null) return '请填写纪年年份。'
  if ((spec.mode === 'relative' || spec.mode === 'sequence') && !spec.anchorNodeId) return '请选择一个锚点场景。'
  if (spec.mode === 'relative' && spec.relation !== 'same' && spec.offsetValue < 1) return '相对时间的间隔至少为 1。'
  return ''
}

function CalendarDateFields({ draft, onChange }: { draft: StoryTimeSpec; onChange: (next: StoryTimeSpec) => void }) {
  const [year = '', month = '', day = ''] = draft.calendarDate.split('-')
  const maxDay = daysInMonth(Number(year), Number(month))
  const setDatePart = (part: 'year' | 'month' | 'day', value: string) => {
    let nextYear = year; let nextMonth = month; let nextDay = day
    if (part === 'year') nextYear = value.replace(/\D/g, '').slice(0, 4)
    if (part === 'month') nextMonth = value
    if (part === 'day') nextDay = value
    if (nextDay && Number(nextDay) > daysInMonth(Number(nextYear), Number(nextMonth))) nextDay = ''
    onChange({ ...draft, calendarDate: `${nextYear}-${nextMonth}-${nextDay}` })
  }
  const useToday = () => {
    const today = new Date()
    const value = `${today.getFullYear().toString().padStart(4, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    onChange({ ...draft, calendarDate: value })
  }
  return <section className="story-time-calendar-card" aria-labelledby="story-time-date-title">
    <div className="story-time-field-heading"><div><strong id="story-time-date-title">日期</strong><span className="ui-field-required" aria-hidden="true">*</span></div><button type="button" onClick={useToday}>填入今天</button></div>
    <div className="story-time-date-grid">
      <TextField label="年" inputMode="numeric" placeholder="YYYY" value={year} aria-required="true" onChange={(event) => setDatePart('year', event.target.value)}/>
      <SelectField label="月" value={month} aria-required onValueChange={(value) => setDatePart('month', value)}><option value="">请选择</option>{numberOptions(12).map((value) => <option key={value} value={value}>{Number(value)} 月</option>)}</SelectField>
      <SelectField label="日" value={day} aria-required disabled={!month} onValueChange={(value) => setDatePart('day', value)}><option value="">请选择</option>{numberOptions(maxDay).map((value) => <option key={value} value={value}>{Number(value)} 日</option>)}</SelectField>
    </div>
    <TextField label="时刻" optional inputMode="numeric" maxLength={5} placeholder="如：12:30" value={draft.clockTime} onChange={(event) => onChange({ ...draft, clockTime: event.target.value.replace(/[^\d:]/g, '').slice(0, 5) })}/>
  </section>
}

function numberOptions(total: number): string[] { return Array.from({ length: total }, (_, index) => String(index + 1).padStart(2, '0')) }
function daysInMonth(year: number, month: number): number {
  if (!month || month < 1 || month > 12) return 31
  if (month === 2) return year > 0 && (year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0)) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}
function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}
