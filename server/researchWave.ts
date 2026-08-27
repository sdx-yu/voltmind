import { randomBytes } from 'node:crypto'
import type {
  CohortEvidenceClass,
  CohortSegment,
  ResearchWaveIncident,
  ResearchWaveIncidentCode,
  ResearchWaveIncidentSeverity,
  ResearchWaveKit,
  ResearchWaveKind,
  ResearchWaveReadiness,
  ResearchWaveStatus,
  ResearchWaveStatusResponse,
  ResearchWaveSummary,
} from '../shared/types.js'
import { AppDatabase } from './db.js'
import { APP_VERSION } from './research.js'
import { jsonParse, newId, nowIso, sha256 } from './utils.js'

type Row = Record<string, unknown>
const DAY_MS = 86_400_000
const segments: CohortSegment[] = ['web_serial', 'revision_novel', 'ai_assisted', 'other_target']
const incidentCodes: ResearchWaveIncidentCode[] = ['onboarding_blocked', 'support_request', 'recovery_failed', 'data_loss', 'privacy_request', 'protocol_deviation']
export const WAVE_PROTOCOL_HASH = sha256('r1c-wave-v1|14-42-days|external-5-10|four-readiness-gates|bounded-incidents|no-pii|r1-no-go')

export class ResearchWaveService {
  constructor(private readonly database: AppDatabase) {}

  getStatus(at = nowIso()): ResearchWaveStatusResponse {
    const waves = (this.database.db.prepare('SELECT * FROM research_waves ORDER BY created_at DESC,id DESC').all() as Row[]).map((row) => this.mapWave(row, at))
    const external = waves.filter((wave) => wave.kind === 'external_controlled')
    const participantCount = external.reduce((sum, wave) => sum + wave.participantCount, 0)
    const running = external.some((wave) => ['recruiting', 'active', 'paused'].includes(wave.status))
    const review = external.some((wave) => ['review', 'closed'].includes(wave.status))
    return {
      protocolVersion: 'r1c-wave-v1', appVersion: APP_VERSION, waves,
      externalExecution: { waveCount: external.length, activeWaveCount: external.filter((wave) => ['recruiting', 'active', 'paused'].includes(wave.status)).length, participantCount, twoWeekQualified: external.reduce((sum, wave) => sum + wave.twoWeekQualified, 0), status: review ? 'review_required' : running || participantCount ? 'running' : 'not_started' },
      privacy: { storesNamesOrContacts: false, sendsInvitations: false, rehearsalsCountAsExternal: false, automaticR1Go: false },
    }
  }

  createWave(input: { kind: ResearchWaveKind; windowStart: string; windowEnd: string; targetParticipants: number; quotas: Record<CohortSegment, number>; readiness: ResearchWaveReadiness }, at = nowIso()): ResearchWaveSummary {
    validateWaveInput(input)
    const id = newId(); const displayCode = `WAVE-${at.slice(0, 10).replaceAll('-', '')}-${randomBytes(2).toString('hex').toUpperCase()}`
    this.database.transaction(() => {
      this.database.db.prepare(`INSERT INTO research_waves(id,display_code,kind,status,window_start,window_end,target_participants,quotas_json,readiness_json,protocol_hash,created_at,updated_at)
        VALUES(?,?,?,'draft',?,?,?,?,?,?,?,?)`).run(id, displayCode, input.kind, input.windowStart, input.windowEnd, input.targetParticipants, JSON.stringify(input.quotas), JSON.stringify(input.readiness), WAVE_PROTOCOL_HASH, at, at)
      this.appendEvent(id, 'created', { kind: input.kind, windowStart: input.windowStart, windowEnd: input.windowEnd, targetParticipants: input.targetParticipants, quotas: input.quotas, readiness: input.readiness, protocolHash: WAVE_PROTOCOL_HASH }, at)
    })
    return this.requireWave(id, at)
  }

  transition(id: string, next: ResearchWaveStatus, at = nowIso()): ResearchWaveSummary {
    const wave = this.requireWave(id, at); const allowed: Record<ResearchWaveStatus, ResearchWaveStatus[]> = {
      draft: ['recruiting', 'cancelled'], recruiting: ['active', 'cancelled'], active: ['paused', 'review', 'cancelled'], paused: ['active', 'review', 'cancelled'], review: ['closed', 'cancelled'], closed: [], cancelled: [],
    }
    if (!allowed[wave.status].includes(next)) throw new Error('Invalid research wave transition')
    if (next === 'recruiting' && !allReady(wave.readiness)) throw new Error('All research wave readiness confirmations are required')
    if (wave.kind === 'external_controlled' && next === 'active' && (Date.parse(at) < Date.parse(wave.windowStart) || Date.parse(at) > Date.parse(wave.windowEnd))) throw new Error('External wave can only activate inside its frozen wave window')
    if (wave.kind === 'external_controlled' && ['review', 'closed'].includes(next) && Date.parse(at) < Date.parse(wave.windowEnd)) throw new Error('External wave cannot review or close before its frozen wave window ends')
    if (next === 'closed' && wave.openCriticalIncidents > 0) throw new Error('Critical research wave incidents must be resolved before closing')
    this.database.transaction(() => {
      this.database.db.prepare('UPDATE research_waves SET status=?,updated_at=? WHERE id=?').run(next, at, id)
      this.appendEvent(id, 'status_changed', { from: wave.status, to: next }, at)
    })
    return this.requireWave(id, at)
  }

  reportIncident(id: string, code: ResearchWaveIncidentCode, severity: ResearchWaveIncidentSeverity, at = nowIso()): ResearchWaveSummary {
    const wave = this.requireWave(id, at)
    if (['closed', 'cancelled'].includes(wave.status)) throw new Error('Closed research wave cannot accept incidents')
    if (!incidentCodes.includes(code) || !['low', 'medium', 'high', 'critical'].includes(severity)) throw new Error('Invalid research wave incident')
    const incidentId = newId()
    this.database.transaction(() => {
      this.database.db.prepare('INSERT INTO research_wave_incidents(id,wave_id,code,severity,opened_at) VALUES(?,?,?,?,?)').run(incidentId, id, code, severity, at)
      this.appendEvent(id, 'incident_opened', { incidentId, code, severity }, at)
    })
    return this.requireWave(id, at)
  }

  resolveIncident(id: string, incidentId: string, at = nowIso()): ResearchWaveSummary {
    this.requireWave(id, at)
    const incident = this.database.db.prepare('SELECT * FROM research_wave_incidents WHERE id=? AND wave_id=?').get(incidentId, id) as Row | undefined
    if (!incident) throw new Error('Research wave incident not found')
    if (incident.resolved_at) throw new Error('Research wave incident already resolved')
    this.database.transaction(() => {
      this.database.db.prepare('UPDATE research_wave_incidents SET resolved_at=? WHERE id=?').run(at, incidentId)
      this.appendEvent(id, 'incident_resolved', { incidentId, code: String(incident.code), severity: String(incident.severity) }, at)
    })
    return this.requireWave(id, at)
  }

  exportKit(id: string): ResearchWaveKit {
    const wave = this.requireWave(id)
    const manifest: ResearchWaveKit['manifest'] = {
      formatVersion: 1, protocolVersion: 'r1c-wave-v1', exportedAt: nowIso(), appVersion: APP_VERSION,
      wave: { displayCode: wave.displayCode, kind: wave.kind, windowStart: wave.windowStart, windowEnd: wave.windowEnd, targetParticipants: wave.targetParticipants, quotas: wave.quotas, protocolHash: wave.protocolHash },
      participantChecklist: ['阅读并确认 r1-consent-v1', '只使用自己拥有权利或获授权的长篇项目', '按真实任务记录，不编辑研究包', '通过约定安全渠道主动交付研究包', '需要退出或删除时联系研究负责人'],
      coordinatorBoundary: ['名册、联系方式与原始包保存在产品外的受控位置', '工程夹具不得标记为真实外部证据', '不在冻结窗口外补录真实参与', '到期和退出请求同时处理产品内摘要与产品外副本', '数值达到仍需人工复核，R1 保持 NO-GO'],
      privacy: { containsNamesOrContacts: false, containsParticipantCodes: false, containsManuscriptText: false, containsTitlesOrIds: false, containsPromptsOrSecrets: false },
    }
    return { format: 'bbd-wave-kit-v1', manifest, manifestHash: sha256(stableStringify(manifest)) }
  }

  validateAssignment(waveId: string, evidenceClass: CohortEvidenceClass, segment: CohortSegment, consentedAt: string): ResearchWaveSummary {
    const wave = this.requireWave(waveId)
    if (wave.kind === 'external_controlled' && evidenceClass !== 'external_attested') throw new Error('External wave accepts only attested external evidence')
    if (wave.kind === 'engineering_rehearsal' && evidenceClass !== 'engineering_fixture') throw new Error('Engineering rehearsal accepts only fixtures')
    if (!['recruiting', 'active', 'paused', 'review'].includes(wave.status)) throw new Error('Research wave is not accepting packages')
    if (wave.kind === 'external_controlled' && (Date.parse(consentedAt) < Date.parse(wave.windowStart) || Date.parse(consentedAt) > Date.parse(wave.windowEnd))) throw new Error('Research consent is outside the frozen wave window')
    const assigned = Number((this.database.db.prepare('SELECT COUNT(*) AS count FROM research_cohort_participants WHERE wave_id=?').get(waveId) as Row).count)
    const assignedInSegment = Number((this.database.db.prepare('SELECT COUNT(*) AS count FROM research_cohort_participants WHERE wave_id=? AND segment=?').get(waveId, segment) as Row).count)
    if (assigned >= wave.targetParticipants) throw new Error('Research wave target is already full')
    if (assignedInSegment >= wave.quotas[segment]) throw new Error('Research wave segment quota is already full')
    return wave
  }

  recordParticipantLinked(waveId: string, participantCodeHash: string, at = nowIso()) {
    this.appendEvent(waveId, 'participant_linked', { linkCommitment: sha256(`r1c-wave-link-v1|${waveId}|${participantCodeHash}`) }, at)
  }

  private requireWave(id: string, at = nowIso()): ResearchWaveSummary {
    const row = this.database.db.prepare('SELECT * FROM research_waves WHERE id=?').get(id) as Row | undefined
    if (!row) throw new Error('Research wave not found')
    return this.mapWave(row, at)
  }

  private mapWave(row: Row, at: string): ResearchWaveSummary {
    const incidents = (this.database.db.prepare('SELECT * FROM research_wave_incidents WHERE wave_id=? ORDER BY opened_at,id').all(String(row.id)) as Row[]).map(mapIncident)
    const participantRows = this.database.db.prepare(`SELECT p.evidence_class,p.retention_until,s.observed_week_buckets,s.active_span_days,s.completed_core_loops
      FROM research_cohort_participants p JOIN research_cohort_submissions s ON s.id=(SELECT id FROM research_cohort_submissions WHERE participant_id=p.id ORDER BY event_count DESC,received_at DESC LIMIT 1)
      WHERE p.wave_id=?`).all(String(row.id)) as Row[]
    const kind = String(row.kind) as ResearchWaveKind
    const eligible = participantRows.filter((participant) => Date.parse(String(participant.retention_until)) > Date.parse(at) && (kind === 'external_controlled' ? String(participant.evidence_class) === 'external_attested' : String(participant.evidence_class) === 'engineering_fixture'))
    return {
      id: String(row.id), displayCode: String(row.display_code), kind, status: String(row.status) as ResearchWaveStatus, windowStart: String(row.window_start), windowEnd: String(row.window_end), targetParticipants: Number(row.target_participants), quotas: jsonParse(String(row.quotas_json), emptyQuotas()) as Record<CohortSegment, number>, readiness: jsonParse(String(row.readiness_json), emptyReadiness()) as ResearchWaveReadiness, protocolHash: String(row.protocol_hash), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      participantCount: eligible.length, twoWeekQualified: eligible.filter((participant) => Number(participant.observed_week_buckets) >= 2 && Number(participant.active_span_days) >= 8).length, coreLoopQualified: eligible.filter((participant) => Number(participant.observed_week_buckets) >= 2 && Number(participant.active_span_days) >= 8 && Number(participant.completed_core_loops) >= 2).length,
      openIncidents: incidents.filter((incident) => !incident.resolvedAt).length, openCriticalIncidents: incidents.filter((incident) => !incident.resolvedAt && incident.severity === 'critical').length, incidents, evidenceClass: kind === 'external_controlled' ? 'external_evidence' : 'engineering_only', r1Decision: 'NO-GO',
    }
  }

  private appendEvent(waveId: string, eventType: string, payload: Record<string, unknown>, occurredAt: string) {
    const last = this.database.db.prepare('SELECT sequence,event_hash FROM research_wave_events WHERE wave_id=? ORDER BY sequence DESC LIMIT 1').get(waveId) as Row | undefined
    const sequence = last ? Number(last.sequence) + 1 : 1; const previousHash = last ? String(last.event_hash) : null
    const eventHash = sha256(stableStringify({ sequence, eventType, payload, previousHash, occurredAt }))
    this.database.db.prepare('INSERT INTO research_wave_events(id,wave_id,sequence,event_type,payload_json,previous_hash,event_hash,occurred_at) VALUES(?,?,?,?,?,?,?,?)').run(newId(), waveId, sequence, eventType, JSON.stringify(payload), previousHash, eventHash, occurredAt)
  }
}

function validateWaveInput(input: { kind: ResearchWaveKind; windowStart: string; windowEnd: string; targetParticipants: number; quotas: Record<CohortSegment, number>; readiness: ResearchWaveReadiness }) {
  if (!['external_controlled', 'engineering_rehearsal'].includes(input.kind)) throw new Error('Invalid research wave kind')
  const start = Date.parse(input.windowStart); const end = Date.parse(input.windowEnd); const days = (end - start) / DAY_MS
  if (!Number.isFinite(start) || !Number.isFinite(end) || days < 14 || days > 42) throw new Error('Research wave window must be 14–42 days')
  const min = input.kind === 'external_controlled' ? 5 : 1
  if (!Number.isInteger(input.targetParticipants) || input.targetParticipants < min || input.targetParticipants > 10) throw new Error('Invalid research wave target')
  if (segments.some((segment) => !Number.isInteger(input.quotas[segment]) || input.quotas[segment] < 0) || segments.reduce((sum, segment) => sum + input.quotas[segment], 0) !== input.targetParticipants) throw new Error('Research wave quotas must exactly match the target')
  if (!input.readiness || Object.keys(input.readiness).length !== 4 || Object.values(input.readiness).some((value) => typeof value !== 'boolean')) throw new Error('Invalid research wave readiness')
  if (!allReady(input.readiness)) throw new Error('All research wave readiness confirmations are required')
}
function allReady(readiness: ResearchWaveReadiness) { return readiness.protocolReviewed && readiness.controlledRosterReady && readiness.deletionContactReady && readiness.supportRouteRehearsed }
function emptyQuotas(): Record<CohortSegment, number> { return { web_serial: 0, revision_novel: 0, ai_assisted: 0, other_target: 0 } }
function emptyReadiness(): ResearchWaveReadiness { return { protocolReviewed: false, controlledRosterReady: false, deletionContactReady: false, supportRouteRehearsed: false } }
function mapIncident(row: Row): ResearchWaveIncident { return { id: String(row.id), code: String(row.code) as ResearchWaveIncidentCode, severity: String(row.severity) as ResearchWaveIncidentSeverity, openedAt: String(row.opened_at), resolvedAt: row.resolved_at ? String(row.resolved_at) : null } }
function stableStringify(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`; return JSON.stringify(value) }
