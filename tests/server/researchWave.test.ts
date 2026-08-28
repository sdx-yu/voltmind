// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { getConfig } from '../../server/config.js'
import { AppDatabase } from '../../server/db.js'
import { ResearchWaveService, WAVE_PROTOCOL_HASH } from '../../server/researchWave.js'
import { sha256 } from '../../server/utils.js'

describe('R1-C controlled research waves', () => {
  let dir = ''
  const databases: AppDatabase[] = []
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-wave-')) })
  afterEach(() => { for (const database of databases.splice(0)) database.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  function database(name: string) { const result = new AppDatabase(path.join(dir, `${name}.sqlite`)); databases.push(result); return result }

  it('backs up schema v15 and creates wave tables plus immutable cohort assignment', () => {
    let db = database('migration'); const databasePath = db.databasePath
    db.db.exec('DROP INDEX idx_research_cohort_participants_wave; ALTER TABLE research_cohort_participants DROP COLUMN wave_id; DROP TABLE research_wave_events; DROP TABLE research_wave_incidents; DROP TABLE research_waves; DELETE FROM schema_migrations WHERE version=16;')
    db.close(); databases.splice(databases.indexOf(db), 1)
    db = new AppDatabase(databasePath); databases.push(db)
    expect(db.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toMatchObject({ version: 16 })
    expect(db.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name LIKE 'research_wave%'").get()).toMatchObject({ count: 3 })
    expect(db.db.prepare('PRAGMA table_info(research_cohort_participants)').all()).toContainEqual(expect.objectContaining({ name: 'wave_id' }))
    expect(fs.readdirSync(path.join(dir, 'backups')).some((name) => name.startsWith('pre-migration-v15-to-v16-'))).toBe(true)
  })

  it('freezes external targets, quotas, readiness and the 14–42 day UTC window', () => {
    const waves = new ResearchWaveService(database('validation'))
    expect(() => waves.createWave({ ...externalInput, targetParticipants: 4 }, start)).toThrow(/target/i)
    expect(() => waves.createWave({ ...externalInput, quotas: { ...externalInput.quotas, web_serial: 1 } }, start)).toThrow(/quotas/i)
    expect(() => waves.createWave({ ...externalInput, windowEnd: '2026-01-10T00:00:00.000Z' }, start)).toThrow(/14–42 days/i)
    expect(() => waves.createWave({ ...externalInput, readiness: { ...readiness, supportRouteRehearsed: false } }, start)).toThrow(/readiness confirmations/i)
    const wave = waves.createWave(externalInput, start)
    expect(wave).toMatchObject({ kind: 'external_controlled', status: 'draft', targetParticipants: 5, protocolHash: WAVE_PROTOCOL_HASH, r1Decision: 'NO-GO' })
    expect(waves.transition(wave.id, 'recruiting', start).status).toBe('recruiting')
    expect(() => waves.transition(wave.id, 'active', '2025-12-31T23:59:59.000Z')).toThrow(/frozen wave window/i)
    expect(waves.transition(wave.id, 'active', '2026-01-02T00:00:00.000Z').status).toBe('active')
    expect(() => waves.transition(wave.id, 'review', '2026-01-10T00:00:00.000Z')).toThrow(/before its frozen wave window ends/i)
  })

  it('records bounded incidents, blocks critical closure and maintains a verifiable event chain', () => {
    const db = database('events'); const waves = new ResearchWaveService(db)
    const wave = waves.createWave(rehearsalInput, start)
    waves.transition(wave.id, 'recruiting', start)
    waves.transition(wave.id, 'active', '2026-01-02T00:00:00.000Z')
    const incidentWave = waves.reportIncident(wave.id, 'recovery_failed', 'critical', '2026-01-03T00:00:00.000Z')
    waves.transition(wave.id, 'review', '2026-01-15T00:00:00.000Z')
    expect(() => waves.transition(wave.id, 'closed', '2026-01-15T00:01:00.000Z')).toThrow(/resolved before closing/i)
    const resolved = waves.resolveIncident(wave.id, incidentWave.incidents[0].id, '2026-01-15T00:02:00.000Z')
    expect(resolved.openCriticalIncidents).toBe(0)
    expect(waves.transition(wave.id, 'closed', '2026-01-15T00:03:00.000Z').status).toBe('closed')
    const rows = db.db.prepare('SELECT * FROM research_wave_events WHERE wave_id=? ORDER BY sequence').all(wave.id) as Array<Record<string, unknown>>
    expect(rows).toHaveLength(7)
    rows.forEach((row, index) => {
      const previousHash = index ? String(rows[index - 1].event_hash) : null
      expect(row.previous_hash ?? null).toBe(previousHash)
      expect(row.event_hash).toBe(sha256(stableStringify({ sequence: Number(row.sequence), eventType: String(row.event_type), payload: JSON.parse(String(row.payload_json)), previousHash, occurredAt: String(row.occurred_at) })))
    })
  })

  it('exports a coordinator kit without roster, participant identifiers or internal wave IDs', () => {
    const waves = new ResearchWaveService(database('privacy')); const wave = waves.createWave(rehearsalInput, start); const kit = waves.exportKit(wave.id); const serialized = JSON.stringify(kit)
    expect(kit).toMatchObject({ format: 'bbd-wave-kit-v1', manifest: { appVersion: '1.7.0', privacy: { containsNamesOrContacts: false, containsParticipantCodes: false, containsManuscriptText: false } } })
    expect(kit.manifestHash).toBe(sha256(stableStringify(kit.manifest)))
    expect(serialized).not.toContain(wave.id)
    expect(serialized).not.toContain('participantCodeHash')
    expect(serialized).not.toContain('incident')
  })

  it('protects wave routes and never converts a rehearsal into external execution', async () => {
    const result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'routes.sqlite'), production: false })); databases.push(result.database)
    await request(result.app).get('/api/research-waves/status').expect(401)
    const cookie = (await request(result.app).post('/api/session').expect(200)).headers['set-cookie'][0].split(';')[0]
    const created = (await request(result.app).post('/api/research-waves').set('Cookie', cookie).send(rehearsalInput).expect(201)).body
    await request(result.app).post(`/api/research-waves/${created.id}/transition`).set('Cookie', cookie).send({ next: 'recruiting' }).expect(200)
    const status = (await request(result.app).get('/api/research-waves/status').set('Cookie', cookie).expect(200)).body
    expect(status).toMatchObject({ appVersion: '1.7.0', externalExecution: { waveCount: 0, participantCount: 0, status: 'not_started' }, privacy: { rehearsalsCountAsExternal: false, automaticR1Go: false } })
    expect((await request(result.app).get(`/api/research-waves/${created.id}/kit`).set('Cookie', cookie).expect(200)).body).toMatchObject({ format: 'bbd-wave-kit-v1' })
  })
})

const start = '2026-01-01T00:00:00.000Z'
const readiness = { protocolReviewed: true, controlledRosterReady: true, deletionContactReady: true, supportRouteRehearsed: true }
const externalInput = { kind: 'external_controlled' as const, windowStart: start, windowEnd: '2026-01-15T00:00:00.000Z', targetParticipants: 5, quotas: { web_serial: 2, revision_novel: 1, ai_assisted: 1, other_target: 1 }, readiness }
const rehearsalInput = { kind: 'engineering_rehearsal' as const, windowStart: start, windowEnd: '2026-01-15T00:00:00.000Z', targetParticipants: 1, quotas: { web_serial: 1, revision_novel: 0, ai_assisted: 0, other_target: 0 }, readiness }
function stableStringify(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`; return JSON.stringify(value) }
