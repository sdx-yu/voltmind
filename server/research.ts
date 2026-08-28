import fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type {
  ReleaseReadiness,
  ResearchBundle,
  ResearchBundleEvent,
  ResearchBundleInspection,
  ResearchEnrollment,
  ResearchIssueCode,
  ResearchProgress,
  ResearchStatus,
  ResearchTask,
  ResearchTaskType,
  SupportBundle,
} from '../shared/types.js'
import type { AppConfig } from './config.js'
import { AppDatabase } from './db.js'
import { listDatabaseSnapshots } from './backups.js'
import { jsonParse, newId, nowIso, sha256 } from './utils.js'

type Row = Record<string, unknown>

export const APP_VERSION = '1.7.0'
export const RESEARCH_CONSENT_VERSION = 'r1-consent-v1' as const
export const RESEARCH_CONSENT_TEXT = '我自愿参加笔不怠 R1 本地验证。我确认使用自己拥有权利的稿件；应用只在本机记录任务类型、耗时、完成情况、难度、预估节省时间和预定义问题码，不记录或上传正文、书名、正典、Prompt、密钥与设备路径；只有我主动导出研究包时数据才会离开本机；我可以随时退出并清除当前数据库中的研究记录。已有历史数据库快照按备份策略保留，需要由我另行管理；已交给研究负责人的副本需要另行联系删除。'
export const RESEARCH_CONSENT_HASH = sha256(RESEARCH_CONSENT_TEXT)

const taskTypes = ['canon_loop', 'fact_lookup', 'restore_drill', 'legacy_import', 'weekly_reflection'] as const
const issueCodes = ['hard_to_find', 'false_positive', 'missed_fact', 'confusing_candidate', 'slow', 'recovery_failed', 'data_loss'] as const

const taskSchema = z.object({
  id: z.string().uuid(),
  taskType: z.enum(taskTypes),
  projectScopeHash: z.string().length(64),
  status: z.enum(['active', 'completed', 'abandoned']),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  durationSeconds: z.number().int().nonnegative().nullable(),
  goalAchieved: z.boolean().nullable(),
  difficulty: z.number().int().min(1).max(5).nullable(),
  minutesSaved: z.number().int().min(0).max(480).nullable(),
  issueCodes: z.array(z.enum(issueCodes)).max(issueCodes.length),
}).strict()

const progressSchema = z.object({
  completedTasks: z.number().int().nonnegative(),
  completedCoreLoops: z.number().int().nonnegative(),
  observedWeekBuckets: z.number().int().nonnegative(),
  reportedMinutesSaved: z.number().int().nonnegative(),
  dataLossReports: z.number().int().nonnegative(),
  lastActivityAt: z.string().nullable(),
}).strict()

const eventBase = { sequence: z.number().int().positive(), previousHash: z.string().length(64).nullable(), eventHash: z.string().length(64), occurredAt: z.iso.datetime() }
const eventSchema = z.discriminatedUnion('eventType', [
  z.object({ ...eventBase, eventType: z.literal('consented'), payload: z.object({ participantCode: z.string().regex(/^R1-[A-F0-9]{12}$/), consentReceiptHash: z.string().length(64) }).strict() }).strict(),
  z.object({ ...eventBase, eventType: z.literal('task_started'), payload: z.object({ taskId: z.string().uuid(), taskType: z.enum(taskTypes), projectScopeHash: z.string().length(64) }).strict() }).strict(),
  z.object({ ...eventBase, eventType: z.literal('task_completed'), payload: z.object({ taskId: z.string().uuid(), outcome: z.enum(['completed', 'abandoned']), goalAchieved: z.boolean(), difficulty: z.number().int().min(1).max(5), minutesSaved: z.number().int().min(0).max(480), issueCodes: z.array(z.enum(issueCodes)).max(issueCodes.length), durationSeconds: z.number().int().nonnegative() }).strict() }).strict(),
])

const researchBundleSchema = z.object({
  format: z.literal('bbd-research-v1'),
  manifest: z.object({
    formatVersion: z.literal(1),
    exportedAt: z.iso.datetime(),
    participantCode: z.string().regex(/^R1-[A-F0-9]{12}$/),
    consent: z.object({ version: z.literal(RESEARCH_CONSENT_VERSION), textHash: z.string().length(64), receiptHash: z.string().length(64), consentedAt: z.iso.datetime() }).strict(),
    privacy: z.object({ containsManuscriptText: z.literal(false), containsProjectTitlesOrIds: z.literal(false), containsPromptsOrSecrets: z.literal(false), localUntilExplicitExport: z.literal(true) }).strict(),
    tasks: z.array(taskSchema).max(1000),
    events: z.array(eventSchema).max(3000),
    progress: progressSchema,
  }).strict(),
  manifestHash: z.string().length(64),
}).strict()

export class ResearchService {
  constructor(private readonly database: AppDatabase) {}

  getStatus(): ResearchStatus {
    const enrollment = this.getEnrollment()
    const tasks = enrollment ? this.listTasks(enrollment.id) : []
    return {
      consent: { version: RESEARCH_CONSENT_VERSION, text: RESEARCH_CONSENT_TEXT, textHash: RESEARCH_CONSENT_HASH },
      enrollment,
      tasks,
      progress: progress(tasks),
      privacy: { localOnlyUntilExplicitExport: true, excludesManuscriptText: true, excludesProjectIdentity: true, exportDoesNotCompleteR1Gate: true },
    }
  }

  enroll(confirmations: { adultOrAuthorized: boolean; manuscriptRights: boolean; localOnlyUnderstood: boolean; voluntary: boolean }): ResearchStatus {
    if (this.getEnrollment()) throw new Error('An active research enrollment already exists')
    if (!Object.values(confirmations).every(Boolean)) throw new Error('All research consent confirmations are required')
    const id = newId(); const participantCode = `R1-${randomBytes(6).toString('hex').toUpperCase()}`; const consentedAt = nowIso()
    const consentReceiptHash = sha256(stableStringify({ participantCode, consentVersion: RESEARCH_CONSENT_VERSION, consentTextHash: RESEARCH_CONSENT_HASH, confirmations, consentedAt }))
    this.database.transaction(() => {
      this.database.db.prepare(`INSERT INTO research_enrollments(id,participant_code,consent_version,consent_text_hash,consent_receipt_hash,confirmations_json,consented_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(id, participantCode, RESEARCH_CONSENT_VERSION, RESEARCH_CONSENT_HASH, consentReceiptHash, JSON.stringify(confirmations), consentedAt, consentedAt, consentedAt)
      this.appendEvent(id, 'consented', { participantCode, consentReceiptHash }, consentedAt)
    })
    return this.getStatus()
  }

  startTask(projectId: string, taskType: ResearchTaskType): ResearchTask {
    const enrollment = this.requireEnrollment()
    const project = this.database.getProject(projectId)
    if (!project || project.deletedAt) throw new Error('Research project not found')
    if (!taskTypes.includes(taskType)) throw new Error('Invalid research task type')
    if (this.database.db.prepare("SELECT 1 FROM research_tasks WHERE enrollment_id=? AND status='active'").get(enrollment.id)) throw new Error('A research task is already active')
    const id = newId(); const startedAt = nowIso(); const projectScopeHash = sha256(`bbd-research-v1|${enrollment.participantCode}|${projectId}`)
    this.database.transaction(() => {
      this.database.db.prepare(`INSERT INTO research_tasks(id,enrollment_id,project_id,project_scope_hash,task_type,status,started_at)
        VALUES(?,?,?,?,?,'active',?)`).run(id, enrollment.id, projectId, projectScopeHash, taskType, startedAt)
      this.appendEvent(enrollment.id, 'task_started', { taskId: id, taskType, projectScopeHash }, startedAt)
    })
    return this.requireTask(id)
  }

  completeTask(id: string, input: { outcome: 'completed' | 'abandoned'; goalAchieved: boolean; difficulty: number; minutesSaved: number; issueCodes: ResearchIssueCode[] }): ResearchTask {
    const enrollment = this.requireEnrollment(); const task = this.requireTask(id)
    if (task.status !== 'active') throw new Error('Research task already resolved')
    if (!Number.isInteger(input.difficulty) || input.difficulty < 1 || input.difficulty > 5) throw new Error('Research difficulty must be 1–5')
    if (!Number.isInteger(input.minutesSaved) || input.minutesSaved < 0 || input.minutesSaved > 480) throw new Error('Research minutes saved must be 0–480')
    const uniqueIssues = [...new Set(input.issueCodes)]
    if (uniqueIssues.some((code) => !issueCodes.includes(code))) throw new Error('Invalid research issue code')
    const completedAt = nowIso(); const durationSeconds = Math.max(0, Math.round((Date.parse(completedAt) - Date.parse(task.startedAt)) / 1000)); const goalAchieved = input.outcome === 'completed' && input.goalAchieved
    this.database.transaction(() => {
      this.database.db.prepare(`UPDATE research_tasks SET status=?,completed_at=?,duration_seconds=?,goal_achieved=?,difficulty=?,minutes_saved=?,issue_codes_json=? WHERE id=?`).run(
        input.outcome, completedAt, durationSeconds, goalAchieved ? 1 : 0, input.difficulty, input.minutesSaved, JSON.stringify(uniqueIssues), id,
      )
      this.database.db.prepare('UPDATE research_enrollments SET updated_at=? WHERE id=?').run(completedAt, enrollment.id)
      this.appendEvent(enrollment.id, 'task_completed', { taskId: id, outcome: input.outcome, goalAchieved, difficulty: input.difficulty, minutesSaved: input.minutesSaved, issueCodes: uniqueIssues, durationSeconds }, completedAt)
    })
    return this.requireTask(id)
  }

  withdraw(): { deleted: true; withdrawnAt: string } {
    const enrollment = this.requireEnrollment(); const withdrawnAt = nowIso()
    this.database.transaction(() => { this.database.db.prepare('DELETE FROM research_enrollments WHERE id=?').run(enrollment.id) })
    return { deleted: true, withdrawnAt }
  }

  exportBundle(): ResearchBundle {
    const enrollment = this.requireEnrollment(); const tasks = this.listTasks(enrollment.id); const events = this.listEvents(enrollment.id)
    const manifest: ResearchBundle['manifest'] = {
      formatVersion: 1,
      exportedAt: nowIso(),
      participantCode: enrollment.participantCode,
      consent: { version: RESEARCH_CONSENT_VERSION, textHash: enrollment.consentTextHash, receiptHash: enrollment.consentReceiptHash, consentedAt: enrollment.consentedAt },
      privacy: { containsManuscriptText: false, containsProjectTitlesOrIds: false, containsPromptsOrSecrets: false, localUntilExplicitExport: true },
      tasks,
      events,
      progress: progress(tasks),
    }
    return { format: 'bbd-research-v1', manifest, manifestHash: sha256(stableStringify(manifest)) }
  }

  verifyBundle(input: unknown): ResearchBundleInspection {
    return parseResearchBundle(input).inspection
  }

  private getEnrollment(): ResearchEnrollment | null {
    const row = this.database.db.prepare('SELECT * FROM research_enrollments ORDER BY created_at DESC LIMIT 1').get() as Row | undefined
    return row ? mapEnrollment(row) : null
  }

  private requireEnrollment(): ResearchEnrollment {
    const enrollment = this.getEnrollment(); if (!enrollment) throw new Error('Research consent is required')
    return enrollment
  }

  private listTasks(enrollmentId: string): ResearchTask[] {
    return (this.database.db.prepare('SELECT * FROM research_tasks WHERE enrollment_id=? ORDER BY started_at DESC,rowid DESC').all(enrollmentId) as Row[]).map(mapTask)
  }

  private requireTask(id: string): ResearchTask {
    const row = this.database.db.prepare('SELECT * FROM research_tasks WHERE id=?').get(id) as Row | undefined
    if (!row) throw new Error('Research task not found')
    return mapTask(row)
  }

  private listEvents(enrollmentId: string): ResearchBundleEvent[] {
    return (this.database.db.prepare('SELECT * FROM research_events WHERE enrollment_id=? ORDER BY sequence').all(enrollmentId) as Row[]).map((row) => ({
      sequence: Number(row.sequence), eventType: String(row.event_type) as ResearchBundleEvent['eventType'], payload: jsonParse(String(row.payload_json), {}), previousHash: row.previous_hash ? String(row.previous_hash) : null, eventHash: String(row.event_hash), occurredAt: String(row.occurred_at),
    }))
  }

  private appendEvent(enrollmentId: string, eventType: ResearchBundleEvent['eventType'], payload: Record<string, unknown>, occurredAt: string) {
    const last = this.database.db.prepare('SELECT sequence,event_hash FROM research_events WHERE enrollment_id=? ORDER BY sequence DESC LIMIT 1').get(enrollmentId) as Row | undefined
    const event: ResearchBundleEvent = { sequence: last ? Number(last.sequence) + 1 : 1, eventType, payload, previousHash: last ? String(last.event_hash) : null, eventHash: '', occurredAt }
    event.eventHash = hashEvent(event)
    this.database.db.prepare('INSERT INTO research_events(id,enrollment_id,sequence,event_type,payload_json,previous_hash,event_hash,occurred_at) VALUES(?,?,?,?,?,?,?,?)').run(newId(), enrollmentId, event.sequence, eventType, JSON.stringify(payload), event.previousHash, event.eventHash, occurredAt)
  }
}

export function buildSupportBundle(database: AppDatabase, config: AppConfig): SupportBundle {
  const snapshots = listDatabaseSnapshots(config.dataDir)
  const count = (sql: string) => Number((database.db.prepare(sql).get() as Row).count)
  const manifest: SupportBundle['manifest'] = {
    formatVersion: 1,
    generatedAt: nowIso(),
    appVersion: APP_VERSION,
    runtime: { platform: process.platform, arch: process.arch, nodeMajor: Number(process.versions.node.split('.')[0]), packaged: config.production },
    database: { schemaVersion: Number((database.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as Row).version), integrity: database.integrityCheck(), byteSize: fs.existsSync(database.databasePath) ? fs.statSync(database.databasePath).size : 0, snapshotCount: snapshots.length, validSnapshotCount: snapshots.filter((item) => item.integrity === 'ok').length },
    counts: {
      projects: count('SELECT COUNT(*) AS count FROM projects WHERE deleted_at IS NULL'),
      scenes: count("SELECT COUNT(*) AS count FROM manuscript_nodes WHERE type='scene' AND deleted_at IS NULL"),
      revisions: count('SELECT COUNT(*) AS count FROM revisions'),
      pendingCanonCandidates: count("SELECT COUNT(*) AS count FROM candidate_changes WHERE status='pending'"),
      unresolvedSyncConflicts: count("SELECT COUNT(*) AS count FROM sync_conflicts WHERE status='pending'"),
      activeSprints: count("SELECT COUNT(*) AS count FROM sprint_sessions WHERE status IN ('running','paused')"),
      researchTasks: count('SELECT COUNT(*) AS count FROM research_tasks'),
      cohortParticipants: count('SELECT COUNT(*) AS count FROM research_cohort_participants'),
      researchWaves: count('SELECT COUNT(*) AS count FROM research_waves'),
    },
    privacy: { containsManuscriptText: false, containsTitlesOrIds: false, containsPaths: false, containsPromptsOrSecrets: false },
  }
  return { format: 'bbd-support-v1', manifest, manifestHash: sha256(stableStringify(manifest)) }
}

export function buildReleaseReadiness(database: AppDatabase, config: AppConfig): ReleaseReadiness {
  const schemaVersion = Number((database.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as Row).version)
  return {
    appVersion: APP_VERSION,
    publicRelease: 'NO-GO',
    engineering: [
      { gate: '数据库完整性', status: database.integrityCheck() === 'ok' ? 'pass' : 'not_run', evidence: database.integrityCheck() },
      { gate: 'R1 数据迁移', status: schemaVersion === 16 ? 'pass' : 'not_run', evidence: `schema v${schemaVersion}` },
      { gate: '回环地址隔离', status: ['127.0.0.1', 'localhost', '::1'].includes(config.host) ? 'pass' : 'not_run', evidence: config.host },
      { gate: '生产静态资源', status: config.production && fs.existsSync(config.staticDir) ? 'pass' : 'not_run', evidence: config.production ? '已检查生产资源目录' : '开发模式不计入发布证据' },
    ],
    external: [
      { gate: '真实作者验证', status: 'required', evidence: '至少 5 名完成两周、3 名完成四周；本机测试不计入' },
      { gate: 'macOS Developer ID 与公证', status: 'required', evidence: '需要组织证书、Apple 账号与公证回执' },
      { gate: 'Windows x64 签名矩阵', status: 'required', evidence: '需要 Windows 真机、代码签名证书与中文输入法矩阵' },
      { gate: '移动真机与弱网矩阵', status: 'required', evidence: '需要 iOS/Android 真机、HTTPS 入口与更新/恢复演练' },
    ],
  }
}

export function parseResearchBundle(input: unknown): { bundle: ResearchBundle; inspection: ResearchBundleInspection } {
  const bundle = researchBundleSchema.parse(input) as ResearchBundle
  assertNoForbiddenFields(bundle.manifest)
  const manifestHashValid = sha256(stableStringify(bundle.manifest)) === bundle.manifestHash
  let previousHash: string | null = null; let eventChainValid = true
  for (const [index, event] of bundle.manifest.events.entries()) {
    if (event.sequence !== index + 1 || event.previousHash !== previousHash || event.eventHash !== hashEvent(event)) { eventChainValid = false; break }
    previousHash = event.eventHash
  }
  const semanticValid = validateBundleSemantics(bundle)
  const ok = manifestHashValid && eventChainValid && semanticValid
  return {
    bundle,
    inspection: { ok, manifestHashValid, eventChainValid, semanticValid, participantCode: bundle.manifest.participantCode, completedTasks: bundle.manifest.progress.completedTasks, message: ok ? '研究包完整，仍需研究负责人核对真实参与资格与周期' : '研究包校验失败' },
  }
}

function mapEnrollment(row: Row): ResearchEnrollment {
  return { id: String(row.id), participantCode: String(row.participant_code), consentVersion: RESEARCH_CONSENT_VERSION, consentTextHash: String(row.consent_text_hash), consentReceiptHash: String(row.consent_receipt_hash), consentedAt: String(row.consented_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
}

function mapTask(row: Row): ResearchTask {
  return {
    id: String(row.id), taskType: String(row.task_type) as ResearchTaskType, projectScopeHash: String(row.project_scope_hash), status: String(row.status) as ResearchTask['status'], startedAt: String(row.started_at), completedAt: row.completed_at ? String(row.completed_at) : null,
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds), goalAchieved: row.goal_achieved == null ? null : Boolean(row.goal_achieved), difficulty: row.difficulty == null ? null : Number(row.difficulty), minutesSaved: row.minutes_saved == null ? null : Number(row.minutes_saved), issueCodes: jsonParse(String(row.issue_codes_json), []) as ResearchIssueCode[],
  }
}

function progress(tasks: ResearchTask[]): ResearchProgress {
  const resolved = tasks.filter((task) => task.status !== 'active')
  const weeks = new Set(resolved.map((task) => task.completedAt ? weekBucket(task.completedAt) : null).filter(Boolean))
  return {
    completedTasks: resolved.length,
    completedCoreLoops: resolved.filter((task) => task.taskType === 'canon_loop' && task.status === 'completed' && task.goalAchieved).length,
    observedWeekBuckets: weeks.size,
    reportedMinutesSaved: resolved.reduce((sum, task) => sum + (task.minutesSaved ?? 0), 0),
    dataLossReports: resolved.filter((task) => task.issueCodes.includes('data_loss')).length,
    lastActivityAt: tasks.map((task) => task.completedAt ?? task.startedAt).sort().at(-1) ?? null,
  }
}

function validateBundleSemantics(bundle: ResearchBundle): boolean {
  const { consent, events, participantCode, progress: declaredProgress, tasks } = bundle.manifest
  if (consent.textHash !== RESEARCH_CONSENT_HASH || events.length < 1 || new Set(tasks.map((task) => task.id)).size !== tasks.length) return false
  const consentEvents = events.filter((event) => event.eventType === 'consented')
  if (consentEvents.length !== 1) return false
  const consentEvent = consentEvents[0]
  if (consentEvent.sequence !== 1 || consentEvent.occurredAt !== consent.consentedAt || consentEvent.payload.participantCode !== participantCode || consentEvent.payload.consentReceiptHash !== consent.receiptHash) return false
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const started = new Map<string, ResearchBundleEvent[]>(); const completed = new Map<string, ResearchBundleEvent[]>()
  for (const event of events) {
    if (event.eventType === 'consented') continue
    const taskId = typeof event.payload.taskId === 'string' ? event.payload.taskId : ''
    const target = event.eventType === 'task_started' ? started : completed
    target.set(taskId, [...(target.get(taskId) ?? []), event])
    if (!taskById.has(taskId)) return false
  }
  for (const task of tasks) {
    const start = started.get(task.id) ?? []; const finish = completed.get(task.id) ?? []
    if (start.length !== 1 || start[0].occurredAt !== task.startedAt || start[0].payload.taskType !== task.taskType || start[0].payload.projectScopeHash !== task.projectScopeHash) return false
    if (new Set(task.issueCodes).size !== task.issueCodes.length) return false
    if (task.status === 'active') {
      if (finish.length || task.completedAt !== null || task.durationSeconds !== null || task.goalAchieved !== null || task.difficulty !== null || task.minutesSaved !== null || task.issueCodes.length) return false
      continue
    }
    const event = finish[0]
    if (finish.length !== 1 || !event || event.occurredAt !== task.completedAt || event.payload.outcome !== task.status || event.payload.goalAchieved !== task.goalAchieved || event.payload.difficulty !== task.difficulty || event.payload.minutesSaved !== task.minutesSaved || event.payload.durationSeconds !== task.durationSeconds || stableStringify(event.payload.issueCodes) !== stableStringify(task.issueCodes)) return false
    if (task.completedAt === null || task.durationSeconds === null || task.goalAchieved === null || task.difficulty === null || task.minutesSaved === null) return false
    if (task.status === 'abandoned' && task.goalAchieved) return false
  }
  return stableStringify(progress(tasks)) === stableStringify(declaredProgress)
}

function weekBucket(value: string): string {
  const date = new Date(value); const day = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - day)
  return date.toISOString().slice(0, 10)
}

function hashEvent(event: ResearchBundleEvent): string {
  return sha256(stableStringify({ sequence: event.sequence, eventType: event.eventType, payload: event.payload, previousHash: event.previousHash, occurredAt: event.occurredAt }))
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  return JSON.stringify(value)
}

function assertNoForbiddenFields(value: unknown, path = '') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoForbiddenFields(item, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (['projectId', 'projectTitle', 'manuscriptText', 'content', 'prompt', 'apiKey', 'filePath', 'devicePath'].includes(key)) throw new Error(`Research package contains forbidden field: ${key}`)
    assertNoForbiddenFields(item, path ? `${path}.${key}` : key)
  }
}
