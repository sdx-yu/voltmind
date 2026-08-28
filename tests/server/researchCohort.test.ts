// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CohortAttestation, ResearchBundle, ResearchBundleEvent, ResearchTask } from '../../shared/types.js'
import { createApp } from '../../server/app.js'
import { getConfig } from '../../server/config.js'
import { AppDatabase } from '../../server/db.js'
import { RESEARCH_CONSENT_HASH } from '../../server/research.js'
import { ResearchCohortService } from '../../server/researchCohort.js'
import { ResearchWaveService } from '../../server/researchWave.js'
import { sha256 } from '../../server/utils.js'

describe('R1-B controlled cohort evidence', () => {
  let dir = ''
  const databases: AppDatabase[] = []
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-cohort-')) })
  afterEach(() => { for (const database of databases.splice(0)) database.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  function database(name: string) { const result = new AppDatabase(path.join(dir, `${name}.sqlite`)); databases.push(result); return result }

  it('backs up schema v14 before creating the three coordinator tables', () => {
    let db = database('migration'); const databasePath = db.databasePath
    db.db.exec('DROP TABLE research_cohort_submissions; DROP TABLE research_cohort_participants; DROP TABLE research_cohort_deletion_receipts; DROP TABLE research_wave_events; DROP TABLE research_wave_incidents; DROP TABLE research_waves; DELETE FROM schema_migrations WHERE version IN (15,16);')
    db.close(); databases.splice(databases.indexOf(db), 1)
    db = new AppDatabase(databasePath); databases.push(db)
    expect(db.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toMatchObject({ version: 16 })
    expect(db.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name LIKE 'research_cohort_%'").get()).toMatchObject({ count: 3 })
    expect(fs.readdirSync(path.join(dir, 'backups')).some((name) => name.startsWith('pre-migration-v14-to-v16-'))).toBe(true)
  })

  it('never counts fixtures and requires all four attestations for an external sample', () => {
    const cohort = new ResearchCohortService(database('classification')); const bundle = buildBundle('R1-000000000001', twoWeeks)
    const fixture = cohort.importBundle({ researchPackage: bundle, evidenceClass: 'engineering_fixture', segment: 'web_serial', attestation: noAttestation, retentionUntil: futureDate() })
    expect(fixture.aggregate).toMatchObject({ engineeringFixtures: 1, externalAttestedParticipants: 0, twoWeekQualified: 0 })
    expect(() => cohort.importBundle({ researchPackage: buildBundle('R1-000000000002', twoWeeks), evidenceClass: 'external_attested', segment: 'revision_novel', attestation: { ...fullAttestation, realUseConfirmed: false }, retentionUntil: futureDate() })).toThrow(/attestations/i)
    expect(cohort.getStatus().participants).toHaveLength(1)
  })

  it('accepts only strict chain extensions and applies exact UTC week and span qualification', () => {
    const cohort = new ResearchCohortService(database('continuity')); const code = 'R1-000000000003'
    const first = cohort.importBundle({ researchPackage: buildBundle(code, [twoWeeks[0]]), evidenceClass: 'external_attested', segment: 'ai_assisted', attestation: fullAttestation, retentionUntil: futureDate() })
    expect(first.participant).toMatchObject({ twoWeekQualified: false, observedWeekBuckets: 1 })
    const secondBundle = buildBundle(code, twoWeeks)
    const updated = cohort.importBundle({ researchPackage: secondBundle, evidenceClass: 'engineering_fixture', segment: 'other_target', attestation: noAttestation, retentionUntil: futureDate() })
    expect(updated).toMatchObject({ disposition: 'updated', participant: { evidenceClass: 'external_attested', segment: 'ai_assisted', observedWeekBuckets: 2, activeSpanDays: 12, twoWeekQualified: true, coreLoopQualified: true } })
    expect(cohort.importBundle({ researchPackage: secondBundle, evidenceClass: 'engineering_fixture', segment: 'other_target', attestation: noAttestation, retentionUntil: futureDate() }).disposition).toBe('unchanged')
    expect(() => cohort.importBundle({ researchPackage: buildBundle(code, twoWeeks, { firstTaskType: 'fact_lookup' }), evidenceClass: 'engineering_fixture', segment: 'other_target', attestation: noAttestation, retentionUntil: futureDate() })).toThrow(/strict continuation/i)
    expect(() => cohort.importBundle({ researchPackage: buildBundle(code, fourWeeks, { receiptHash: sha256('changed consent') }), evidenceClass: 'engineering_fixture', segment: 'other_target', attestation: noAttestation, retentionUntil: futureDate() })).toThrow(/consent receipt changed/i)
  })

  it('computes the pilot threshold without changing the R1 decision or the original commercial gate', () => {
    const cohort = new ResearchCohortService(database('threshold'))
    for (let index = 0; index < 5; index += 1) {
      cohort.importBundle({ researchPackage: buildBundle(`R1-${String(index + 10).padStart(12, '0')}`, index < 3 ? fourWeeks : twoWeeks), evidenceClass: 'external_attested', segment: index % 2 ? 'revision_novel' : 'web_serial', attestation: fullAttestation, retentionUntil: futureDate() })
    }
    cohort.importBundle({ researchPackage: buildBundle('R1-000000000099', fourWeeks, { issueCodes: ['data_loss'] }), evidenceClass: 'engineering_fixture', segment: 'other_target', attestation: noAttestation, retentionUntil: futureDate() })
    const aggregate = cohort.getStatus().aggregate
    expect(aggregate).toMatchObject({ externalAttestedParticipants: 5, engineeringFixtures: 1, twoWeekQualified: 5, fourWeekQualified: 3, coreLoopQualified: 5, dataLossReports: 0 })
    expect(aggregate.gates).toMatchObject({ pilotThresholdMet: true, humanReviewRequired: true, r1Decision: 'NO-GO' })
  })

  it('cascades deletion, blocks accidental re-import and exports only bounded aggregates', () => {
    const cohort = new ResearchCohortService(database('privacy')); const code = 'R1-000000000020'; const bundle = buildBundle(code, fourWeeks)
    const imported = cohort.importBundle({ researchPackage: bundle, evidenceClass: 'external_attested', segment: 'web_serial', attestation: fullAttestation, retentionUntil: futureDate() })
    const exported = cohort.exportBundle(); const serialized = JSON.stringify(exported)
    expect(exported).toMatchObject({ format: 'bbd-cohort-v1', manifest: { privacy: { containsParticipantCodes: false, containsManuscriptText: false, containsRawPackages: false } } })
    expect(exported.manifestHash).toBe(sha256(stableStringify(exported.manifest)))
    expect(serialized).not.toContain(code)
    expect(serialized).not.toContain(bundle.manifest.tasks[0].id)
    expect(cohort.deleteParticipant(imported.participant.participantCodeHash)).toMatchObject({ deleted: true, removedSubmissionCount: 1 })
    expect(cohort.getStatus()).toMatchObject({ participants: [], deletionReceipts: 1 })
    expect(() => cohort.importBundle({ researchPackage: bundle, evidenceClass: 'engineering_fixture', segment: 'web_serial', attestation: noAttestation, retentionUntil: futureDate() })).toThrow(/deleted and cannot be re-imported/i)
  })

  it('protects coordinator routes and includes only its bounded count in support diagnostics', async () => {
    const result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'routes.sqlite'), production: false })); databases.push(result.database)
    const cookie = (await request(result.app).post('/api/session').expect(200)).headers['set-cookie'][0].split(';')[0]
    await request(result.app).get('/api/research-cohort/status').expect(401)
    const bundle = buildBundle('R1-000000000030', twoWeeks)
    await request(result.app).post('/api/research-cohort/import').set('Cookie', cookie).send({ package: bundle, evidenceClass: 'engineering_fixture', segment: 'web_serial', attestation: noAttestation, retentionUntil: futureDate() }).expect(201)
    const status = (await request(result.app).get('/api/research-cohort/status').set('Cookie', cookie).expect(200)).body
    expect(status).toMatchObject({ appVersion: '1.7.0', aggregate: { engineeringFixtures: 1, externalAttestedParticipants: 0 }, privacy: { storesRawResearchPackages: false, fixturesCountTowardGates: false } })
    const support = (await request(result.app).get('/api/support/bundle').set('Cookie', cookie).expect(200)).body
    expect(support.manifest.counts.cohortParticipants).toBe(1)
  })

  it('assigns only matching evidence to immutable waves and rolls back a failed late assignment', () => {
    const db = database('wave-assignment'); const cohort = new ResearchCohortService(db); const waves = new ResearchWaveService(db)
    const rehearsal = waves.createWave({ kind: 'engineering_rehearsal', windowStart: '2026-01-01T00:00:00.000Z', windowEnd: '2026-01-15T00:00:00.000Z', targetParticipants: 2, quotas: { web_serial: 2, revision_novel: 0, ai_assisted: 0, other_target: 0 }, readiness: waveReadiness }, '2026-01-01T00:00:00.000Z')
    waves.transition(rehearsal.id, 'recruiting', '2026-01-01T00:00:00.000Z')
    const assigned = cohort.importBundle({ researchPackage: buildBundle('R1-000000000040', twoWeeks), evidenceClass: 'engineering_fixture', segment: 'web_serial', attestation: noAttestation, retentionUntil: futureDate(), waveId: rehearsal.id })
    expect(assigned.participant.waveId).toBe(rehearsal.id)
    expect(JSON.stringify(db.db.prepare('SELECT payload_json FROM research_wave_events WHERE wave_id=? AND event_type=?').get(rehearsal.id, 'participant_linked'))).not.toContain(assigned.participant.participantCodeHash)
    expect(waves.getStatus().externalExecution).toMatchObject({ waveCount: 0, participantCount: 0, status: 'not_started' })

    const external = waves.createWave({ kind: 'external_controlled', windowStart: '2026-01-01T00:00:00.000Z', windowEnd: '2026-01-15T00:00:00.000Z', targetParticipants: 5, quotas: { web_serial: 2, revision_novel: 1, ai_assisted: 1, other_target: 1 }, readiness: waveReadiness }, '2026-01-01T00:00:00.000Z')
    waves.transition(external.id, 'recruiting', '2026-01-01T00:00:00.000Z')
    expect(() => cohort.importBundle({ researchPackage: buildBundle('R1-000000000041', twoWeeks), evidenceClass: 'engineering_fixture', segment: 'web_serial', attestation: noAttestation, retentionUntil: futureDate(), waveId: external.id })).toThrow(/attested external evidence/i)
    const real = cohort.importBundle({ researchPackage: buildBundle('R1-000000000042', twoWeeks), evidenceClass: 'external_attested', segment: 'revision_novel', attestation: fullAttestation, retentionUntil: futureDate(), waveId: external.id })
    expect(real.participant.waveId).toBe(external.id)
    expect(() => cohort.importBundle({ researchPackage: buildBundle('R1-000000000044', twoWeeks), evidenceClass: 'external_attested', segment: 'revision_novel', attestation: fullAttestation, retentionUntil: futureDate(), waveId: external.id })).toThrow(/segment quota/i)

    const unassignedCode = 'R1-000000000043'; cohort.importBundle({ researchPackage: buildBundle(unassignedCode, twoWeeks), evidenceClass: 'engineering_fixture', segment: 'web_serial', attestation: noAttestation, retentionUntil: futureDate() })
    expect(() => cohort.importBundle({ researchPackage: buildBundle(unassignedCode, twoWeeks, { firstTaskType: 'fact_lookup' }), evidenceClass: 'engineering_fixture', segment: 'web_serial', attestation: noAttestation, retentionUntil: futureDate(), waveId: rehearsal.id })).toThrow(/strict continuation/i)
    expect(cohort.getStatus().participants.find((participant) => participant.participantCodeHash === participantHashForTest(unassignedCode))?.waveId).toBeNull()
    expect(() => cohort.importBundle({ researchPackage: buildBundle('R1-000000000040', twoWeeks), evidenceClass: 'engineering_fixture', segment: 'web_serial', attestation: noAttestation, retentionUntil: futureDate(), waveId: external.id })).toThrow(/cannot change waves/i)
  })
})

const noAttestation: CohortAttestation = { targetAuthorConfirmed: false, independentParticipantConfirmed: false, manuscriptRightsConfirmed: false, realUseConfirmed: false }
const fullAttestation: CohortAttestation = { targetAuthorConfirmed: true, independentParticipantConfirmed: true, manuscriptRightsConfirmed: true, realUseConfirmed: true }
const waveReadiness = { protocolReviewed: true, controlledRosterReady: true, deletionContactReady: true, supportRouteRehearsed: true }
const twoWeeks = ['2026-01-03T12:00:00.000Z', '2026-01-12T12:00:00.000Z']
const fourWeeks = [...twoWeeks, '2026-01-19T12:00:00.000Z', '2026-01-26T12:00:00.000Z']

function buildBundle(code: string, completionDates: string[], options: { firstTaskType?: ResearchTask['taskType']; receiptHash?: string; issueCodes?: ResearchTask['issueCodes'] } = {}): ResearchBundle {
  const consentedAt = '2026-01-01T00:00:00.000Z'; const receiptHash = options.receiptHash ?? sha256(`receipt|${code}`); const tasks: ResearchTask[] = []
  const events: ResearchBundleEvent[] = []
  appendEvent(events, 'consented', { participantCode: code, consentReceiptHash: receiptHash }, consentedAt)
  completionDates.forEach((completedAt, index) => {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`; const taskType = index === 0 && options.firstTaskType ? options.firstTaskType : index < 2 ? 'canon_loop' : 'fact_lookup'; const startedAt = new Date(Date.parse(completedAt) - 3_600_000).toISOString(); const projectScopeHash = sha256(`scope|${code}|${index}`); const issueCodes = options.issueCodes ?? []
    tasks.push({ id, taskType, projectScopeHash, status: 'completed', startedAt, completedAt, durationSeconds: 3600, goalAchieved: true, difficulty: 2, minutesSaved: 10, issueCodes })
    appendEvent(events, 'task_started', { taskId: id, taskType, projectScopeHash }, startedAt)
    appendEvent(events, 'task_completed', { taskId: id, outcome: 'completed', goalAchieved: true, difficulty: 2, minutesSaved: 10, issueCodes, durationSeconds: 3600 }, completedAt)
  })
  const manifest: ResearchBundle['manifest'] = {
    formatVersion: 1, exportedAt: new Date(Date.parse(completionDates.at(-1) ?? consentedAt) + 3_600_000).toISOString(), participantCode: code,
    consent: { version: 'r1-consent-v1', textHash: RESEARCH_CONSENT_HASH, receiptHash, consentedAt },
    privacy: { containsManuscriptText: false, containsProjectTitlesOrIds: false, containsPromptsOrSecrets: false, localUntilExplicitExport: true },
    tasks, events,
    progress: { completedTasks: tasks.length, completedCoreLoops: tasks.filter((task) => task.taskType === 'canon_loop').length, observedWeekBuckets: new Set(tasks.map((task) => weekBucket(task.completedAt!))).size, reportedMinutesSaved: tasks.length * 10, dataLossReports: tasks.filter((task) => task.issueCodes.includes('data_loss')).length, lastActivityAt: tasks.at(-1)?.completedAt ?? consentedAt },
  }
  return { format: 'bbd-research-v1', manifest, manifestHash: sha256(stableStringify(manifest)) }
}

function appendEvent(events: ResearchBundleEvent[], eventType: ResearchBundleEvent['eventType'], payload: Record<string, unknown>, occurredAt: string) {
  const previousHash = events.at(-1)?.eventHash ?? null
  const event = { sequence: events.length + 1, eventType, payload, previousHash, eventHash: '', occurredAt } as ResearchBundleEvent
  event.eventHash = sha256(stableStringify({ sequence: event.sequence, eventType: event.eventType, payload: event.payload, previousHash: event.previousHash, occurredAt: event.occurredAt })); events.push(event)
}
function futureDate() { return new Date(Date.now() + 90 * 86_400_000).toISOString() }
function weekBucket(value: string) { const date = new Date(value); const day = (date.getUTCDay() + 6) % 7; date.setUTCDate(date.getUTCDate() - day); return date.toISOString().slice(0, 10) }
function participantHashForTest(code: string) { return sha256(`r1b-cohort-v1|${code}`) }
function stableStringify(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`; return JSON.stringify(value) }
