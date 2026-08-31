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

  it('runs project, scene, search and mock AI flow', async () => {
    const project = (await request(app).post('/api/projects').set('Cookie', cookie).send({ title: '验收项目' }).expect(201)).body
    const nodes = (await request(app).get(`/api/projects/${project.id}/tree`).set('Cookie', cookie).expect(200)).body
    const scene = nodes.find((node: { type: string }) => node.type === 'scene')
    await request(app).put(`/api/scenes/${scene.id}`).set('Cookie', cookie).send({ contentJson: doc('林照走进雨里'), plainText: '林照走进雨里' }).expect(200)
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
    database.saveScene(scene.id, doc('第一版'), '第一版'); database.saveScene(scene.id, doc('第二版林照'), '第二版林照')
    database.createMention({ entityId: entity.id, nodeId: scene.id, quote: '林照', startOffset: 3, endOffset: 5, confirmed: true })
    const clue = database.createForeshadow({ projectId: project.id, title: '旧信封蜡', nodeId: scene.id, evidence: '蜡印缺了一角' })
    database.transitionForeshadow(clue.id, { action: 'reinforced', nodeId: scene.id, evidence: '第二封信也是同样缺口' })
    const secret = database.createKnowledgeFact({ projectId: project.id, title: '密信落款', detail: '沈砚写了密信', keywords: ['沈砚写了密信'], firstRevealedNodeId: scene.id })
    database.grantKnowledge(secret.id, { entityId: entity.id, knownFromNodeId: scene.id, evidence: '林照看见落款' })
    database.setSetting(project.id, 'dailyGoal', 1234)
    const backup = await request(app).get(`/api/projects/${project.id}/backup`).set('Cookie', cookie).expect(200)
    const restored = await request(app).post('/api/backups/restore').set('Cookie', cookie).send(backup.body).expect(201)
    expect(restored.body.title).toBe('原项目（恢复）')
    expect(database.listProjects()).toHaveLength(2)
    const restoredScene = database.listNodes(restored.body.id).find((node) => node.type === 'scene')!
    expect(database.getScene(restoredScene.id)?.plainText).toBe('第二版林照')
    expect(database.listRevisions(restoredScene.id)).toHaveLength(2)
    expect(database.listMentions(restoredScene.id)[0]?.quote).toBe('林照')
    expect(database.listForeshadows(restored.body.id)[0]).toMatchObject({ title: '旧信封蜡', status: 'reinforced' })
    expect(database.listForeshadows(restored.body.id)[0].events).toHaveLength(2)
    expect(database.listKnowledgeFacts(restored.body.id)[0]).toMatchObject({ title: '密信落款', keywords: ['沈砚写了密信'] })
    expect(database.listKnowledgeFacts(restored.body.id)[0].grants).toHaveLength(1)
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
    const completed = await request(app).post(`/api/scenes/${scene.id}/complete`).set('Cookie', cookie).send({}).expect(200)
    expect(completed.body.candidates[0]).toMatchObject({ targetId: item.id, evidence: { quote: '把佩剑交给林照' } })
    expect(database.getNode(scene.id)?.status).toBe('complete')
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
