import type {
  CohortAggregate,
  CohortAttestation,
  CohortBundle,
  CohortEvidenceClass,
  CohortImportResult,
  CohortParticipantSummary,
  CohortSegment,
  ResearchBundle,
  ResearchCohortStatus,
} from '../shared/types.js'
import { AppDatabase } from './db.js'
import { APP_VERSION, parseResearchBundle } from './research.js'
import { jsonParse, newId, nowIso, sha256 } from './utils.js'

type Row = Record<string, unknown>

const DAY_MS = 86_400_000
const segments: CohortSegment[] = ['web_serial', 'revision_novel', 'ai_assisted', 'other_target']

export class ResearchCohortService {
  constructor(private readonly database: AppDatabase) {}

  getStatus(at = nowIso()): ResearchCohortStatus {
    const participants = (this.database.db.prepare('SELECT * FROM research_cohort_participants ORDER BY first_received_at,id').all() as Row[]).map((row) => this.mapParticipant(row, at))
    return {
      protocolVersion: 'r1b-cohort-v1',
      appVersion: APP_VERSION,
      participants,
      aggregate: aggregate(participants),
      deletionReceipts: Number((this.database.db.prepare('SELECT COUNT(*) AS count FROM research_cohort_deletion_receipts').get() as Row).count),
      privacy: { storesRawResearchPackages: false, storesParticipantCodes: false, containsManuscriptText: false, fixturesCountTowardGates: false, automaticR1Go: false },
    }
  }

  importBundle(input: {
    researchPackage: unknown
    evidenceClass: CohortEvidenceClass
    segment: CohortSegment
    attestation: CohortAttestation
    retentionUntil: string
  }): CohortImportResult {
    const parsed = parseResearchBundle(input.researchPackage)
    if (!parsed.inspection.ok) throw new Error('Research package failed integrity or semantic verification')
    const { bundle } = parsed; const participantCodeHash = participantHash(bundle.manifest.participantCode); const receivedAt = nowIso()
    if (this.hasDeletionReceipt(participantCodeHash)) throw new Error('Research participant was deleted and cannot be re-imported')
    const existing = this.database.db.prepare('SELECT * FROM research_cohort_participants WHERE participant_code_hash=?').get(participantCodeHash) as Row | undefined
    if (existing) return this.updateExisting(existing, bundle, receivedAt)
    validateNewParticipantInput(input, receivedAt)
    const id = newId(); const summary = summarize(bundle)
    this.database.transaction(() => {
      this.database.db.prepare(`INSERT INTO research_cohort_participants(id,participant_code_hash,consent_receipt_hash,evidence_class,segment,attestation_json,retention_until,first_received_at,latest_received_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(id, participantCodeHash, bundle.manifest.consent.receiptHash, input.evidenceClass, input.segment, JSON.stringify(input.attestation), input.retentionUntil, receivedAt, receivedAt)
      this.insertSubmission(id, bundle, summary, receivedAt)
    })
    const status = this.getStatus(receivedAt); const participant = status.participants.find((item) => item.participantCodeHash === participantCodeHash)!
    return { disposition: 'imported', participant, aggregate: status.aggregate }
  }

  deleteParticipant(participantCodeHash: string, reason: 'participant_request' | 'retention_expired' = 'participant_request') {
    if (!/^[a-f0-9]{64}$/.test(participantCodeHash)) throw new Error('Invalid cohort participant hash')
    const row = this.database.db.prepare('SELECT id FROM research_cohort_participants WHERE participant_code_hash=?').get(participantCodeHash) as Row | undefined
    if (!row) throw new Error('Cohort participant not found')
    const count = Number((this.database.db.prepare('SELECT COUNT(*) AS count FROM research_cohort_submissions WHERE participant_id=?').get(String(row.id)) as Row).count); const removedAt = nowIso()
    this.database.transaction(() => {
      this.database.db.prepare('DELETE FROM research_cohort_participants WHERE id=?').run(String(row.id))
      this.database.db.prepare('INSERT INTO research_cohort_deletion_receipts(id,tombstone_hash,reason,removed_submission_count,removed_at) VALUES(?,?,?,?,?)').run(newId(), deletionHash(participantCodeHash), reason, count, removedAt)
    })
    return { deleted: true as const, removedSubmissionCount: count, removedAt, reason }
  }

  purgeExpired(at = nowIso()) {
    const rows = this.database.db.prepare('SELECT participant_code_hash FROM research_cohort_participants WHERE retention_until<=? ORDER BY retention_until').all(at) as Row[]
    let removedSubmissions = 0
    for (const row of rows) removedSubmissions += this.deleteParticipant(String(row.participant_code_hash), 'retention_expired').removedSubmissionCount
    return { deletedParticipants: rows.length, removedSubmissions, purgedAt: at }
  }

  exportBundle(): CohortBundle {
    const status = this.getStatus()
    const manifest: CohortBundle['manifest'] = {
      formatVersion: 1,
      protocolVersion: 'r1b-cohort-v1',
      exportedAt: nowIso(),
      appVersion: APP_VERSION,
      thresholds: { twoWeekParticipants: 5, fourWeekParticipants: 3, coreLoopParticipants: 3, dataLossReports: 0 },
      aggregate: status.aggregate,
      participants: status.participants.map(({ retentionUntil: _retentionUntil, firstReceivedAt: _firstReceivedAt, latestReceivedAt: _latestReceivedAt, ...participant }) => participant),
      privacy: { containsParticipantCodes: false, containsManuscriptText: false, containsTitlesOrIds: false, containsPromptsOrSecrets: false, containsRawPackages: false },
    }
    return { format: 'bbd-cohort-v1', manifest, manifestHash: sha256(stableStringify(manifest)) }
  }

  private updateExisting(row: Row, bundle: ResearchBundle, receivedAt: string): CohortImportResult {
    if (String(row.consent_receipt_hash) !== bundle.manifest.consent.receiptHash) throw new Error('Research consent receipt changed for an existing participant')
    const participantId = String(row.id)
    if (this.database.db.prepare('SELECT 1 FROM research_cohort_submissions WHERE manifest_hash=?').get(bundle.manifestHash)) return this.resultFor(String(row.participant_code_hash), 'unchanged', receivedAt)
    const latest = this.database.db.prepare('SELECT * FROM research_cohort_submissions WHERE participant_id=? ORDER BY event_count DESC,received_at DESC LIMIT 1').get(participantId) as Row
    const previousHashes = jsonParse(String(latest.event_hashes_json), []) as string[]; const nextHashes = bundle.manifest.events.map((event) => event.eventHash)
    if (nextHashes.length === previousHashes.length && nextHashes.every((hash, index) => hash === previousHashes[index])) return this.resultFor(String(row.participant_code_hash), 'unchanged', receivedAt)
    if (nextHashes.length <= previousHashes.length || !previousHashes.every((hash, index) => nextHashes[index] === hash)) throw new Error('Research event chain is not a strict continuation')
    const summary = summarize(bundle)
    this.database.transaction(() => {
      this.insertSubmission(participantId, bundle, summary, receivedAt)
      this.database.db.prepare('UPDATE research_cohort_participants SET latest_received_at=? WHERE id=?').run(receivedAt, participantId)
    })
    return this.resultFor(String(row.participant_code_hash), 'updated', receivedAt)
  }

  private resultFor(participantCodeHash: string, disposition: CohortImportResult['disposition'], at: string): CohortImportResult {
    const status = this.getStatus(at); const participant = status.participants.find((item) => item.participantCodeHash === participantCodeHash)
    if (!participant) throw new Error('Cohort participant not found')
    return { disposition, participant, aggregate: status.aggregate }
  }

  private insertSubmission(participantId: string, bundle: ResearchBundle, summary: SubmissionSummary, receivedAt: string) {
    const hashes = bundle.manifest.events.map((event) => event.eventHash); const head = hashes.at(-1)
    if (!head) throw new Error('Research package has no consent event')
    this.database.db.prepare(`INSERT INTO research_cohort_submissions(id,participant_id,manifest_hash,event_head_hash,event_hashes_json,event_count,exported_at,received_at,observed_week_buckets,active_span_days,completed_tasks,completed_core_loops,reported_minutes_saved,data_loss_reports,false_positive_reports,missed_fact_reports,completed_outcomes,abandoned_outcomes)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(newId(), participantId, bundle.manifestHash, head, JSON.stringify(hashes), hashes.length, bundle.manifest.exportedAt, receivedAt, summary.observedWeekBuckets, summary.activeSpanDays, summary.completedTasks, summary.completedCoreLoops, summary.reportedMinutesSaved, summary.dataLossReports, summary.falsePositiveReports, summary.missedFactReports, summary.completedOutcomes, summary.abandonedOutcomes)
  }

  private mapParticipant(row: Row, at: string): CohortParticipantSummary {
    const latest = this.database.db.prepare('SELECT * FROM research_cohort_submissions WHERE participant_id=? ORDER BY event_count DESC,received_at DESC LIMIT 1').get(String(row.id)) as Row
    const submissionCount = Number((this.database.db.prepare('SELECT COUNT(*) AS count FROM research_cohort_submissions WHERE participant_id=?').get(String(row.id)) as Row).count)
    const observedWeekBuckets = Number(latest.observed_week_buckets); const activeSpanDays = Number(latest.active_span_days); const completedCoreLoops = Number(latest.completed_core_loops)
    return {
      participantCodeHash: String(row.participant_code_hash), evidenceClass: String(row.evidence_class) as CohortEvidenceClass, segment: String(row.segment) as CohortSegment, retentionUntil: String(row.retention_until), expired: Date.parse(String(row.retention_until)) <= Date.parse(at), firstReceivedAt: String(row.first_received_at), latestReceivedAt: String(row.latest_received_at), submissionCount,
      observedWeekBuckets, activeSpanDays, completedTasks: Number(latest.completed_tasks), completedCoreLoops, reportedMinutesSaved: Number(latest.reported_minutes_saved), dataLossReports: Number(latest.data_loss_reports), falsePositiveReports: Number(latest.false_positive_reports), missedFactReports: Number(latest.missed_fact_reports), completedOutcomes: Number(latest.completed_outcomes), abandonedOutcomes: Number(latest.abandoned_outcomes),
      twoWeekQualified: observedWeekBuckets >= 2 && activeSpanDays >= 8, fourWeekQualified: observedWeekBuckets >= 4 && activeSpanDays >= 22, coreLoopQualified: observedWeekBuckets >= 2 && activeSpanDays >= 8 && completedCoreLoops >= 2,
    }
  }

  private hasDeletionReceipt(participantCodeHash: string) {
    return Boolean(this.database.db.prepare('SELECT 1 FROM research_cohort_deletion_receipts WHERE tombstone_hash=?').get(deletionHash(participantCodeHash)))
  }
}

type SubmissionSummary = Pick<CohortParticipantSummary, 'observedWeekBuckets' | 'activeSpanDays' | 'completedTasks' | 'completedCoreLoops' | 'reportedMinutesSaved' | 'dataLossReports' | 'falsePositiveReports' | 'missedFactReports' | 'completedOutcomes' | 'abandonedOutcomes'>

function summarize(bundle: ResearchBundle): SubmissionSummary {
  const resolved = bundle.manifest.tasks.filter((task) => task.status !== 'active' && task.completedAt)
  const successful = resolved.filter((task) => task.status === 'completed')
  const weeks = new Set(successful.map((task) => weekBucket(task.completedAt!)))
  const latest = successful.map((task) => Date.parse(task.completedAt!)).sort((a, b) => b - a)[0]
  const activeSpanDays = latest == null ? 0 : Math.max(1, Math.floor((latest - Date.parse(bundle.manifest.consent.consentedAt)) / DAY_MS) + 1)
  return {
    observedWeekBuckets: weeks.size,
    activeSpanDays,
    completedTasks: resolved.length,
    completedCoreLoops: resolved.filter((task) => task.status === 'completed' && task.taskType === 'canon_loop' && task.goalAchieved).length,
    reportedMinutesSaved: resolved.reduce((sum, task) => sum + (task.minutesSaved ?? 0), 0),
    dataLossReports: resolved.filter((task) => task.issueCodes.includes('data_loss')).length,
    falsePositiveReports: resolved.filter((task) => task.issueCodes.includes('false_positive')).length,
    missedFactReports: resolved.filter((task) => task.issueCodes.includes('missed_fact')).length,
    completedOutcomes: resolved.filter((task) => task.status === 'completed').length,
    abandonedOutcomes: resolved.filter((task) => task.status === 'abandoned').length,
  }
}

function aggregate(participants: CohortParticipantSummary[]): CohortAggregate {
  const activeExternal = participants.filter((participant) => participant.evidenceClass === 'external_attested' && !participant.expired)
  const sum = (key: keyof Pick<CohortParticipantSummary, 'completedTasks' | 'completedCoreLoops' | 'reportedMinutesSaved' | 'dataLossReports' | 'falsePositiveReports' | 'missedFactReports' | 'completedOutcomes' | 'abandonedOutcomes'>) => activeExternal.reduce((total, participant) => total + Number(participant[key]), 0)
  const completedOutcomes = sum('completedOutcomes'); const abandonedOutcomes = sum('abandonedOutcomes'); const resolved = completedOutcomes + abandonedOutcomes
  const twoWeekQualified = activeExternal.filter((participant) => participant.twoWeekQualified).length; const fourWeekQualified = activeExternal.filter((participant) => participant.fourWeekQualified).length; const coreLoopQualified = activeExternal.filter((participant) => participant.coreLoopQualified).length; const dataLossReports = sum('dataLossReports')
  const segmentCounts = Object.fromEntries(segments.map((segment) => [segment, activeExternal.filter((participant) => participant.segment === segment).length])) as Record<CohortSegment, number>
  return {
    externalAttestedParticipants: activeExternal.length,
    engineeringFixtures: participants.filter((participant) => participant.evidenceClass === 'engineering_fixture').length,
    expiredParticipants: participants.filter((participant) => participant.expired).length,
    twoWeekQualified, fourWeekQualified, coreLoopQualified,
    completedTasks: sum('completedTasks'), completedCoreLoops: sum('completedCoreLoops'), reportedMinutesSaved: sum('reportedMinutesSaved'), dataLossReports, falsePositiveReports: sum('falsePositiveReports'), missedFactReports: sum('missedFactReports'), taskCompletionRate: resolved ? Number((completedOutcomes / resolved).toFixed(4)) : 0, segments: segmentCounts,
    gates: {
      twoWeek: { current: twoWeekQualified, required: 5, met: twoWeekQualified >= 5 },
      fourWeek: { current: fourWeekQualified, required: 3, met: fourWeekQualified >= 3 },
      coreLoop: { current: coreLoopQualified, required: 3, met: coreLoopQualified >= 3 },
      zeroDataLoss: { current: dataLossReports, required: 0, met: dataLossReports === 0 },
      pilotThresholdMet: twoWeekQualified >= 5 && fourWeekQualified >= 3 && coreLoopQualified >= 3 && dataLossReports === 0,
      humanReviewRequired: true,
      r1Decision: 'NO-GO',
    },
  }
}

function validateNewParticipantInput(input: { evidenceClass: CohortEvidenceClass; segment: CohortSegment; attestation: CohortAttestation; retentionUntil: string }, receivedAt: string) {
  if (!['external_attested', 'engineering_fixture'].includes(input.evidenceClass)) throw new Error('Invalid cohort evidence class')
  if (!segments.includes(input.segment)) throw new Error('Invalid cohort segment')
  const retention = Date.parse(input.retentionUntil); const received = Date.parse(receivedAt)
  if (!Number.isFinite(retention) || retention <= received || retention > received + 365 * DAY_MS) throw new Error('Cohort retention must be within 1–365 days')
  if (input.evidenceClass === 'external_attested' && !(input.attestation.targetAuthorConfirmed && input.attestation.independentParticipantConfirmed && input.attestation.manuscriptRightsConfirmed && input.attestation.realUseConfirmed)) throw new Error('All external cohort attestations are required')
}

function weekBucket(value: string): string {
  const date = new Date(value); const day = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - day)
  return date.toISOString().slice(0, 10)
}

function participantHash(code: string) { return sha256(`r1b-cohort-v1|${code}`) }
function deletionHash(participantCodeHash: string) { return sha256(`r1b-cohort-deleted-v1|${participantCodeHash}`) }
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  return JSON.stringify(value)
}
