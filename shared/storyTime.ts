import type { ManuscriptNode } from './types.js'

export type StoryTimeMode = 'calendar' | 'custom' | 'relative' | 'sequence'
export type StoryTimePrecision = 'exact' | 'day' | 'month' | 'year' | 'approximate'
export type StoryTimeRelation = 'before' | 'same' | 'after'
export type StoryTimeOffsetUnit = 'scene' | 'hour' | 'day' | 'month' | 'year'

export interface StoryTimeSettings {
  defaultMode: StoryTimeMode
  customEra: string
}

export interface StoryTimeSpec {
  version: 1
  mode: StoryTimeMode
  precision: StoryTimePrecision
  displayLabel: string
  calendarDate: string
  clockTime: string
  era: string
  eraOrder: number
  year: number | null
  month: number | null
  day: number | null
  period: string
  anchorNodeId: string | null
  relation: StoryTimeRelation
  offsetValue: number
  offsetUnit: StoryTimeOffsetUnit
}

export const defaultStoryTimeSettings: StoryTimeSettings = { defaultMode: 'calendar', customEra: '' }

export function normalizeStoryTimeSettings(value: unknown): StoryTimeSettings {
  if (!value || typeof value !== 'object') return defaultStoryTimeSettings
  const input = value as Partial<StoryTimeSettings>
  const modes: StoryTimeMode[] = ['calendar', 'custom', 'relative', 'sequence']
  return {
    defaultMode: modes.includes(input.defaultMode as StoryTimeMode) ? input.defaultMode as StoryTimeMode : 'calendar',
    customEra: typeof input.customEra === 'string' ? input.customEra.slice(0, 40) : '',
  }
}

export function emptyStoryTimeSpec(mode: StoryTimeMode, settings: StoryTimeSettings = defaultStoryTimeSettings): StoryTimeSpec {
  return { version: 1, mode, precision: 'exact', displayLabel: '', calendarDate: '', clockTime: '', era: settings.customEra, eraOrder: 1, year: null, month: null, day: null, period: '', anchorNodeId: null, relation: 'after', offsetValue: mode === 'relative' ? 1 : 0, offsetUnit: mode === 'relative' ? 'day' : 'scene' }
}

export function legacyStoryTimeSpec(value: string | null, settings: StoryTimeSettings = defaultStoryTimeSettings): StoryTimeSpec {
  const spec = emptyStoryTimeSpec(/^\d{4}-\d{2}-\d{2}/.test(value ?? '') ? 'calendar' : settings.defaultMode, settings)
  if (!value) return spec
  if (spec.mode === 'calendar') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/)
    if (match) return { ...spec, calendarDate: match[1], clockTime: match[2] ?? '', displayLabel: value }
  }
  return { ...spec, displayLabel: value, precision: 'approximate' }
}

export function storyTimeLabel(spec: StoryTimeSpec | null | undefined, legacy: string | null = null): string {
  if (!spec) return legacy ?? ''
  if (spec.displayLabel.trim()) return spec.displayLabel.trim()
  if (spec.mode === 'calendar') return [spec.calendarDate, spec.clockTime].filter(Boolean).join(' ') || legacy || ''
  if (spec.mode === 'custom') {
    const parts = [spec.era.trim(), spec.year === null ? '' : `${spec.year}年`, spec.month === null ? '' : `${spec.month}月`, spec.day === null ? '' : `${spec.day}日`, spec.period.trim()]
    return parts.filter(Boolean).join(' · ') || legacy || ''
  }
  return legacy ?? ''
}

export function storyTimeSortValue(node: ManuscriptNode, nodes: ManuscriptNode[], visiting = new Set<string>()): number | null {
  if (visiting.has(node.id)) return null
  const spec = node.storyTimeSpec
  if (!spec) return legacySortValue(node.storyTime)
  if (spec.mode === 'calendar') return calendarSortValue(spec)
  if (spec.mode === 'custom') return customSortValue(spec)
  if (!spec.anchorNodeId) return null
  const anchor = nodes.find((item) => item.id === spec.anchorNodeId)
  if (!anchor) return null
  const nextVisiting = new Set(visiting); nextVisiting.add(node.id)
  const anchorValue = storyTimeSortValue(anchor, nodes, nextVisiting)
  if (anchorValue === null) return null
  const direction = spec.relation === 'before' ? -1 : spec.relation === 'after' ? 1 : 0
  if (spec.mode === 'sequence') return anchorValue + direction * 0.001
  return anchorValue + direction * Math.max(0, spec.offsetValue) * unitMinutes(spec.offsetUnit)
}

export function compareStoryTime(a: ManuscriptNode, b: ManuscriptNode, nodes: ManuscriptNode[]): number {
  const av = storyTimeSortValue(a, nodes); const bv = storyTimeSortValue(b, nodes)
  const ad = storyTimeDomain(a, nodes); const bd = storyTimeDomain(b, nodes)
  if (av !== null && bv !== null && ad !== null && ad === bd && av !== bv) return av - bv
  if (av !== null && bv === null) return -1
  if (av === null && bv !== null) return 1
  return narrativeIndex(a, nodes) - narrativeIndex(b, nodes)
}

/** Calendar and fictional eras are intentionally separate timelines. */
export function storyTimeDomain(node: ManuscriptNode, nodes: ManuscriptNode[], visiting = new Set<string>()): 'calendar' | 'custom' | null {
  if (visiting.has(node.id)) return null
  const spec = node.storyTimeSpec
  if (!spec) return /^\d{4}-\d{2}-\d{2}/.test(node.storyTime ?? '') ? 'calendar' : null
  if (spec.mode === 'calendar' || spec.mode === 'custom') return spec.mode
  const anchor = nodes.find((item) => item.id === spec.anchorNodeId)
  if (!anchor) return null
  const nextVisiting = new Set(visiting); nextVisiting.add(node.id)
  return storyTimeDomain(anchor, nodes, nextVisiting)
}

export function describeStoryTime(node: ManuscriptNode, nodes: ManuscriptNode[]): string {
  const spec = node.storyTimeSpec
  const label = storyTimeLabel(spec, node.storyTime) || '时间未定'
  if (!spec || (spec.mode !== 'relative' && spec.mode !== 'sequence')) return label
  const anchor = nodes.find((item) => item.id === spec.anchorNodeId)
  if (!anchor) return label
  const relation = spec.relation === 'before' ? '之前' : spec.relation === 'same' ? '同时' : '之后'
  if (spec.mode === 'sequence') return spec.displayLabel.trim() || `${anchor.title}${relation}`
  const units: Record<StoryTimeOffsetUnit, string> = { scene: '场', hour: '小时', day: '日', month: '月', year: '年' }
  return spec.displayLabel.trim() || `${anchor.title}${spec.offsetValue}${units[spec.offsetUnit]}${relation}`
}

export function storyTimeContext(node: ManuscriptNode, nodes: ManuscriptNode[]): string {
  if (!node.storyTime && !node.storyTimeSpec) return '故事时间未指定；不得自行推断。'
  const spec = node.storyTimeSpec
  const labels: Record<StoryTimeMode, string> = { calendar: '现代日期', custom: '自定义纪年', relative: '相对时间', sequence: '仅排序' }
  const precisionLabels: Record<StoryTimePrecision, string> = { exact: '准确', day: '约在当日', month: '约在当月', year: '约在当年', approximate: '大致时间' }
  return `故事时间：${describeStoryTime(node, nodes)}${spec ? `；类型：${labels[spec.mode]}；精度：${precisionLabels[spec.precision]}` : '；旧版自由文本，可信度待确认'}。`
}

function calendarSortValue(spec: StoryTimeSpec): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spec.calendarDate)) return null
  const [year, month, day] = spec.calendarDate.split('-').map(Number)
  const candidate = new Date(0); candidate.setUTCFullYear(year, month - 1, day); candidate.setUTCHours(0, 0, 0, 0)
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() + 1 !== month || candidate.getUTCDate() !== day) return null
  const value = Date.parse(`${spec.calendarDate}T${/^\d{2}:\d{2}$/.test(spec.clockTime) ? spec.clockTime : '00:00'}:00Z`)
  return Number.isNaN(value) ? null : value / 60_000
}

function customSortValue(spec: StoryTimeSpec): number | null {
  if (spec.year === null) return null
  const month = spec.month ?? 0; const day = spec.day ?? 0
  const period = ['子时','丑时','寅时','卯时','辰时','巳时','午时','未时','申时','酉时','戌时','亥时'].indexOf(spec.period)
  return spec.eraOrder * 1_000_000_000_000 + spec.year * 100_000_000 + month * 1_000_000 + day * 10_000 + Math.max(0, period) * 100
}

function legacySortValue(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed / 60_000
}

function unitMinutes(unit: StoryTimeOffsetUnit): number {
  return ({ scene: 0.001, hour: 60, day: 1_440, month: 44_640, year: 535_680 } as const)[unit]
}

function narrativeIndex(node: ManuscriptNode, nodes: ManuscriptNode[]): number {
  const chapters = nodes.filter((item) => item.type === 'chapter').sort((a, b) => a.sortKey - b.sortKey)
  const chapterOrder = new Map(chapters.map((item, index) => [item.id, index]))
  const scenes = nodes.filter((item) => item.type === 'scene').sort((a, b) => (chapterOrder.get(a.parentId ?? '') ?? 0) - (chapterOrder.get(b.parentId ?? '') ?? 0) || a.sortKey - b.sortKey)
  return scenes.findIndex((item) => item.id === node.id)
}
