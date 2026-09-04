// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../../server/app.js'
import { getConfig } from '../../server/config.js'
import { AppDatabase } from '../../server/db.js'
import { SprintService, verifySprintPackage } from '../../server/sprint.js'
import { sha256 } from '../../server/utils.js'
import type { SprintPackage } from '../../shared/types.js'

describe('V2-F trustworthy quiet sprints and offline boards', () => {
  let dir: string
  const databases: AppDatabase[] = []
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-sprint-')) })
  afterEach(() => { for (const database of databases) database.close(); databases.length = 0; fs.rmSync(dir, { recursive: true, force: true }) })
  function database(name: string) { const db = new AppDatabase(path.join(dir, `${name}.sqlite`)); databases.push(db); return db }

  it('backs up v10 and applies the v11 sprint schema', () => {
    let db = database('migration'); const databasePath = db.databasePath
    db.db.exec('DROP TABLE story_beat_scenes; DROP TABLE story_beats; DROP TABLE story_blueprints; DELETE FROM schema_migrations WHERE version=21;')
    db.db.exec('DROP TABLE voice_preference_stats; DROP TABLE character_voice_profiles; DROP TABLE style_analysis_runs; DROP TABLE scene_voice_profiles; DROP TABLE project_voice_defaults; DROP TABLE relationship_states; DROP TABLE entity_relationships; DROP TABLE entity_profile_fields; DROP TABLE research_cohort_submissions; DROP TABLE research_cohort_participants; DROP TABLE research_cohort_deletion_receipts; DROP TABLE research_wave_events; DROP TABLE research_wave_incidents; DROP TABLE research_waves; DROP TABLE research_events; DROP TABLE research_tasks; DROP TABLE research_enrollments; DROP TABLE visual_events; DROP TABLE storyboard_cards; DROP TABLE storyboards; DROP TABLE visual_candidates; DROP TABLE visual_anchors; DROP TABLE visual_assets; DROP TABLE template_events; DROP TABLE template_applications; DROP TABLE template_grants; DROP TABLE template_package_resources; DROP TABLE template_packages; DROP TABLE template_resources; DROP TABLE sprint_board_cards; DROP TABLE sprint_boards; DROP TABLE sprint_result_cards; DROP TABLE sprint_events; DROP TABLE sprint_samples; DROP TABLE sprint_sessions; DELETE FROM schema_migrations WHERE version IN (11,12,13,14,15, 16,17,18,19,20);')
    db.close(); databases.pop(); db = new AppDatabase(databasePath); databases.push(db)
    expect(db.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toMatchObject({ version: 21 })
    expect(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sprint_events'").get()).toMatchObject({ name: 'sprint_events' })
    expect(fs.readdirSync(path.join(dir, 'backups')).some((name) => name.startsWith('pre-migration-v10-to-v21-'))).toBe(true)
  })

  it('uses saved version deltas across paste, undo, pause and resume', () => {
    const db = database('delta'); const project = db.createProject('可信净新增'); const scene = db.listNodes(project.id).find((node) => node.type === 'scene')!
    db.saveScene(scene.id, doc('甲乙'), '甲乙')
    let clockMs = Date.now(); const service = new SprintService(db, () => new Date(clockMs))
    const sprint = service.start(project.id, { scope: 'scene', sceneId: scene.id, durationMinutes: 10, goalWords: 3 })
    db.saveScene(scene.id, doc('甲乙丙丁戊'), '甲乙丙丁戊')
    clockMs += 60_000; expect(service.pause(sprint.id)).toMatchObject({ status: 'paused', netWords: 3 })
    clockMs += 120_000; service.resume(sprint.id)
    db.saveScene(scene.id, doc('甲乙丙'), '甲乙丙')
    clockMs += 60_000; const completed = service.complete(sprint.id, '山岚')
    expect(completed).toMatchObject({ status: 'completed', netWords: 1, resultCard: { participantLabel: '山岚', netWords: 1, activeDurationMs: 120_000 } })
    expect(completed.events.map((event) => event.type)).toEqual(['started', 'paused', 'resumed', 'completed'])
    expect(completed.samples.map((sample) => sample.kind)).toEqual(['start', 'checkpoint', 'end'])
  })

  it('conservatively pauses after sleep and marks a backwards clock', () => {
    const db = database('clock'); const project = db.createProject('时钟对账'); const scene = db.listNodes(project.id).find((node) => node.type === 'scene')!
    let clockMs = Date.now(); const service = new SprintService(db, () => new Date(clockMs)); const startedAt = new Date(clockMs).toISOString()
    const sleeping = service.start(project.id, { scope: 'scene', sceneId: scene.id, durationMinutes: 20, goalWords: 100 })
    clockMs += 5 * 60_000
    const reconciled = service.reconcile(sleeping.id, { sleepDetected: true, lastObservedAt: new Date(Date.parse(startedAt) + 60_000).toISOString() })
    expect(reconciled).toMatchObject({ status: 'paused', clockStatus: 'sleep_reconciled', activeElapsedMs: 60_000 })
    service.cancel(sleeping.id)
    clockMs += 60_000; const anomaly = service.start(project.id, { scope: 'project', durationMinutes: 10, goalWords: 50 })
    clockMs -= 120_000
    expect(service.reconcile(anomaly.id)).toMatchObject({ status: 'paused', clockStatus: 'clock_anomaly' })
  })

  it('exports text-free verifiable cards and merges a board idempotently', () => {
    const db = database('board'); const project = db.createProject('不能泄露的书名'); const scene = db.listNodes(project.id).find((node) => node.type === 'scene')!
    db.saveScene(scene.id, doc('不能泄露的正文'), '不能泄露的正文')
    let clockMs = Date.now(); const service = new SprintService(db, () => new Date(clockMs))
    const session = service.start(project.id, { scope: 'scene', sceneId: scene.id, durationMinutes: 10, goalWords: 20 })
    db.saveScene(scene.id, doc('不能泄露的正文又写了一段'), '不能泄露的正文又写了一段'); clockMs += 10 * 60_000
    const completed = service.complete(session.id, '作者甲'); const sprintPackage = service.exportCard(completed.resultCard!.id); const serialized = JSON.stringify(sprintPackage)
    expect(serialized).not.toContain('不能泄露'); expect(serialized).not.toContain(scene.id); expect(serialized).not.toContain(project.id)
    expect(service.inspect(sprintPackage)).toMatchObject({ valid: true, participantLabel: '作者甲', netWords: completed.netWords })
    expect(() => verifySprintPackage({ ...sprintPackage, cardHash: '0'.repeat(64) })).toThrow(/tampered/)
    const board = service.createBoard(project.id, { name: '本周冲刺', period: 'week', targetWords: 5000, periodStartedAt: new Date(clockMs - 24 * 60 * 60_000).toISOString() })
    expect(service.importToBoard(board.id, sprintPackage)).toMatchObject({ duplicate: false, board: { totalNetWords: completed.netWords } })
    expect(service.importToBoard(board.id, sprintPackage)).toMatchObject({ duplicate: true })
    const changedCard = { ...sprintPackage.card, netWords: sprintPackage.card.netWords + 1 }
    const collision: SprintPackage = { ...sprintPackage, card: changedCard, cardHash: sha256(JSON.stringify({ card: changedCard, events: sprintPackage.events })) }
    expect(() => service.importToBoard(board.id, collision)).toThrow(/collision/)
  })

  it('restores completed sprint history and group boards from a normal backup', async () => {
    const result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'backup.sqlite'), production: false })); databases.push(result.database)
    const cookie = (await request(result.app).post('/api/session')).headers['set-cookie'][0].split(';')[0]
    const project = result.database.createProject('冲刺恢复'); const scene = result.database.listNodes(project.id).find((node) => node.type === 'scene')!
    const started = result.sprints.start(project.id, { scope: 'scene', sceneId: scene.id, durationMinutes: 10, goalWords: 10 })
    result.database.saveScene(scene.id, doc('新增五个字'), '新增五个字'); const completed = result.sprints.complete(started.id, '恢复作者')
    const board = result.sprints.createBoard(project.id, { name: '今日小组', period: 'day', targetWords: 1000, periodStartedAt: new Date(Date.now() - 60_000).toISOString() })
    result.sprints.addLocalCard(board.id, completed.resultCard!.id)
    const archive = (await request(result.app).get(`/api/projects/${project.id}/backup`).set('Cookie', cookie).expect(200)).body
    expect(JSON.stringify(archive.payload.sprint)).not.toContain('新增五个字')
    const restored = (await request(result.app).post('/api/backups/restore').set('Cookie', cookie).send(archive).expect(201)).body
    expect(result.database.listSprintSessions(restored.id)).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'completed', resultCard: expect.objectContaining({ participantLabel: '恢复作者' }) })]))
    expect(result.database.listSprintBoards(restored.id)).toEqual([expect.objectContaining({ name: '今日小组', entries: [expect.any(Object)] })])
  })
})

function doc(text: string): Record<string, unknown> { return { type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] } }
