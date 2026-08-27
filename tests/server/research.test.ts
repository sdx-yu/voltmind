// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { getConfig } from '../../server/config.js'
import { AppDatabase } from '../../server/db.js'
import { ResearchService } from '../../server/research.js'

describe('R1 local research evidence and release readiness', () => {
  let dir = ''
  const databases: AppDatabase[] = []
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-research-')) })
  afterEach(() => { for (const database of databases.splice(0)) database.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  function database(name: string) { const result = new AppDatabase(path.join(dir, `${name}.sqlite`)); databases.push(result); return result }
  async function cookie(app: ReturnType<typeof createApp>['app']) { return (await request(app).post('/api/session').expect(200)).headers['set-cookie'][0].split(';')[0] }

  it('backs up v13 before migrating through v16 and creates research, cohort and wave tables', () => {
    let db = database('migration'); const databasePath = db.databasePath
    db.db.exec('DROP TABLE research_cohort_submissions; DROP TABLE research_cohort_participants; DROP TABLE research_cohort_deletion_receipts; DROP TABLE research_wave_events; DROP TABLE research_wave_incidents; DROP TABLE research_waves; DROP TABLE research_events; DROP TABLE research_tasks; DROP TABLE research_enrollments; DELETE FROM schema_migrations WHERE version IN (14,15,16);')
    db.close(); databases.splice(databases.indexOf(db), 1)
    db = new AppDatabase(databasePath); databases.push(db)
    expect(db.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toMatchObject({ version: 16 })
    expect(db.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name LIKE 'research_%'").get()).toMatchObject({ count: 9 })
    expect(fs.readdirSync(path.join(dir, 'backups')).some((name) => name.startsWith('pre-migration-v13-to-v16-'))).toBe(true)
  })

  it('requires explicit consent and exports only pseudonymous immutable task evidence', () => {
    const db = database('evidence'); const research = new ResearchService(db); const project = db.createProject('绝不能进入研究包的书名')
    const scene = db.listNodes(project.id).find((node) => node.type === 'scene')!
    db.saveScene(scene.id, doc('绝不能进入研究包的正文'), '绝不能进入研究包的正文')
    expect(() => research.startTask(project.id, 'canon_loop')).toThrow(/consent/i)
    expect(() => research.enroll({ adultOrAuthorized: true, manuscriptRights: true, localOnlyUnderstood: false, voluntary: true })).toThrow(/confirmations/i)
    const enrollment = research.enroll({ adultOrAuthorized: true, manuscriptRights: true, localOnlyUnderstood: true, voluntary: true }).enrollment!
    expect(enrollment.participantCode).toMatch(/^R1-[A-F0-9]{12}$/)
    const task = research.startTask(project.id, 'canon_loop')
    expect(() => research.startTask(project.id, 'fact_lookup')).toThrow(/already active/i)
    research.completeTask(task.id, { outcome: 'completed', goalAchieved: true, difficulty: 2, minutesSaved: 12, issueCodes: ['false_positive'] })
    expect(() => research.completeTask(task.id, { outcome: 'completed', goalAchieved: true, difficulty: 2, minutesSaved: 12, issueCodes: [] })).toThrow(/resolved/i)
    const bundle = research.exportBundle(); const serialized = JSON.stringify(bundle)
    expect(bundle.manifest.progress).toMatchObject({ completedTasks: 1, completedCoreLoops: 1, reportedMinutesSaved: 12, dataLossReports: 0 })
    expect(research.verifyBundle(bundle)).toMatchObject({ ok: true, manifestHashValid: true, eventChainValid: true, semanticValid: true, completedTasks: 1 })
    expect(serialized).not.toContain(project.id)
    expect(serialized).not.toContain(project.title)
    expect(serialized).not.toContain('绝不能进入研究包的正文')
    expect(serialized).not.toContain('plainText')
    const tampered = structuredClone(bundle); tampered.manifest.tasks[0].minutesSaved = 13
    expect(research.verifyBundle(tampered)).toMatchObject({ ok: false, manifestHashValid: false })
    const freeText = structuredClone(bundle) as ResearchBundleWithLooseEvents
    freeText.manifest.events[1].payload.sceneTitle = '不应进入研究包的自由文本'
    expect(() => research.verifyBundle(freeText)).toThrow()
  })

  it('withdraws by deleting the local participant code, tasks and event chain without touching manuscripts', () => {
    const db = database('withdraw'); const research = new ResearchService(db); const project = db.createProject('保留书稿')
    research.enroll({ adultOrAuthorized: true, manuscriptRights: true, localOnlyUnderstood: true, voluntary: true })
    research.startTask(project.id, 'fact_lookup')
    expect(research.withdraw()).toMatchObject({ deleted: true })
    expect(research.getStatus()).toMatchObject({ enrollment: null, tasks: [], progress: { completedTasks: 0 } })
    expect(db.db.prepare('SELECT COUNT(*) AS count FROM research_tasks').get()).toMatchObject({ count: 0 })
    expect(db.db.prepare('SELECT COUNT(*) AS count FROM research_events').get()).toMatchObject({ count: 0 })
    expect(db.getProject(project.id)?.title).toBe('保留书稿')
  })

  it('serves the authenticated journey, verifies packages and keeps public release NO-GO', async () => {
    const result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'routes.sqlite'), production: false })); databases.push(result.database)
    const auth = await cookie(result.app); const project = result.database.createProject('研究接口验收')
    await request(result.app).get('/api/research/status').expect(401)
    await request(result.app).post('/api/research/enroll').set('Cookie', auth).send({ adultOrAuthorized: true, manuscriptRights: true, localOnlyUnderstood: true, voluntary: true }).expect(201)
    const task = (await request(result.app).post('/api/research/tasks').set('Cookie', auth).send({ projectId: project.id, taskType: 'restore_drill' }).expect(201)).body
    const abandoned = (await request(result.app).post(`/api/research/tasks/${task.id}/complete`).set('Cookie', auth).send({ outcome: 'abandoned', goalAchieved: true, difficulty: 5, minutesSaved: 0, issueCodes: ['recovery_failed'] }).expect(200)).body
    expect(abandoned.goalAchieved).toBe(false)
    const bundle = (await request(result.app).get('/api/research/export').set('Cookie', auth).expect(200)).body
    expect((await request(result.app).post('/api/research/inspect').set('Cookie', auth).send({ package: bundle }).expect(200)).body).toMatchObject({ ok: true, completedTasks: 1 })
    const support = (await request(result.app).get('/api/support/bundle').set('Cookie', auth).expect(200)).body
    expect(support).toMatchObject({ format: 'bbd-support-v1', manifest: { appVersion: '1.6.0', database: { schemaVersion: 16, integrity: 'ok' }, counts: { cohortParticipants: 0, researchWaves: 0 }, privacy: { containsManuscriptText: false, containsPaths: false } } })
    expect(JSON.stringify(support)).not.toContain(project.title)
    expect(JSON.stringify(support)).not.toContain(dir)
    const readiness = (await request(result.app).get('/api/release/readiness').set('Cookie', auth).expect(200)).body
    expect(readiness).toMatchObject({ appVersion: '1.6.0', publicRelease: 'NO-GO' })
    expect(readiness.external).toContainEqual(expect.objectContaining({ gate: '真实作者验证', status: 'required' }))
  })

  it('keeps global research identity out of project backup archives', async () => {
    const result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'backup.sqlite'), production: false })); databases.push(result.database)
    const auth = await cookie(result.app); const project = result.database.createProject('项目备份隔离')
    const status = result.research.enroll({ adultOrAuthorized: true, manuscriptRights: true, localOnlyUnderstood: true, voluntary: true })
    const backup = (await request(result.app).get(`/api/projects/${project.id}/backup`).set('Cookie', auth).expect(200)).body
    expect(JSON.stringify(backup)).not.toContain(status.enrollment!.participantCode)
    expect(backup.payload).not.toHaveProperty('research')
  })
})

function doc(text: string) { return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }
type ResearchBundleWithLooseEvents = { manifest: { events: Array<{ payload: Record<string, unknown> }> } }
