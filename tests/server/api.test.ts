// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../server/app.js'
import { getConfig } from '../../server/config.js'
import type { AppDatabase } from '../../server/db.js'

describe('local API', () => {
  let dir: string
  let app: ReturnType<typeof createApp>['app']
  let database: AppDatabase
  let cookie: string

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-api-'))
    const result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'api.sqlite'), production: false }))
    app = result.app; database = result.database
    const session = await request(app).post('/api/session')
    cookie = session.headers['set-cookie'][0].split(';')[0]
  })
  afterEach(() => { vi.restoreAllMocks(); database.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('rejects mutations without a local session', async () => {
    await request(app).post('/api/projects').send({ title: '拒绝' }).expect(401)
    await request(app).post('/api/session').set('Origin', 'https://malicious.example').expect(403)
  })

  it('renames a novel and its manuscript root through the project API', async () => {
    const project = (await request(app).post('/api/projects').set('Cookie', cookie).send({ title: '旧书名' }).expect(201)).body
    const updated = await request(app).patch(`/api/projects/${project.id}`).set('Cookie', cookie).send({ title: '新书名', description: '新的简介' }).expect(200)
    expect(updated.body).toMatchObject({ title: '新书名', description: '新的简介' })
    expect(database.listNodes(project.id).find((node) => node.type === 'book')?.title).toBe('新书名')
  })

  it('creates and edits a guided story blueprint without generating manuscript chapters', async () => {
    const created = await request(app).post('/api/projects').set('Cookie', cookie).send({ title: '归航', blueprint: { approach: 'guided', premise: '一个逃亡者必须回到故乡。', endingState: '旧港获得新的秩序。' }, starter: 'three_act' }).expect(201)
    const nodes = database.listNodes(created.body.id)
    expect(nodes.map((node) => node.type)).toEqual(['book', 'chapter', 'scene'])
    const plan = await request(app).get(`/api/projects/${created.body.id}/story-plan`).set('Cookie', cookie).expect(200)
    expect(plan.body.beats).toHaveLength(9)
    expect(plan.body.blueprint.premise).toBe('一个逃亡者必须回到故乡。')
    const beat = plan.body.beats[0]
    await request(app).patch(`/api/story-beats/${beat.id}`).set('Cookie', cookie).send({ status: 'drafting', sceneIds: [nodes.find((node) => node.type === 'scene')!.id] }).expect(200)
    const context = await request(app).get(`/api/projects/${created.body.id}/scenes/${nodes.find((node) => node.type === 'scene')!.id}/context`).set('Cookie', cookie).expect(200)
    expect(context.body).toContainEqual(expect.objectContaining({ type: 'blueprint', title: '故事蓝图' }))
    expect(context.body).toContainEqual(expect.objectContaining({ type: 'beat', title: `当前节拍：${beat.title}` }))
  })

  it('exposes project trash summaries and restores selected projects atomically', async () => {
    const first = database.createProject('雾港来信', '海雾里的旧案')
    const initial = database.listNodes(first.id); const book = initial.find((node) => node.type === 'book')!
    const chapter = database.createNode({ projectId: first.id, parentId: book.id, type: 'chapter', title: '第二章' })
    const scene = database.createNode({ projectId: first.id, parentId: chapter.id, type: 'scene', title: '雨夜' })
    database.saveScene(scene.id, doc('雨落 three'), '雨落 three')
    const second = database.createProject('旧城来客')

    await request(app).delete(`/api/projects/${first.id}`).set('Cookie', cookie).expect(200)
    await request(app).delete(`/api/projects/${second.id}`).set('Cookie', cookie).expect(200)
    database.db.prepare('UPDATE projects SET deleted_at=? WHERE id=?').run('2026-09-03T09:00:00.000Z', first.id)
    database.db.prepare('UPDATE projects SET deleted_at=? WHERE id=?').run('2026-09-03T10:00:00.000Z', second.id)

    const trash = await request(app).get('/api/projects/trash').set('Cookie', cookie).expect(200)
    expect(trash.body.map((project: { id: string }) => project.id)).toEqual([second.id, first.id])
    expect(trash.body[1]).toMatchObject({ title: '雾港来信', chapterCount: 2, sceneCount: 2, wordCount: 3, deletedAt: '2026-09-03T09:00:00.000Z' })
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM operation_log WHERE project_id=? AND operation='trash'").get(first.id)).toMatchObject({ count: 1 })

    await request(app).post('/api/projects/trash/restore').set('Cookie', cookie).send({ ids: [first.id, second.id] }).expect(200)
    expect(database.listProjects().map((project) => project.id)).toEqual(expect.arrayContaining([first.id, second.id]))
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM operation_log WHERE project_id=? AND operation='restore'").get(first.id)).toMatchObject({ count: 1 })

    await request(app).delete(`/api/projects/${first.id}`).set('Cookie', cookie).expect(200)
    await request(app).post('/api/projects/trash/restore').set('Cookie', cookie).send({ ids: [first.id, 'missing'] }).expect(409)
    expect(database.getProject(first.id)?.deletedAt).not.toBeNull()
    await request(app).post(`/api/projects/${first.id}/restore`).set('Cookie', cookie).expect(200)
    await request(app).post(`/api/projects/${first.id}/restore`).set('Cookie', cookie).expect(409)
  })

  it('runs project, scene, search and mock AI flow', async () => {
    const project = (await request(app).post('/api/projects').set('Cookie', cookie).send({ title: '验收项目' }).expect(201)).body
    const nodes = (await request(app).get(`/api/projects/${project.id}/tree`).set('Cookie', cookie).expect(200)).body
    const scene = nodes.find((node: { type: string }) => node.type === 'scene')
    database.createEntity({ projectId: project.id, type: 'character', canonicalName: '林照' })
    await request(app).put(`/api/scenes/${scene.id}`).set('Cookie', cookie).send({ contentJson: doc('林照走进雨里'), plainText: '林照走进雨里' }).expect(200)
    const detections = await request(app).get(`/api/scenes/${scene.id}/canon-detections`).set('Cookie', cookie).expect(200)
    expect(detections.body).toContainEqual(expect.objectContaining({ canonicalName: '林照', entityType: 'character', occurrenceCount: 1 }))
    const search = await request(app).get(`/api/projects/${project.id}/search?q=${encodeURIComponent('雨里')}`).set('Cookie', cookie).expect(200)
    expect(search.body[0].nodeId).toBe(scene.id)
    const context = await request(app).get(`/api/projects/${project.id}/scenes/${scene.id}/context`).set('Cookie', cookie).expect(200)
    const task = await request(app).post('/api/ai/tasks').set('Cookie', cookie).send({ projectId: project.id, nodeId: scene.id, taskType: 'brainstorm', instruction: '', selectedContextIds: context.body.map((item: { id: string }) => item.id) }).expect(200)
    expect(task.body.output).toContain('方向一')
  })

  it('backs up and restores as a new project', async () => {
    const project = (await request(app).post('/api/projects').set('Cookie', cookie).send({ title: '原项目' })).body
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    const entity = database.createEntity({ projectId: project.id, type: 'character', canonicalName: '林照' })
    database.saveScene(scene.id, doc('第一版'), '第一版'); database.saveScene(scene.id, doc('第二版林照'), '第二版林照'); database.updateNode(scene.id, { status: 'complete' })
    database.createMention({ entityId: entity.id, nodeId: scene.id, quote: '林照', startOffset: 3, endOffset: 5, confirmed: true })
    const clue = database.createForeshadow({ projectId: project.id, title: '旧信封蜡', nodeId: scene.id, evidence: '蜡印缺了一角' })
    database.transitionForeshadow(clue.id, { action: 'reinforced', nodeId: scene.id, evidence: '第二封信也是同样缺口' })
    const secret = database.createKnowledgeFact({ projectId: project.id, title: '密信落款', detail: '沈砚写了密信', keywords: ['沈砚写了密信'], firstRevealedNodeId: scene.id })
    database.grantKnowledge(secret.id, { entityId: entity.id, knownFromNodeId: scene.id, evidence: '林照看见落款' })
    database.updateStoryBlueprint(project.id, { approach: 'guided', premise: '林照必须查明密信来源。', endingState: '真相公开，但同盟破裂。' })
    const beat = database.createStoryBeat({ projectId: project.id, act: 'ending', title: '公开真相', purpose: '让选择产生代价', sceneIds: [scene.id] })
    database.setSetting(project.id, 'dailyGoal', 1234)
    const backup = await request(app).get(`/api/projects/${project.id}/backup`).set('Cookie', cookie).expect(200)
    const restored = await request(app).post('/api/backups/restore').set('Cookie', cookie).send(backup.body).expect(201)
    expect(restored.body.title).toBe('原项目（恢复）')
    expect(database.listProjects()).toHaveLength(2)
    const restoredScene = database.listNodes(restored.body.id).find((node) => node.type === 'scene')!
    expect(database.getScene(restoredScene.id)?.plainText).toBe('第二版林照')
    expect(restoredScene.status).toBe('complete')
    expect(database.listRevisions(restoredScene.id)).toHaveLength(2)
    expect(database.listMentions(restoredScene.id)[0]?.quote).toBe('林照')
    expect(database.listForeshadows(restored.body.id)[0]).toMatchObject({ title: '旧信封蜡', status: 'reinforced' })
    expect(database.listForeshadows(restored.body.id)[0].events).toHaveLength(2)
    expect(database.listKnowledgeFacts(restored.body.id)[0]).toMatchObject({ title: '密信落款', keywords: ['沈砚写了密信'] })
    expect(database.listKnowledgeFacts(restored.body.id)[0].grants).toHaveLength(1)
    expect(database.getStoryPlan(restored.body.id)?.blueprint).toMatchObject({ premise: '林照必须查明密信来源。', endingState: '真相公开，但同盟破裂。' })
    expect(database.getStoryPlan(restored.body.id)?.beats[0]).toMatchObject({ title: beat.title, sceneIds: [restoredScene.id] })
    expect(database.getSetting(restored.body.id, 'dailyGoal', 0)).toBe(1234)
    await request(app).post('/api/backups/restore').set('Cookie', cookie).send({ ...backup.body, checksum: '0'.repeat(64) }).expect(400)
    expect(database.listProjects()).toHaveLength(2)
  })

  it('runs foreshadow API transitions and exposes unresolved clues to AI context', async () => {
    const project = database.createProject('线索流')
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    const created = await request(app).post(`/api/projects/${project.id}/foreshadows`).set('Cookie', cookie).send({ title: '空白车票', importance: 'high', nodeId: scene.id, evidence: '车票没有终点站' }).expect(201)
    await request(app).post(`/api/foreshadows/${created.body.id}/transitions`).set('Cookie', cookie).send({ action: 'reinforced', nodeId: scene.id, evidence: '票背出现同一编号' }).expect(200)
    const list = await request(app).get(`/api/projects/${project.id}/foreshadows`).set('Cookie', cookie).expect(200)
    expect(list.body[0]).toMatchObject({ title: '空白车票', status: 'reinforced' })
    expect(list.body[0].events).toHaveLength(2)
    const context = await request(app).get(`/api/projects/${project.id}/scenes/${scene.id}/context`).set('Cookie', cookie).expect(200)
    expect(context.body).toContainEqual(expect.objectContaining({ type: 'foreshadow', title: '未回收伏笔：空白车票' }))
  })

  it('checks POV knowledge by narrative order and only sends known facts to AI context', async () => {
    const project = database.createProject('视角知识'); const initial = database.listNodes(project.id); const chapter = initial.find((node) => node.type === 'chapter')!; const first = initial.find((node) => node.type === 'scene')!; const second = database.createNode({ projectId: project.id, parentId: chapter.id, type: 'scene', title: '场景 2' })
    const lin = database.createEntity({ projectId: project.id, type: 'character', canonicalName: '林照' })
    database.updateNode(first.id, { povEntityId: lin.id }); database.updateNode(second.id, { povEntityId: lin.id })
    database.saveScene(first.id, doc('她终于知道，沈砚是凶手。'), '她终于知道，沈砚是凶手。')
    database.saveScene(second.id, doc('沈砚是凶手。'), '沈砚是凶手。')
    const created = await request(app).post(`/api/projects/${project.id}/knowledge`).set('Cookie', cookie).send({ title: '凶手身份', detail: '凶手是沈砚', keywords: ['沈砚是凶手'], firstRevealedNodeId: second.id, privacyLevel: 'author_only' }).expect(201)
    await request(app).put(`/api/knowledge/${created.body.id}/grants/${lin.id}`).set('Cookie', cookie).send({ knownFromNodeId: second.id, sourceNodeId: second.id, evidence: '林照读到密信' }).expect(200)
    const earlyCheck = await request(app).get(`/api/scenes/${first.id}/check`).set('Cookie', cookie).expect(200)
    expect(earlyCheck.body).toContainEqual(expect.objectContaining({ rule: 'pov_knowledge_leak', currentEvidence: expect.objectContaining({ quote: '她终于知道，沈砚是凶手。' }) }))
    const earlyContext = await request(app).get(`/api/projects/${project.id}/scenes/${first.id}/context`).set('Cookie', cookie).expect(200)
    const lateContext = await request(app).get(`/api/projects/${project.id}/scenes/${second.id}/context`).set('Cookie', cookie).expect(200)
    expect(earlyContext.body.some((item: { type: string }) => item.type === 'knowledge')).toBe(false)
    expect(lateContext.body).toContainEqual(expect.objectContaining({ type: 'knowledge', title: 'POV 已知：凶手身份' }))
  })

  it('hides a trashed character from every consumer while preserving references for restore', async () => {
    const project = database.createProject('软删除引用闭环'); const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    const lin = database.createEntity({ projectId: project.id, type: 'character', canonicalName: '林照' }); const shen = database.createEntity({ projectId: project.id, type: 'character', canonicalName: '沈砚' })
    database.updateNode(scene.id, { povEntityId: lin.id })
    database.saveScene(scene.id, doc('林照与沈砚走进旧宅。'), '林照与沈砚走进旧宅。')
    const mention = database.createMention({ entityId: lin.id, nodeId: scene.id, quote: '林照', startOffset: 0, endOffset: 2, confirmed: true })
    database.createProfileField({ entityId: lin.id, category: '身份', label: '职业', value: '调查员', privacyLevel: 'author_only' })
    const relationship = database.createRelationship({ projectId: project.id, sourceEntityId: lin.id, targetEntityId: shen.id, relationType: 'friendship', direction: 'mutual', label: '旧友', summary: '', privacyLevel: 'normal' })
    database.createRelationshipState({ relationshipId: relationship.id, statusLabel: '互相信任', note: '', validFromNodeId: scene.id, validToNodeId: null, worldTimeFrom: null, worldTimeTo: null, sourceNodeId: scene.id, evidence: '并肩进入旧宅' })
    const secret = database.createKnowledgeFact({ projectId: project.id, title: '暗门位置', detail: '暗门在书架后', keywords: ['暗门在书架后'], firstRevealedNodeId: scene.id })
    database.grantKnowledge(secret.id, { entityId: lin.id, knownFromNodeId: scene.id, evidence: '林照亲眼看见' })

    const before = await request(app).get(`/api/projects/${project.id}/scenes/${scene.id}/context`).set('Cookie', cookie).expect(200)
    expect(before.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: lin.id, type: 'entity' }),
      expect.objectContaining({ id: `relationship:${relationship.id}`, type: 'relationship' }),
      expect.objectContaining({ id: `knowledge:${secret.id}`, type: 'knowledge' }),
    ]))

    await request(app).delete(`/api/entities/${lin.id}`).set('Cookie', cookie).expect(200)
    await request(app).patch(`/api/nodes/${scene.id}`).set('Cookie', cookie).send({ title: '删除后仍可写作' }).expect(200)
    await request(app).put(`/api/scenes/${scene.id}`).set('Cookie', cookie).send({ contentJson: doc('雨中，林照与沈砚走进旧宅。'), plainText: '雨中，林照与沈砚走进旧宅。' }).expect(200)

    expect((await request(app).get(`/api/scenes/${scene.id}/mentions`).set('Cookie', cookie).expect(200)).body).toEqual([])
    expect((await request(app).get(`/api/entities/${lin.id}/mentions`).set('Cookie', cookie).expect(200)).body).toEqual([])
    expect((await request(app).get(`/api/projects/${project.id}/relationships`).set('Cookie', cookie).expect(200)).body).toEqual([])
    expect(database.getNode(scene.id)?.povEntityId).toBe(lin.id)
    expect(database.listMentions(scene.id, true)).toContainEqual(expect.objectContaining({ id: mention.id, startOffset: 3, endOffset: 5 }))
    expect(database.listRelationships(project.id, lin.id, null, true)).toContainEqual(expect.objectContaining({ id: relationship.id }))
    const hiddenContext = await request(app).get(`/api/projects/${project.id}/scenes/${scene.id}/context`).set('Cookie', cookie).expect(200)
    expect(hiddenContext.body.some((item: { id: string }) => item.id === lin.id || item.id === `relationship:${relationship.id}` || item.id === `knowledge:${secret.id}` || item.id.startsWith('profile:'))).toBe(false)
    await request(app).patch(`/api/nodes/${scene.id}`).set('Cookie', cookie).send({ povEntityId: lin.id }).expect(400)
    await request(app).post(`/api/scenes/${scene.id}/mentions`).set('Cookie', cookie).send({ entityId: lin.id, quote: '林照', startOffset: 3, endOffset: 5, confirmed: true }).expect(400)

    await request(app).post(`/api/entities/${lin.id}/restore`).set('Cookie', cookie).expect(200)
    expect((await request(app).get(`/api/scenes/${scene.id}/mentions`).set('Cookie', cookie).expect(200)).body).toContainEqual(expect.objectContaining({ id: mention.id, startOffset: 3, endOffset: 5 }))
    expect((await request(app).get(`/api/projects/${project.id}/relationships`).set('Cookie', cookie).expect(200)).body).toContainEqual(expect.objectContaining({ id: relationship.id }))
    const restoredContext = await request(app).get(`/api/projects/${project.id}/scenes/${scene.id}/context`).set('Cookie', cookie).expect(200)
    expect(restoredContext.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: lin.id, type: 'entity' }),
      expect.objectContaining({ id: `relationship:${relationship.id}`, type: 'relationship' }),
      expect.objectContaining({ id: `knowledge:${secret.id}`, type: 'knowledge' }),
    ]))
  })

  it('imports all chapters atomically and rejects a corrupt original without a project', async () => {
    const original = Buffer.from('第一章\n正文')
    const input = { title: '旧稿', chapters: [{ title: '第一章', text: '正文', contentJson: doc('正文') }], original: { fileName: '旧稿.txt', mimeType: 'text/plain', byteSize: original.length, contentHash: (await import('node:crypto')).createHash('sha256').update(original).digest('hex'), contentBase64: original.toString('base64') } }
    const imported = await request(app).post('/api/import').set('Cookie', cookie).send(input).expect(201)
    expect(database.listNodes(imported.body.id).filter((node) => node.type === 'chapter')).toHaveLength(1)
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM imported_sources WHERE project_id=?').get(imported.body.id)).toMatchObject({ count: 1 })
    await request(app).post('/api/import').set('Cookie', cookie).send({ ...input, title: '损坏稿', original: { ...input.original, contentHash: '0'.repeat(64) } }).expect(422)
    expect(database.listProjects().map((project) => project.title)).not.toContain('损坏稿')
  })

  it('completes a scene into an evidence-backed fact candidate and persists ignored checks', async () => {
    const project = database.createProject('事实闭环'); const nodes = database.listNodes(project.id); const scene = nodes.find((node) => node.type === 'scene')!
    database.createEntity({ projectId: project.id, type: 'character', canonicalName: '沈砚' }); const item = database.createEntity({ projectId: project.id, type: 'item', canonicalName: '佩剑' }); database.createEntity({ projectId: project.id, type: 'character', canonicalName: '林照' })
    database.saveScene(scene.id, doc('沈砚把佩剑交给林照。'), '沈砚把佩剑交给林照。')
    await request(app).patch(`/api/nodes/${scene.id}`).set('Cookie', cookie).send({ status: 'complete' }).expect(400)
    const completed = await request(app).post(`/api/scenes/${scene.id}/complete`).set('Cookie', cookie).send({}).expect(200)
    expect(completed.body.candidates[0]).toMatchObject({ targetId: item.id, evidence: { quote: '把佩剑交给林照' } })
    expect(database.getNode(scene.id)?.status).toBe('complete')
    const unchanged = await request(app).put(`/api/scenes/${scene.id}`).set('Cookie', cookie).send({ contentJson: doc('沈砚把佩剑交给林照。'), plainText: '沈砚把佩剑交给林照。' }).expect(200)
    expect(unchanged.body.node.status).toBe('complete')
    await request(app).post(`/api/scenes/${scene.id}/complete`).set('Cookie', cookie).send({}).expect(409)
    const revised = await request(app).put(`/api/scenes/${scene.id}`).set('Cookie', cookie).send({ contentJson: doc('沈砚把佩剑重新交给林照。'), plainText: '沈砚把佩剑重新交给林照。' }).expect(200)
    expect(revised.body.document.plainText).toBe('沈砚把佩剑重新交给林照。')
    expect(revised.body.node.status).toBe('revising')
    expect(database.getNode(scene.id)?.status).toBe('revising')
  })

  it('exports selectable chapter ranges in TXT, Markdown and readable DOCX', async () => {
    const project = database.createProject('导出书'); const nodes = database.listNodes(project.id); const book = nodes.find((node) => node.type === 'book')!; const firstChapter = nodes.find((node) => node.type === 'chapter')!; const firstScene = nodes.find((node) => node.type === 'scene')!
    database.updateNode(firstChapter.id, { title: '第一章 起风' }); database.saveScene(firstScene.id, doc('第一章正文'), '第一章正文')
    const secondChapter = database.createNode({ projectId: project.id, parentId: book.id, type: 'chapter', title: '第二章 落雨' }); const secondScene = database.createNode({ projectId: project.id, parentId: secondChapter.id, type: 'scene', title: '正文' }); database.saveScene(secondScene.id, doc('第二章正文'), '第二章正文')
    const txt = await request(app).get(`/api/projects/${project.id}/export?format=txt&chapters=${firstChapter.id}`).set('Cookie', cookie).expect(200)
    expect(txt.text).toContain('第一章 起风'); expect(txt.text).not.toContain('第二章正文')
    const markdown = await request(app).get(`/api/projects/${project.id}/export?format=md&template=submission`).set('Cookie', cookie).expect(200)
    expect(markdown.text).toContain('# 导出书'); expect(markdown.text).toContain('# 第二章 落雨')
    const docxResponse = await request(app).get(`/api/projects/${project.id}/export?format=docx`).set('Cookie', cookie).buffer(true).parse(binaryParser).expect(200)
    const mammoth = await import('mammoth'); const extracted = await mammoth.default.extractRawText({ buffer: docxResponse.body as Buffer })
    expect(extracted.value).toContain('第一章正文'); expect(extracted.value).toContain('第二章正文')
  })

  it('enforces a zero-cost local-only AI boundary and needs no provider key', async () => {
    await request(app).put('/api/ai/settings').set('Cookie', cookie).send({ baseUrl: 'https://paid.example/v1', model: 'paid-model', apiKey: 'super-secret-key' }).expect(400)
    await request(app).put('/api/ai/settings').set('Cookie', cookie).send({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3.5:4b', apiKey: 'should-be-discarded' }).expect(200)
    const row = database.db.prepare('SELECT encrypted_api_key FROM ai_settings WHERE id=1').get() as { encrypted_api_key: string }
    expect(row.encrypted_api_key).toBe('')
    const response = await request(app).get('/api/ai/settings').set('Cookie', cookie).expect(200)
    expect(response.body).toMatchObject({ provider: 'ollama', costPolicy: 'local_only', hasApiKey: false })

    const project = database.createProject('本地上下文限额'); const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    database.saveScene(scene.id, doc('长夜无声。'.repeat(20_000)), '长夜无声。'.repeat(20_000))
    const context = await request(app).get(`/api/projects/${project.id}/scenes/${scene.id}/context`).set('Cookie', cookie).expect(200)
    expect(context.body.reduce((sum: number, item: { estimatedTokens: number }) => sum + item.estimatedTokens, 0)).toBeLessThanOrEqual(7_800)
    expect(context.body[0].estimatedTokens).toBeLessThanOrEqual(5_000)

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'qwen3.5:4b' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const test = await request(app).post('/api/ai/test').set('Cookie', cookie).send({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3.5:4b', apiKey: '' }).expect(200)
    expect(test.body).toMatchObject({ ok: true })
    expect(test.body.message).toContain('不会产生 API 费用')
  })

  it('streams local AI progress and completes the existing provenance task contract', async () => {
    await request(app).put('/api/ai/settings').set('Cookie', cookie).send({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3.5:4b', apiKey: '' }).expect(200)
    const project = database.createProject('流式生成'); const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    database.saveScene(scene.id, doc('雨落在窗前。'), '雨落在窗前。')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response([
      JSON.stringify({ message: { content: '方向一：' }, done: false }),
      JSON.stringify({ message: { content: '追查旧线索。' }, done: false }),
      JSON.stringify({ message: { content: '' }, done: true }),
    ].join('\n') + '\n', { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }))
    const context = database.listNodes(project.id).filter((node) => node.type === 'scene').map((node) => node.id)
    const response = await request(app).post('/api/ai/tasks/stream').set('Cookie', cookie).send({ projectId: project.id, nodeId: scene.id, taskType: 'brainstorm', instruction: '', selectedContextIds: context }).expect(200)
    const events = response.text.trim().split('\n').map((line) => JSON.parse(line))
    expect(events).toContainEqual(expect.objectContaining({ type: 'status', stage: 'loading_model' }))
    expect(events.filter((event) => event.type === 'delta').map((event) => event.delta).join('')).toBe('方向一：追查旧线索。')
    expect(events.at(-1)).toMatchObject({ type: 'complete', result: { model: 'qwen3.5:4b', output: '方向一：追查旧线索。' } })
    expect(database.db.prepare('SELECT status FROM ai_tasks ORDER BY created_at DESC LIMIT 1').get()).toMatchObject({ status: 'completed' })
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(requestBody).toMatchObject({ stream: true, think: false, keep_alive: '10m', options: { num_ctx: 6144, num_predict: 320 } })
  })

  it('keeps an empty current scene selectable for local brainstorming', async () => {
    await request(app).put('/api/ai/settings').set('Cookie', cookie).send({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3.5:4b', apiKey: '' }).expect(200)
    const project = database.createProject('空白开篇'); const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    const context = await request(app).get(`/api/projects/${project.id}/scenes/${scene.id}/context`).set('Cookie', cookie).expect(200)
    expect(context.body).toContainEqual(expect.objectContaining({ id: scene.id, type: 'scene', selected: true, content: '（当前场景暂无正文）' }))
  })
})

function doc(text: string) { return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }
function binaryParser(response: any, callback: (error: Error | null, body?: Buffer) => void) { const chunks: Buffer[] = []; response.on('data', (chunk: unknown) => chunks.push(Buffer.from(chunk as ArrayBuffer))); response.on('end', () => callback(null, Buffer.concat(chunks))); response.on('error', (error: Error) => callback(error)) }
