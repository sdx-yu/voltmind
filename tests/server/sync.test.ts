// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { getConfig } from '../../server/config.js'
import { AppDatabase } from '../../server/db.js'
import { SyncService } from '../../server/sync.js'
import type { SyncTransferPackage } from '../../shared/types.js'
import { emptyStoryTimeSpec } from '../../shared/storyTime.js'

describe('V1-S encrypted handoff protocol', () => {
  let dir: string
  const databases: AppDatabase[] = []

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-sync-')) })
  afterEach(() => { for (const database of databases) database.close(); databases.length = 0; fs.rmSync(dir, { recursive: true, force: true }) })

  function database(name: string) { const result = new AppDatabase(path.join(dir, `${name}.sqlite`)); databases.push(result); return result }

  it('backs up v7 before adding the v8–v10 schemas', () => {
    let db = database('migration')
    const databasePath = db.databasePath
    db.db.exec('DROP TABLE voice_preference_stats; DROP TABLE character_voice_profiles; DROP TABLE style_analysis_runs; DROP TABLE scene_voice_profiles; DROP TABLE project_voice_defaults; DROP TABLE relationship_states; DROP TABLE entity_relationships; DROP TABLE entity_profile_fields; DROP TABLE research_cohort_submissions; DROP TABLE research_cohort_participants; DROP TABLE research_cohort_deletion_receipts; DROP TABLE research_wave_events; DROP TABLE research_wave_incidents; DROP TABLE research_waves; DROP TABLE research_events; DROP TABLE research_tasks; DROP TABLE research_enrollments; DROP TABLE visual_events; DROP TABLE storyboard_cards; DROP TABLE storyboards; DROP TABLE visual_candidates; DROP TABLE visual_anchors; DROP TABLE visual_assets; DROP TABLE template_events; DROP TABLE template_applications; DROP TABLE template_grants; DROP TABLE template_package_resources; DROP TABLE template_packages; DROP TABLE template_resources; DROP TABLE sprint_board_cards; DROP TABLE sprint_boards; DROP TABLE sprint_result_cards; DROP TABLE sprint_events; DROP TABLE sprint_samples; DROP TABLE sprint_sessions; DROP TABLE review_decisions; DROP TABLE review_feedback; DROP TABLE review_sessions; DROP TABLE mobile_inbox_actions; DROP TABLE mobile_inbox_items; DROP TABLE sync_conflicts; DROP TABLE sync_updates; DROP TABLE sync_object_versions; DROP TABLE sync_scene_states; DROP TABLE sync_project_configs; DELETE FROM schema_migrations WHERE version IN (8,9,10,11,12,13,14,15, 16,17,18,19,20);')
    db.close(); databases.pop(); db = new AppDatabase(databasePath); databases.push(db)
    expect(db.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toMatchObject({ version: 20 })
    expect(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_conflicts'").get()).toMatchObject({ name: 'sync_conflicts' })
    expect(fs.readdirSync(path.join(dir, 'backups')).some((name) => name.startsWith('pre-migration-v7-to-v20-'))).toBe(true)
  })

  it('encrypts all manuscript metadata and rejects wrong keys, missing chunks and tampering', () => {
    const db = database('crypto'); const sync = new SyncService(db); const project = db.createProject('密文中的书名')
    const scene = db.listNodes(project.id).find((node) => node.type === 'scene')!; db.saveScene(scene.id, doc('不能出现在信封里的正文'), '不能出现在信封里的正文'); db.updateNode(scene.id, { status: 'complete' })
    db.updateNode(scene.id, { storyTime: '承平十二年腊月廿三', storyTimeSpec: { ...emptyStoryTimeSpec('custom'), era: '承平', year: 12, month: 12, day: 23 } })
    const attachment = Buffer.from('original source bytes'); const attachmentHash = createHash('sha256').update(attachment).digest('hex')
    db.db.prepare('INSERT INTO imported_sources(id,project_id,file_name,mime_type,byte_size,content_hash,content_base64,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), project.id, '原稿.txt', 'text/plain', attachment.length, attachmentHash, attachment.toString('base64'), new Date().toISOString())
    const { recoveryPhrase } = sync.initialize(project.id, '离线电脑 A')
    const transfer = sync.exportPackage(project.id, recoveryPhrase)
    const serialized = JSON.stringify(transfer)
    expect(serialized).not.toContain('密文中的书名'); expect(serialized).not.toContain('不能出现在信封里的正文')
    expect(sync.inspectPackage(transfer, recoveryPhrase)).toMatchObject({ valid: true, projectTitle: '密文中的书名', sceneCount: 1, attachmentCount: 1 })
    expect(() => sync.inspectPackage(transfer, '0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000')).toThrow()
    expect(() => sync.inspectPackage({ ...transfer, chunks: transfer.chunks.slice(1) }, recoveryPhrase)).toThrow(/分块|chunk|缺失/i)
    const tampered = structuredClone(transfer); tampered.chunks[0].data = `${tampered.chunks[0].data.slice(0, -2)}AA`
    expect(() => sync.inspectPackage(tampered, recoveryPhrase)).toThrow(/哈希|hash|损坏/i)
    const restored = database('crypto-restore'); new SyncService(restored).importPackage(transfer, recoveryPhrase, '恢复设备')
    expect(restored.db.prepare('SELECT content_hash FROM imported_sources WHERE project_id=?').get(project.id)).toMatchObject({ content_hash: attachmentHash })
    expect(restored.getNode(scene.id)).toMatchObject({ status: 'complete', storyTime: '承平十二年腊月廿三', storyTimeSpec: { mode: 'custom', era: '承平', year: 12, month: 12, day: 23 } })
  }, 15_000)

  it('bootstraps two isolated replicas, converges concurrent text and makes business forks explicit', () => {
    const a = database('device-a'); const syncA = new SyncService(a); const project = a.createProject('双机长篇')
    const sceneId = a.listNodes(project.id).find((node) => node.type === 'scene')!.id
    a.saveScene(sceneId, doc('中段'), '中段')
    const entity = a.createEntity({ projectId: project.id, type: 'character', canonicalName: '旧名', aliases: [], summary: '', privacyLevel: 'normal' })
    const { recoveryPhrase } = syncA.initialize(project.id, '设备 A')
    const seed = syncA.exportPackage(project.id, recoveryPhrase)

    const b = database('device-b'); const syncB = new SyncService(b)
    expect(syncB.importPackage(seed, recoveryPhrase, '设备 B')).toMatchObject({ bootstrapped: true, appliedScenes: 1 })
    expect(syncB.status(project.id)).toMatchObject({ deviceName: '设备 B', vector: seed.vector })

    a.saveScene(sceneId, doc('甲中段'), '甲中段'); b.saveScene(sceneId, doc('中段乙'), '中段乙')
    a.updateEntity(entity.id, { canonicalName: '阿甲' }); b.updateEntity(entity.id, { canonicalName: '阿乙' })
    const fromA = syncA.exportPackage(project.id, recoveryPhrase); const fromB = syncB.exportPackage(project.id, recoveryPhrase)
    const appliedAtA = syncA.importPackage(fromB, recoveryPhrase); const appliedAtB = syncB.importPackage(fromA, recoveryPhrase)

    expect(appliedAtA).toMatchObject({ mergedScenes: 1, conflictsCreated: 2, provenance: 'conflict' })
    expect(appliedAtB).toMatchObject({ mergedScenes: 1, conflictsCreated: 2, provenance: 'conflict' })
    const textA = a.getScene(sceneId)!.plainText; const textB = b.getScene(sceneId)!.plainText
    expect(textA).toBe(textB); expect(textA).toContain('甲'); expect(textA).toContain('乙'); expect(textA).toContain('中段')
    expect(syncA.listConflicts(project.id).map((conflict) => conflict.kind)).toEqual(expect.arrayContaining(['structured_concurrent_edit', 'provenance_fork']))
    expect(syncB.listConflicts(project.id).map((conflict) => conflict.kind)).toEqual(expect.arrayContaining(['structured_concurrent_edit', 'provenance_fork']))
    expect(syncA.importPackage(fromB, recoveryPhrase)).toMatchObject({ duplicate: true, appliedScenes: 0, conflictsCreated: 0 })

    const entityConflict = syncA.listConflicts(project.id).find((conflict) => conflict.objectType === 'entity')!
    expect(syncA.resolveConflict(project.id, entityConflict.id, 'use_remote')).toMatchObject({ status: 'resolved', resolution: 'use_remote' })
    expect(a.getEntity(entity.id)?.canonicalName).toBe('阿乙')
    expect(a.listProvenanceEvents(project.id).at(-1)?.eventType).toBe('sync_conflict_resolved')
  }, 15_000)

  it('detects edit versus delete and keeps recovery phrases one-time only', () => {
    const a = database('delete-a'); const syncA = new SyncService(a); const project = a.createProject('删除冲突')
    const entity = a.createEntity({ projectId: project.id, type: 'item', canonicalName: '钥匙', aliases: [], summary: '', privacyLevel: 'normal' })
    const initialized = syncA.initialize(project.id, 'A'); expect(initialized.recoveryPhrase.split('-')).toHaveLength(12)
    expect(() => syncA.initialize(project.id, 'A2')).toThrow(/不会再次显示/)
    const seed = syncA.exportPackage(project.id, initialized.recoveryPhrase)
    const b = database('delete-b'); const syncB = new SyncService(b); syncB.importPackage(seed, initialized.recoveryPhrase, 'B')
    a.updateEntity(entity.id, { deletedAt: new Date().toISOString() }); b.updateEntity(entity.id, { summary: '另一台设备仍在编辑' })
    const fromA = syncA.exportPackage(project.id, initialized.recoveryPhrase); const fromB = syncB.exportPackage(project.id, initialized.recoveryPhrase)
    syncA.importPackage(fromB, initialized.recoveryPhrase); syncB.importPackage(fromA, initialized.recoveryPhrase)
    expect(syncA.listConflicts(project.id)).toContainEqual(expect.objectContaining({ objectId: entity.id, kind: 'delete_edit', status: 'pending' }))
  })

  it('passes the five built-in engineering drills', () => {
    const db = database('drill'); expect(new SyncService(db).runDrill()).toMatchObject({ ok: true, checks: [{ passed: true }, { passed: true }, { passed: true }, { passed: true }, { passed: true }] })
  })
})

describe('V1-S sync API', () => {
  let dir: string
  let result: ReturnType<typeof createApp>
  let cookie: string
  beforeEach(async () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-sync-api-')); result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'api.sqlite'), production: false })); cookie = (await request(result.app).post('/api/session')).headers['set-cookie'][0].split(';')[0] })
  afterEach(() => { result.database.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('requires the local session and exposes initialize, export, inspect, import and drill routes', async () => {
    const project = result.database.createProject('API 接力')
    await request(result.app).get(`/api/projects/${project.id}/sync`).expect(401)
    const initialized = await request(result.app).post(`/api/projects/${project.id}/sync/initialize`).set('Cookie', cookie).send({ deviceName: 'API 设备' }).expect(201)
    expect(initialized.body).toMatchObject({ status: { initialized: true, engineeringOnly: true }, recoveryPhrase: expect.any(String) })
    const exported = await request(result.app).post(`/api/projects/${project.id}/sync/export`).set('Cookie', cookie).send({ recoveryPhrase: initialized.body.recoveryPhrase }).expect(201)
    expect(exported.body).toMatchObject({ format: 'bbd-sync-v1', chunkCount: expect.any(Number) })
    await request(result.app).post('/api/sync/inspect').set('Cookie', cookie).send({ package: exported.body as SyncTransferPackage, recoveryPhrase: initialized.body.recoveryPhrase }).expect(200).expect((response) => expect(response.body.projectTitle).toBe('API 接力'))
    await request(result.app).post('/api/sync/import').set('Cookie', cookie).send({ package: exported.body, recoveryPhrase: initialized.body.recoveryPhrase, deviceName: '重复设备' }).expect(201).expect((response) => expect(response.body.duplicate).toBe(true))
    await request(result.app).post('/api/sync/drill').set('Cookie', cookie).expect(200).expect((response) => expect(response.body.ok).toBe(true))
    const backup = await request(result.app).get(`/api/projects/${project.id}/backup`).set('Cookie', cookie).expect(200)
    expect(JSON.stringify(backup.body)).not.toContain(initialized.body.recoveryPhrase)
    expect(backup.body.payload.sync).toBeUndefined()
  })
})

function doc(text: string) { return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }
