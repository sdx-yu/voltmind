// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { getConfig } from '../../server/config.js'
import { AppDatabase } from '../../server/db.js'
import type { ManuscriptNode, StoryTimeSpec } from '../../shared/types.js'
import { compareStoryTime, describeStoryTime, emptyStoryTimeSpec, storyTimeSortValue } from '../../shared/storyTime.js'

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

describe('structured story time', () => {
  it('sorts custom eras and relative scenes without converting the author label to Gregorian dates', () => {
    const first = scene('first', custom({ era: '承平', eraOrder: 1, year: 12, month: 12, day: 23, period: '子时', displayLabel: '承平十二年腊月廿三子时' }))
    const second = scene('second', custom({ era: '新元', eraOrder: 2, year: 1, month: 1, day: 1, displayLabel: '新元元年正月初一' }))
    const after = scene('after', { ...emptyStoryTimeSpec('relative'), anchorNodeId: 'second', relation: 'after', offsetValue: 3, offsetUnit: 'day', displayLabel: '三日后的雪夜' })
    const nodes = [after, second, first]
    expect([...nodes].sort((a, b) => compareStoryTime(a, b, nodes)).map((item) => item.id)).toEqual(['first', 'second', 'after'])
    expect(describeStoryTime(first, nodes)).toBe('承平十二年腊月廿三子时')
    expect(storyTimeSortValue(after, nodes)).toBe(storyTimeSortValue(second, nodes)! + 3 * 1_440)
  })

  it('does not pretend that Gregorian dates and fictional eras share one sortable calendar', () => {
    const ancient = scene('ancient', custom({ year: 12 }))
    const modern = scene('modern', { ...emptyStoryTimeSpec('calendar'), calendarDate: '2026-01-01' })
    const nodes = [ancient, modern]
    expect([...nodes].sort((a, b) => compareStoryTime(a, b, nodes)).map((item) => item.id)).toEqual(['ancient', 'modern'])
  })

  it('persists the structured value while keeping the display label for old exports', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-story-time-db-')); const database = new AppDatabase(path.join(dir, 'db.sqlite'))
    cleanups.push(() => { database.close(); fs.rmSync(dir, { recursive: true, force: true }) })
    const project = database.createProject('古风'); const node = database.listNodes(project.id).find((item) => item.type === 'scene')!
    const spec = custom({ era: '承平', year: 12, month: 12, day: 23, period: '子时' })
    database.updateNode(node.id, { storyTime: '承平十二年腊月廿三子时', storyTimeSpec: spec })
    expect(database.getNode(node.id)).toMatchObject({ storyTime: '承平十二年腊月廿三子时', storyTimeSpec: spec })
    expect(database.db.prepare('SELECT story_time_json FROM manuscript_nodes WHERE id=?').get(node.id)).toMatchObject({ story_time_json: expect.stringContaining('"mode":"custom"') })
  })

  it('validates scene anchors and exposes trusted time context to AI', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-story-time-api-')); const result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'api.sqlite'), production: false }))
    cleanups.push(() => { result.database.close(); fs.rmSync(dir, { recursive: true, force: true }) })
    const cookie = (await request(result.app).post('/api/session')).headers['set-cookie'][0].split(';')[0]
    const project = result.database.createProject('古风'); const tree = result.database.listNodes(project.id); const node = tree.find((item) => item.type === 'scene')!; const chapter = tree.find((item) => item.type === 'chapter')!; const second = result.database.createNode({ projectId: project.id, parentId: chapter.id, type: 'scene', title: '第二场' })
    await request(result.app).patch(`/api/nodes/${node.id}`).set('Cookie', cookie).send({ storyTime: '错误', storyTimeSpec: { ...emptyStoryTimeSpec('sequence'), anchorNodeId: node.id } }).expect(400)
    const spec = custom({ era: '承平', year: 12, month: 12, day: 23, period: '子时', displayLabel: '承平十二年腊月廿三子时' })
    await request(result.app).patch(`/api/nodes/${node.id}`).set('Cookie', cookie).send({ storyTime: spec.displayLabel, storyTimeSpec: spec }).expect(200)
    const context = await request(result.app).get(`/api/projects/${project.id}/scenes/${node.id}/context`).set('Cookie', cookie).expect(200)
    expect(context.body).toContainEqual(expect.objectContaining({ type: 'time', title: '本场故事时间', content: expect.stringContaining('承平十二年腊月廿三子时'), selected: true }))
    await request(result.app).patch(`/api/nodes/${second.id}`).set('Cookie', cookie).send({ storyTime: '客户端伪造值', storyTimeSpec: { ...emptyStoryTimeSpec('relative'), anchorNodeId: node.id, relation: 'after', offsetValue: 3, offsetUnit: 'day' } }).expect(200).expect(({ body }) => expect(body.storyTime).toContain('3日之后'))
    await request(result.app).patch(`/api/nodes/${node.id}`).set('Cookie', cookie).send({ storyTime: '循环', storyTimeSpec: { ...emptyStoryTimeSpec('sequence'), anchorNodeId: second.id } }).expect(400)
    const other = result.database.createProject('另一部书'); const otherScene = result.database.listNodes(other.id).find((item) => item.type === 'scene')!
    await request(result.app).patch(`/api/nodes/${second.id}`).set('Cookie', cookie).send({ storyTime: '跨书', storyTimeSpec: { ...emptyStoryTimeSpec('sequence'), anchorNodeId: otherScene.id } }).expect(400)
    await request(result.app).patch(`/api/nodes/${second.id}`).set('Cookie', cookie).send({ storyTime: '坏日期', storyTimeSpec: { ...emptyStoryTimeSpec('calendar'), calendarDate: '2026-02-31' } }).expect(400)
  })
})

function custom(patch: Partial<StoryTimeSpec>): StoryTimeSpec { return { ...emptyStoryTimeSpec('custom', { defaultMode: 'custom', customEra: '承平' }), ...patch } }
function scene(id: string, storyTimeSpec: StoryTimeSpec): ManuscriptNode { return { id, projectId: 'p', parentId: 'c', type: 'scene', title: id, sortKey: 1000, status: 'draft', povEntityId: null, storyTime: storyTimeSpec.displayLabel || null, storyTimeSpec, deletedAt: null, wordCount: 0 } }
