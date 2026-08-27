// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { getConfig } from '../../server/config.js'
import { AppDatabase } from '../../server/db.js'

describe('V1-C series canon and style samples', () => {
  let dir: string
  let database: AppDatabase

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-series-')); database = new AppDatabase(path.join(dir, 'series.sqlite')) })
  afterEach(() => { database.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('backs up v4 and migrates the isolated schemas through v10', () => {
    const databasePath = database.databasePath
    database.db.exec('DROP TABLE template_events; DROP TABLE template_applications; DROP TABLE template_grants; DROP TABLE template_package_resources; DROP TABLE template_packages; DROP TABLE template_resources; DROP TABLE sprint_board_cards; DROP TABLE sprint_boards; DROP TABLE sprint_result_cards; DROP TABLE sprint_events; DROP TABLE sprint_samples; DROP TABLE sprint_sessions; DROP TABLE review_decisions; DROP TABLE review_feedback; DROP TABLE review_sessions; DROP TABLE mobile_inbox_actions; DROP TABLE mobile_inbox_items; DROP TABLE sync_conflicts; DROP TABLE sync_updates; DROP TABLE sync_object_versions; DROP TABLE sync_scene_states; DROP TABLE sync_project_configs; DROP TABLE provenance_exports; DROP TABLE provenance_events; DROP TABLE delivery_check_runs; DROP TABLE project_delivery_rule_overrides; DROP TABLE delivery_rules; DROP TABLE delivery_templates; DROP TABLE read_aloud_preferences; DROP TABLE style_sample_preferences; DROP TABLE style_samples; DROP TABLE series_canon_overrides; DROP TABLE series_canon_entries; DROP TABLE series_projects; DROP TABLE series; DELETE FROM schema_migrations WHERE version IN (5,6,7,8,9,10,11,12);')
    database.close(); database = new AppDatabase(databasePath)
    expect(database.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toMatchObject({ version: 12 })
    expect(database.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='series_canon_overrides'").get()).toMatchObject({ name: 'series_canon_overrides' })
    expect(fs.readdirSync(path.join(dir, 'backups')).some((name) => name.startsWith('pre-migration-v4-to-v12-'))).toBe(true)
  })

  it('shares a baseline, isolates a book override, and preserves it across leaving', () => {
    const a = database.createProject('雾港一'); const b = database.createProject('雾港二')
    const series = database.createSeries({ name: '雾港纪事', projectId: a.id })
    database.addProjectToSeries(series.id, b.id, a.id)
    const harbor = database.createSeriesCanon({ seriesId: series.id, actorProjectId: a.id, type: 'location', canonicalName: '旧雾港', summary: '终年有雾' })
    expect(database.listSeriesCanonForProject(b.id)[0]).toMatchObject({ canonicalName: '旧雾港', summary: '终年有雾', override: null })
    database.upsertSeriesCanonOverride(harbor.id, b.id, { canonicalName: '新港区', aliases: [], summary: '第二部已完成疏浚', privacyLevel: 'normal' })
    expect(database.listSeriesCanonForProject(a.id)[0].override).toBeNull()
    expect(database.listSeriesCanonForProject(b.id)[0].override).toMatchObject({ canonicalName: '新港区', summary: '第二部已完成疏浚' })
    database.removeProjectFromSeries(series.id, b.id, b.id)
    expect(database.getSeriesForProject(b.id)).toBeNull()
    expect(database.listNodes(b.id).some((node) => node.type === 'scene')).toBe(true)
    database.addProjectToSeries(series.id, b.id, b.id)
    expect(database.listSeriesCanonForProject(b.id)[0].override?.summary).toBe('第二部已完成疏浚')
  })

  it('disables a series style sample for only one book', () => {
    const a = database.createProject('上卷'); const b = database.createProject('下卷')
    const series = database.createSeries({ name: '双卷', projectId: a.id }); database.addProjectToSeries(series.id, b.id, a.id)
    const sample = database.createStyleSample({ seriesId: series.id, actorProjectId: a.id, title: '短句节奏', content: '雨落。灯灭。人未归。', guidance: '参考节奏，不复用意象' })
    database.setStyleSamplePreference(sample.id, b.id, false)
    expect(database.listStyleSamples(a.id)[0].effectiveEnabled).toBe(true)
    expect(database.listStyleSamples(b.id)[0].effectiveEnabled).toBe(false)
  })
})

describe('V1-C API, AI context, and backup', () => {
  let dir: string
  let result: ReturnType<typeof createApp>
  let cookie: string

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-series-api-'))
    result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'api.sqlite'), production: false }))
    cookie = (await request(result.app).post('/api/session')).headers['set-cookie'][0].split(';')[0]
  })
  afterEach(() => { result.database.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('exposes enabled samples with source reasons under the shared token budget', async () => {
    const project = result.database.createProject('上下文之书'); const scene = result.database.listNodes(project.id).find((node) => node.type === 'scene')!
    const series = result.database.createSeries({ name: '上下文系列', projectId: project.id })
    result.database.createStyleSample({ seriesId: series.id, actorProjectId: project.id, title: '长样本', content: '长句。'.repeat(2_000), guidance: '参考节奏' })
    result.database.createStyleSample({ projectId: project.id, actorProjectId: project.id, title: '停用样本', content: '不应出现', enabled: false })
    const context = await request(result.app).get(`/api/projects/${project.id}/scenes/${scene.id}/context`).set('Cookie', cookie).expect(200)
    const styles = context.body.filter((item: { type: string }) => item.type === 'style')
    expect(styles).toHaveLength(1)
    expect(styles[0]).toMatchObject({ title: '风格样本：长样本', reason: '当前项目所属系列的已启用样本', selected: true })
    expect(styles.reduce((sum: number, item: { estimatedTokens: number }) => sum + item.estimatedTokens, 0)).toBeLessThanOrEqual(1_200)
  })

  it('restores the series snapshot, override, samples and local preference into an isolated recovered series', async () => {
    const project = result.database.createProject('原书'); const series = result.database.createSeries({ name: '群岛志', projectId: project.id })
    const entry = result.database.createSeriesCanon({ seriesId: series.id, actorProjectId: project.id, type: 'location', canonicalName: '北岛', summary: '常年封冻' })
    result.database.upsertSeriesCanonOverride(entry.id, project.id, { canonicalName: '解冻后的北岛', aliases: ['北境'], summary: '本书中春季解冻', privacyLevel: 'normal' })
    const sample = result.database.createStyleSample({ seriesId: series.id, actorProjectId: project.id, title: '岛屿语感', content: '潮声穿过石屋。', guidance: '保持克制' })
    result.database.setStyleSamplePreference(sample.id, project.id, false)
    result.database.createStyleSample({ projectId: project.id, actorProjectId: project.id, title: '本书样本', content: '冰裂如钟。' })
    const backup = await request(result.app).get(`/api/projects/${project.id}/backup`).set('Cookie', cookie).expect(200)
    const restored = await request(result.app).post('/api/backups/restore').set('Cookie', cookie).send(backup.body).expect(201)
    const restoredSeries = result.database.getSeriesForProject(restored.body.id)!
    expect(restoredSeries).toMatchObject({ name: '群岛志（恢复）' })
    expect(restoredSeries.id).not.toBe(series.id)
    expect(result.database.listSeriesCanonForProject(restored.body.id)[0]).toMatchObject({ canonicalName: '北岛', override: expect.objectContaining({ canonicalName: '解冻后的北岛' }) })
    const samples = result.database.listStyleSamples(restored.body.id)
    expect(samples).toHaveLength(2)
    expect(samples.find((item) => item.scope === 'series')).toMatchObject({ title: '岛屿语感', effectiveEnabled: false })
    expect(samples.find((item) => item.scope === 'project')).toMatchObject({ title: '本书样本', effectiveEnabled: true })
  })
})
