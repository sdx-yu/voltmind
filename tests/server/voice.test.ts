// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { getConfig } from '../../server/config.js'
import type { AppDatabase } from '../../server/db.js'

describe('scene voice profiles', () => {
  let dir: string
  let app: ReturnType<typeof createApp>['app']
  let database: AppDatabase
  let cookie: string

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-voice-'))
    const result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'voice.sqlite'), production: false }))
    app = result.app
    database = result.database
    cookie = (await request(app).post('/api/session')).headers['set-cookie'][0].split(';')[0]
  })
  afterEach(() => { database.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('inherits a previous scene profile, then injects the authored contract into polish and beat', async () => {
    const project = database.createProject('文风之书')
    const nodes = database.listNodes(project.id)
    const chapter = nodes.find((node) => node.type === 'chapter')!
    const first = nodes.find((node) => node.type === 'scene')!
    const second = database.createNode({ projectId: project.id, parentId: chapter.id, type: 'scene', title: '第二场', sortKey: first.sortKey + 1000 })

    const unset = await request(app).get(`/api/projects/${project.id}/scenes/${first.id}/voice`).set('Cookie', cookie).expect(200)
    expect(unset.body).toMatchObject({ source: 'default', inherited: true, register: 'balanced' })

    const saved = await request(app).put(`/api/projects/${project.id}/scenes/${first.id}/voice`).set('Cookie', cookie).send({
      register: 'literary', sentence: 'short', slang: 'avoid', authorNote: '这场要冷、慢，不解释法术。',
    }).expect(200)
    expect(saved.body).toMatchObject({ source: 'scene', inherited: false, register: 'literary', authorNote: '这场要冷、慢，不解释法术。' })

    const inherited = await request(app).get(`/api/projects/${project.id}/scenes/${second.id}/voice`).set('Cookie', cookie).expect(200)
    expect(inherited.body).toMatchObject({ source: 'previous', inherited: true, register: 'literary', authorNote: '这场要冷、慢，不解释法术。' })

    database.createStyleSample({ projectId: project.id, actorProjectId: project.id, title: '克制短句', content: '雨停了。他没有回头。门在身后合上。', guidance: '学停顿，不抄雨和门', privacyLevel: 'normal' })
    database.saveScene(first.id, doc('林照站在廊下。'), '林照站在廊下。')

    const context = await request(app).get(`/api/projects/${project.id}/scenes/${second.id}/context`).set('Cookie', cookie).expect(200)
    const voice = context.body.find((item: { type: string }) => item.type === 'voice')
    expect(voice).toMatchObject({ selected: true, title: '本场景文风档 · 沿用上一场' })
    expect(voice.content).toContain('作者原话（最高优先级，比上面的旋钮更重要）')
    expect(voice.content).toContain('这场要冷、慢，不解释法术。')
    expect(voice.content).toContain('学停顿，不抄雨和门')
    expect(voice.content).toContain('雨停了。他没有回头。')
    expect(voice.content).toContain('不要模仿任何在世作者的名字或作品标题。')

    const polish = await request(app).post('/api/ai/tasks').set('Cookie', cookie).send({
      projectId: project.id, nodeId: second.id, taskType: 'polish', instruction: '沈砚少说话', selectedContextIds: [second.id],
    }).expect(200)
    expect(polish.body.output).toMatch(/润色|思路|文风档/)

    const beat = await request(app).post('/api/ai/tasks').set('Cookie', cookie).send({
      projectId: project.id, nodeId: second.id, taskType: 'beat', instruction: '只把门关上', selectedContextIds: [second.id],
    }).expect(200)
    expect(beat.body.output.length).toBeGreaterThan(0)
  })

  it('uses the book default when no scene has its own profile', async () => {
    const project = database.createProject('默认文风')
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    await request(app).put(`/api/projects/${project.id}/voice-default`).set('Cookie', cookie).send({
      register: 'vernacular', dialogue: 'heavy', authorNote: '对白推进，少写风景。',
    }).expect(200)
    const profile = await request(app).get(`/api/projects/${project.id}/scenes/${scene.id}/voice`).set('Cookie', cookie).expect(200)
    expect(profile.body).toMatchObject({ source: 'project', inherited: true, register: 'vernacular', dialogue: 'heavy', authorNote: '对白推进，少写风景。' })
  })

  it('generates selection candidates only against the exact saved source', async () => {
    const project = database.createProject('选区改写')
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    const saved = database.saveScene(scene.id, doc('他没有回答，只把手收回袖中。'), '他没有回答，只把手收回袖中。')
    const selection = {
      nodeId: scene.id, sourceContentHash: saved.contentHash, startOffset: 6, endOffset: 13,
      originalText: '只把手收回袖中', contextBefore: '他没有回答，', contextAfter: '。',
    }
    const generated = await request(app).post('/api/ai/tasks').set('Cookie', cookie).send({
      projectId: project.id, nodeId: scene.id, taskType: 'style_rewrite', instruction: '更克制', selectedContextIds: [scene.id], selectionAnchor: selection,
    }).expect(200)
    expect(generated.body.output).toContain('候选一')

    database.saveScene(scene.id, doc('他最终回答，只把手收回袖中。'), '他最终回答，只把手收回袖中。')
    const stale = await request(app).post('/api/ai/tasks').set('Cookie', cookie).send({
      projectId: project.id, nodeId: scene.id, taskType: 'style_rewrite', instruction: '', selectedContextIds: [scene.id], selectionAnchor: selection,
    }).expect(409)
    expect(stale.body.error).toMatch(/选区|变化/)
  })

  it('round-trips scene and project voice through backup restore', async () => {
    const project = database.createProject('备份文风')
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    database.saveProjectVoiceDefault(project.id, { register: 'literary', authorNote: '全书先冷。' })
    database.saveVoiceProfile(project.id, scene.id, { register: 'vernacular', authorNote: '这场改白话。' })
    const backup = await request(app).get(`/api/projects/${project.id}/backup`).set('Cookie', cookie).expect(200)
    expect(backup.body.payload.voice.projectDefault).toMatchObject({ register: 'literary', authorNote: '全书先冷。' })
    expect(backup.body.payload.voice.profiles[0]).toMatchObject({ nodeId: scene.id, authorNote: '这场改白话。' })

    const restored = await request(app).post('/api/backups/restore').set('Cookie', cookie).send(backup.body).expect(201)
    const restoredScene = database.listNodes(restored.body.id).find((node) => node.type === 'scene')!
    expect(database.getProjectVoiceDefault(restored.body.id)).toMatchObject({ register: 'literary', authorNote: '全书先冷。' })
    expect(database.getVoiceProfile(restored.body.id, restoredScene.id)).toMatchObject({ source: 'scene', authorNote: '这场改白话。', register: 'vernacular' })
  })

  it('distils authorised samples into an explainable draft before confirmation', async () => {
    const project = database.createProject('样本文风')
    const first = database.createStyleSample({ projectId: project.id, actorProjectId: project.id, title: '短句一', content: '雨停了。他没有回头。门在身后合上。', guidance: '参考停顿', privacyLevel: 'author_only' })
    const second = database.createStyleSample({ projectId: project.id, actorProjectId: project.id, title: '短句二', content: '灯灭了。脚步近了。她握住门把。', guidance: '动词优先', privacyLevel: 'author_only' })
    const draft = await request(app).post(`/api/projects/${project.id}/voice-analyses`).set('Cookie', cookie).send({ sampleIds: [first.id, second.id] }).expect(201)
    expect(draft.body).toMatchObject({ projectId: project.id, sampleIds: [first.id, second.id], confirmedAt: null })
    expect(draft.body.evidence.length).toBeGreaterThan(0)
    expect(draft.body.suggested.family).toBeTruthy()
    expect(database.getProjectVoiceDefault(project.id)).toBeNull()

    await request(app).post(`/api/projects/${project.id}/voice-analyses/${draft.body.id}/confirm`).set('Cookie', cookie).send({ intensity: 'light' }).expect(200)
    expect(database.getProjectVoiceDefault(project.id)).toMatchObject({ family: draft.body.suggested.family, intensity: 'light' })
  })

  it('adds a mentioned character voice to AI context and reports scene consistency', async () => {
    const project = database.createProject('人物口吻')
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    const character = database.createEntity({ projectId: project.id, type: 'character', canonicalName: '林照', aliases: [], summary: '寡言', privacyLevel: 'normal' })
    database.saveCharacterVoice(project.id, character.id, { directness: 'indirect', emotion: 'restrained', signature: '回答前会停一下', avoid: '不说大道理' })
    database.saveScene(scene.id, doc('林照说：“我知道。”他转身走了。'), '林照说：“我知道。”他转身走了。')

    const context = await request(app).get(`/api/projects/${project.id}/scenes/${scene.id}/context`).set('Cookie', cookie).expect(200)
    const voice = context.body.find((item: { id: string }) => item.id === `character_voice:${character.id}`)
    expect(voice.content).toContain('回答前会停一下')
    expect(voice.content).toContain('不说大道理')
    const report = await request(app).get(`/api/projects/${project.id}/scenes/${scene.id}/voice-consistency`).set('Cookie', cookie).expect(200)
    expect(report.body.score).toBeGreaterThanOrEqual(0)
    expect(report.body.summary).toBeTruthy()
  })
})

function doc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}
