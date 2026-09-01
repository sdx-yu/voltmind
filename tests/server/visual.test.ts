// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { getConfig } from '../../server/config.js'
import { AppDatabase } from '../../server/db.js'
import { VisualService } from '../../server/visual.js'

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlM32kAAAAASUVORK5CYII='

describe('V2-V canon-bound visual anchors and storyboards', () => {
  let dir = ''
  const databases: AppDatabase[] = []
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-visual-')) })
  afterEach(() => { for (const database of databases.splice(0)) database.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  function database(name: string) { const result = new AppDatabase(path.join(dir, `${name}.sqlite`)); databases.push(result); return result }
  async function cookie(app: ReturnType<typeof createApp>['app']) { return (await request(app).post('/api/session').expect(200)).headers['set-cookie'][0].split(';')[0] }

  it('backs up v12 before migration v13 and creates the visual data model', () => {
    let db = database('migration'); const databasePath = db.databasePath
    db.db.exec('DROP TABLE voice_preference_stats; DROP TABLE character_voice_profiles; DROP TABLE style_analysis_runs; DROP TABLE scene_voice_profiles; DROP TABLE project_voice_defaults; DROP TABLE relationship_states; DROP TABLE entity_relationships; DROP TABLE entity_profile_fields; DROP TABLE research_cohort_submissions; DROP TABLE research_cohort_participants; DROP TABLE research_cohort_deletion_receipts; DROP TABLE research_wave_events; DROP TABLE research_wave_incidents; DROP TABLE research_waves; DROP TABLE research_events; DROP TABLE research_tasks; DROP TABLE research_enrollments; DROP TABLE visual_events; DROP TABLE storyboard_cards; DROP TABLE storyboards; DROP TABLE visual_candidates; DROP TABLE visual_anchors; DROP TABLE visual_assets; DELETE FROM schema_migrations WHERE version IN (13,14,15, 16,17,18,19,20);')
    db.close(); databases.splice(databases.indexOf(db), 1)
    db = new AppDatabase(databasePath); databases.push(db)
    expect(db.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toMatchObject({ version: 20 })
    expect(db.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND (name LIKE 'visual_%' OR name LIKE 'storyboard%')").get()).toMatchObject({ count: 6 })
    expect(fs.readdirSync(path.join(dir, 'backups')).some((name) => name.startsWith('pre-migration-v12-to-v20-'))).toBe(true)
  })

  it('reads only explicitly selected non-private canon fields and marks accepted bindings stale after canon changes', () => {
    const db = database('anchor'); const visuals = new VisualService(db); const project = db.createProject('视觉正典验收')
    const entity = db.createEntity({ projectId: project.id, type: 'character', canonicalName: '林雾', aliases: ['小雾'], summary: '左眼有金色裂纹', privacyLevel: 'normal' })
    const privateEntity = db.createEntity({ projectId: project.id, type: 'item', canonicalName: '密钥', summary: '不能读取', privacyLevel: 'local_private' })
    const anchor = visuals.createAnchor(project.id, entity.id, ['canonicalName'], '水墨轮廓')
    expect(anchor.visualDescription).toContain('林雾')
    expect(anchor.visualDescription).toContain('水墨轮廓')
    expect(anchor.visualDescription).not.toContain('左眼有金色裂纹')
    expect(anchor.visualDescription).not.toContain('小雾')
    expect(() => visuals.createAnchor(project.id, privateEntity.id, ['canonicalName'])).toThrow(/local_private/)

    const candidate = visuals.importCandidate(anchor.id, { fileName: 'lin-wu.png', mimeType: 'image/png', contentBase64: pngBase64 })
    visuals.resolveCandidate(candidate.id, 'accepted')
    expect(visuals.getAnchor(anchor.id)?.bindingStatus).toBe('current')
    db.updateEntity(entity.id, { summary: '未选择字段变化' })
    expect(visuals.getAnchor(anchor.id)?.bindingStatus).toBe('current')
    db.updateEntity(entity.id, { canonicalName: '林雾·成年' })
    expect(visuals.getAnchor(anchor.id)?.bindingStatus).toBe('stale')
    visuals.refreshAnchor(anchor.id)
    expect(visuals.getAnchor(anchor.id)?.bindingStatus).toBe('stale')
  })

  it('content-addresses real local images, rejects MIME spoofing and never changes text canon when accepting a candidate', () => {
    const db = database('asset'); const visuals = new VisualService(db); const project = db.createProject('视觉候选验收')
    const entity = db.createEntity({ projectId: project.id, type: 'location', canonicalName: '潮汐塔', summary: '黑色玄武岩高塔', privacyLevel: 'normal' })
    const anchor = visuals.createAnchor(project.id, entity.id, ['canonicalName', 'summary'])
    expect(() => visuals.importCandidate(anchor.id, { fileName: 'spoof.jpg', mimeType: 'image/jpeg', contentBase64: pngBase64 })).toThrow(/does not match/)
    const candidate = visuals.importCandidate(anchor.id, { fileName: 'tower.png', mimeType: 'image/png', contentBase64: pngBase64 })
    expect(candidate.asset).toMatchObject({ mimeType: 'image/png', byteSize: 68, width: 1, height: 1 })
    expect(visuals.importCandidate(anchor.id, { fileName: 'duplicate.png', mimeType: 'image/png', contentBase64: pngBase64 }).id).toBe(candidate.id)
    visuals.resolveCandidate(candidate.id, 'accepted')
    expect(db.getEntity(entity.id)).toMatchObject({ canonicalName: '潮汐塔', summary: '黑色玄武岩高塔' })
    expect(db.db.prepare('SELECT COUNT(*) AS count FROM visual_assets').get()).toMatchObject({ count: 1 })
    expect(db.listProvenanceEvents(project.id).map((event) => event.eventType)).toEqual(expect.arrayContaining(['visual_anchor_created', 'visual_candidate_imported', 'visual_candidate_accepted']))
  })

  it('builds text-free scene storyboards from accepted assets and immutable canon bindings', () => {
    const db = database('storyboard'); const visuals = new VisualService(db); const project = db.createProject('故事板验收')
    const scene = db.listNodes(project.id).find((node) => node.type === 'scene')!
    db.saveScene(scene.id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文绝不进入故事板。' }] }] }, '正文绝不进入故事板。')
    const entity = db.createEntity({ projectId: project.id, type: 'item', canonicalName: '停摆怀表', summary: '银壳裂纹', privacyLevel: 'normal' })
    const anchor = visuals.createAnchor(project.id, entity.id, ['canonicalName', 'summary'])
    const candidate = visuals.importCandidate(anchor.id, { fileName: 'watch.png', mimeType: 'image/png', contentBase64: pngBase64 })
    visuals.resolveCandidate(candidate.id, 'accepted')
    const board = visuals.getOrCreateStoryboard(project.id, scene.id)
    const card = visuals.addStoryboardCard(board.id, { purpose: '特写怀表停止', note: '制造时间异常', anchorIds: [anchor.id], assetHash: candidate.asset.contentHash })
    expect(card).toMatchObject({ purpose: '特写怀表停止', anchorIds: [anchor.id], canonBindings: [{ anchorId: anchor.id, canonHash: anchor.canonHash }] })
    expect(JSON.stringify(visuals.listStoryboards(project.id))).not.toContain('正文绝不进入故事板')
    const second = visuals.addStoryboardCard(board.id, { purpose: '转向人物反应', anchorIds: [anchor.id] })
    visuals.moveStoryboardCard(second.id, 'up')
    expect(visuals.listStoryboards(project.id)[0].cards.map((item) => item.id)).toEqual([second.id, card.id])
    visuals.deleteStoryboardCard(second.id)
    expect(visuals.listStoryboards(project.id)[0].cards).toHaveLength(1)
  })

  it('serves the authenticated visual journey and immutable asset bytes through HTTP', async () => {
    const result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'routes.sqlite'), production: false })); databases.push(result.database)
    const auth = await cookie(result.app); const project = result.database.createProject('视觉接口验收')
    const entity = result.database.createEntity({ projectId: project.id, type: 'character', canonicalName: '阿澜', summary: '红围巾', privacyLevel: 'normal' })
    const anchor = (await request(result.app).post(`/api/projects/${project.id}/visual-anchors`).set('Cookie', auth).send({ entityId: entity.id, selectedFields: ['canonicalName', 'summary'] }).expect(201)).body
    const candidate = (await request(result.app).post(`/api/visual-anchors/${anchor.id}/candidates`).set('Cookie', auth).send({ fileName: 'alan.png', mimeType: 'image/png', contentBase64: pngBase64 }).expect(201)).body
    await request(result.app).post(`/api/visual-candidates/${candidate.id}/resolve`).set('Cookie', auth).send({ decision: 'accepted' }).expect(200)
    const response = await request(result.app).get(`/api/visual-assets/${candidate.asset.contentHash}/content`).set('Cookie', auth).expect(200).expect('Content-Type', 'image/png')
    expect(Buffer.from(response.body)).toEqual(Buffer.from(pngBase64, 'base64'))
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    const scene = result.database.listNodes(project.id).find((node) => node.type === 'scene')!
    const board = (await request(result.app).post(`/api/projects/${project.id}/scenes/${scene.id}/storyboard`).set('Cookie', auth).send({}).expect(201)).body
    await request(result.app).post(`/api/storyboards/${board.id}/cards`).set('Cookie', auth).send({ purpose: '人物入场', anchorIds: [anchor.id], assetHash: candidate.asset.contentHash }).expect(201)
    expect((await request(result.app).get(`/api/projects/${project.id}/storyboards`).set('Cookie', auth).expect(200)).body[0].cards).toHaveLength(1)
  })

  it('round-trips assets, accepted bindings and storyboards through normal backup', async () => {
    const result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'backup.sqlite'), production: false })); databases.push(result.database)
    const auth = await cookie(result.app); const project = result.database.createProject('视觉备份验收')
    const scene = result.database.listNodes(project.id).find((node) => node.type === 'scene')!
    const entity = result.database.createEntity({ projectId: project.id, type: 'character', canonicalName: '石青', summary: '蓝灰长袍', privacyLevel: 'normal' })
    const anchor = result.visuals.createAnchor(project.id, entity.id, ['canonicalName', 'summary'])
    const candidate = result.visuals.importCandidate(anchor.id, { fileName: 'shiqing.png', mimeType: 'image/png', contentBase64: pngBase64 })
    result.visuals.resolveCandidate(candidate.id, 'accepted')
    const board = result.visuals.getOrCreateStoryboard(project.id, scene.id)
    result.visuals.addStoryboardCard(board.id, { purpose: '远景建立', anchorIds: [anchor.id], assetHash: candidate.asset.contentHash })
    const archive = (await request(result.app).get(`/api/projects/${project.id}/backup`).set('Cookie', auth).expect(200)).body
    expect(archive.payload.visuals.assets[0].contentBase64).toBe(pngBase64)
    expect(JSON.stringify(archive.payload.visuals)).not.toContain('apiKey')
    const restored = (await request(result.app).post('/api/backups/restore').set('Cookie', auth).send(archive).expect(201)).body
    const restoredAnchor = result.visuals.listAnchors(restored.id)[0]
    expect(restoredAnchor).toMatchObject({ entityName: '石青', bindingStatus: 'current' })
    expect(result.visuals.listStoryboards(restored.id)[0]).toMatchObject({ cards: [{ purpose: '远景建立' }] })
  })
})
