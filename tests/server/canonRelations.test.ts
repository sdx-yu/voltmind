// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { getConfig } from '../../server/config.js'
import { AppDatabase } from '../../server/db.js'
import { SyncService } from '../../server/sync.js'

describe('2.3.0 canon relationship layer', () => {
  let dir: string
  const databases: AppDatabase[] = []
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-relations-')) })
  afterEach(() => { for (const database of databases) database.close(); databases.length = 0; fs.rmSync(dir, { recursive: true, force: true }) })
  function db(name: string) { const database = new AppDatabase(path.join(dir, `${name}.sqlite`)); databases.push(database); return database }

  it('stores flexible dossier fields and resolves relationship truth at two scenes', () => {
    const database = db('truth'); const project = database.createProject('关系真值')
    const chapter = database.listNodes(project.id).find((node) => node.type === 'chapter')!
    const first = database.listNodes(project.id).find((node) => node.type === 'scene')!
    const second = database.createNode({ projectId: project.id, parentId: chapter.id, type: 'scene', title: '第 40 章' })
    const lin = database.createEntity({ projectId: project.id, type: 'character', canonicalName: '林照' })
    const shen = database.createEntity({ projectId: project.id, type: 'character', canonicalName: '沈砚' })
    const field = database.createProfileField({ entityId: lin.id, category: '语言', label: '口头禅', value: '先看证据', privacyLevel: 'author_only' })
    expect(database.updateProfileField(field.id, { value: '证据先行' })).toMatchObject({ value: '证据先行' })
    const relationship = database.createRelationship({ projectId: project.id, sourceEntityId: lin.id, targetEntityId: shen.id, relationType: 'alliance', direction: 'mutual', label: '调查搭档', summary: '', privacyLevel: 'normal' })
    database.createRelationshipState({ relationshipId: relationship.id, statusLabel: '互相信任', note: '', validFromNodeId: first.id, validToNodeId: second.id, worldTimeFrom: null, worldTimeTo: null, sourceNodeId: first.id, evidence: '他们交换了钥匙' })
    database.createRelationshipState({ relationshipId: relationship.id, statusLabel: '暂时决裂', note: '隐瞒证据', validFromNodeId: second.id, validToNodeId: null, worldTimeFrom: null, worldTimeTo: null, sourceNodeId: second.id, evidence: '林照转身离开' })
    expect(database.listRelationships(project.id, lin.id, first.id)[0].currentState?.statusLabel).toBe('互相信任')
    expect(database.listRelationships(project.id, lin.id, second.id)[0].currentState?.statusLabel).toBe('暂时决裂')
    expect(() => database.createRelationshipState({ relationshipId: relationship.id, statusLabel: '重叠', note: '', validFromNodeId: first.id, validToNodeId: null, worldTimeFrom: null, worldTimeTo: null, sourceNodeId: null, evidence: '' })).toThrow(/overlap/)
    expect(() => database.createRelationship({ projectId: project.id, sourceEntityId: lin.id, targetEntityId: lin.id, relationType: 'custom', direction: 'mutual', label: '', summary: '', privacyLevel: 'normal' })).toThrow(/itself/)
  })

  it('keeps relationship candidates pending until the author accepts them', () => {
    const database = db('candidate'); const project = database.createProject('候选闭环'); const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    const a = database.createEntity({ projectId: project.id, type: 'character', canonicalName: '阿甲' }); const b = database.createEntity({ projectId: project.id, type: 'character', canonicalName: '阿乙' })
    const relationship = database.createRelationship({ projectId: project.id, sourceEntityId: a.id, targetEntityId: b.id, relationType: 'rivalry', direction: 'mutual', label: '竞争者', summary: '', privacyLevel: 'normal' })
    const candidate = database.createCandidate({ projectId: project.id, nodeId: scene.id, targetType: 'relationship_state', targetId: relationship.id, operation: 'set_state', before: null, after: { statusLabel: '暂时合作', note: '共同脱险' }, evidence: { quote: '两人同时拉住绳索' }, confidence: 0.91, sourceTaskId: null })
    expect(database.getRelationship(relationship.id)?.states).toHaveLength(0)
    database.resolveCandidate(candidate.id, 'accepted')
    expect(database.getRelationship(relationship.id)?.states[0]).toMatchObject({ statusLabel: '暂时合作', sourceNodeId: scene.id, evidence: '两人同时拉住绳索' })
    const chapter = database.listNodes(project.id).find((node) => node.type === 'chapter')!; const next = database.createNode({ projectId: project.id, parentId: chapter.id, type: 'scene', title: '场景 2' })
    const nextCandidate = database.createCandidate({ projectId: project.id, nodeId: next.id, targetType: 'relationship_state', targetId: relationship.id, operation: 'set_state', before: { statusLabel: '暂时合作' }, after: { statusLabel: '再次敌对' }, evidence: { quote: '两人分道扬镳' }, confidence: 0.88, sourceTaskId: null })
    database.resolveCandidate(nextCandidate.id, 'accepted')
    expect(database.getRelationship(relationship.id)?.states).toEqual([expect.objectContaining({ statusLabel: '暂时合作', validToNodeId: next.id }), expect.objectContaining({ statusLabel: '再次敌对', validFromNodeId: next.id })])
    expect(database.listProvenanceEvents(project.id).map((event) => event.eventType)).toEqual(expect.arrayContaining(['candidate_created', 'candidate_accepted']))
  })

  it('exposes current non-private relationships to AI and round-trips backup references', async () => {
    const result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'api.sqlite'), production: false })); databases.push(result.database)
    const cookie = (await request(result.app).post('/api/session')).headers['set-cookie'][0].split(';')[0]
    const project = result.database.createProject('上下文与备份'); const scene = result.database.listNodes(project.id).find((node) => node.type === 'scene')!
    const lin = result.database.createEntity({ projectId: project.id, type: 'character', canonicalName: '林照' }); const shen = result.database.createEntity({ projectId: project.id, type: 'character', canonicalName: '沈砚' }); const secret = result.database.createEntity({ projectId: project.id, type: 'character', canonicalName: '周隐' })
    result.database.saveScene(scene.id, doc('林照与沈砚走进旧宅。'), '林照与沈砚走进旧宅。')
    const publicRelation = result.database.createRelationship({ projectId: project.id, sourceEntityId: lin.id, targetEntityId: shen.id, relationType: 'friendship', direction: 'mutual', label: '旧友', summary: '', privacyLevel: 'normal' })
    result.database.createRelationshipState({ relationshipId: publicRelation.id, statusLabel: '互相信任', note: '', validFromNodeId: scene.id, validToNodeId: null, worldTimeFrom: null, worldTimeTo: null, sourceNodeId: scene.id, evidence: '并肩走进旧宅' })
    const privateRelation = result.database.createRelationship({ projectId: project.id, sourceEntityId: lin.id, targetEntityId: secret.id, relationType: 'debt', direction: 'directed', label: '秘密债务', summary: '', privacyLevel: 'local_private' })
    result.database.createRelationshipState({ relationshipId: privateRelation.id, statusLabel: '尚未偿还', note: '', validFromNodeId: scene.id, validToNodeId: null, worldTimeFrom: null, worldTimeTo: null, sourceNodeId: scene.id, evidence: '' })
    result.database.createProfileField({ entityId: lin.id, category: '身份', label: '职业', value: '调查员', privacyLevel: 'author_only' })
    const context = await request(result.app).get(`/api/projects/${project.id}/scenes/${scene.id}/context`).set('Cookie', cookie).expect(200)
    expect(context.body).toContainEqual(expect.objectContaining({ type: 'relationship', content: expect.stringContaining('互相信任') }))
    expect(context.body).toContainEqual(expect.objectContaining({ title: '林照档案 · 身份', content: '职业：调查员' }))
    expect(context.body.some((item: { content: string }) => item.content.includes('秘密债务'))).toBe(false)
    const backup = await request(result.app).get(`/api/projects/${project.id}/backup`).set('Cookie', cookie).expect(200)
    const restored = await request(result.app).post('/api/backups/restore').set('Cookie', cookie).send(backup.body).expect(201)
    const restoredEntities = result.database.listEntities(restored.body.id); const restoredLin = restoredEntities.find((item) => item.canonicalName === '林照')!
    const restoredRelation = result.database.listRelationships(restored.body.id, restoredLin.id)[0]
    expect(result.database.listProfileFields(restoredLin.id)[0]).toMatchObject({ label: '职业', value: '调查员' })
    expect(restoredEntities.find((item) => item.id === restoredRelation.targetEntityId)?.canonicalName).toBe('沈砚')
    expect(result.database.getNode(restoredRelation.states[0].sourceNodeId!)?.projectId).toBe(restored.body.id)
  })

  it('carries dossier and source-owned relationships through encrypted handoff', () => {
    const a = db('sync-a'); const project = a.createProject('关系接力'); const scene = a.listNodes(project.id).find((node) => node.type === 'scene')!
    const lin = a.createEntity({ projectId: project.id, type: 'character', canonicalName: '林照' }); const shen = a.createEntity({ projectId: project.id, type: 'character', canonicalName: '沈砚' })
    a.createProfileField({ entityId: lin.id, category: '背景', label: '故乡', value: '雾港', privacyLevel: 'author_only' })
    const relationship = a.createRelationship({ projectId: project.id, sourceEntityId: lin.id, targetEntityId: shen.id, relationType: 'friendship', direction: 'mutual', label: '旧友', summary: '', privacyLevel: 'normal' })
    a.createRelationshipState({ relationshipId: relationship.id, statusLabel: '重逢', note: '', validFromNodeId: scene.id, validToNodeId: null, worldTimeFrom: null, worldTimeTo: null, sourceNodeId: scene.id, evidence: '多年后重逢' })
    const syncA = new SyncService(a); const { recoveryPhrase } = syncA.initialize(project.id, 'A'); const transfer = syncA.exportPackage(project.id, recoveryPhrase)
    const b = db('sync-b'); new SyncService(b).importPackage(transfer, recoveryPhrase, 'B')
    expect(b.listProfileFields(lin.id)[0]).toMatchObject({ label: '故乡', value: '雾港' })
    expect(b.listRelationships(project.id, lin.id, scene.id)[0]).toMatchObject({ label: '旧友', currentState: expect.objectContaining({ statusLabel: '重逢' }) })
  })
})

function doc(text: string) { return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }
