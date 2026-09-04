// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { getConfig } from '../../server/config.js'
import { AppDatabase } from '../../server/db.js'
import { runDeliveryCheck } from '../../server/delivery.js'

describe('V1-D delivery database and rules', () => {
  let dir: string
  let database: AppDatabase

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-delivery-')); database = new AppDatabase(path.join(dir, 'delivery.sqlite')) })
  afterEach(() => { database.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('backs up v5 before creating the local-read and delivery schema', () => {
    const databasePath = database.databasePath
    database.db.exec('DROP TABLE story_beat_scenes; DROP TABLE story_beats; DROP TABLE story_blueprints; DELETE FROM schema_migrations WHERE version=21;')
    database.db.exec('DROP TABLE voice_preference_stats; DROP TABLE character_voice_profiles; DROP TABLE style_analysis_runs; DROP TABLE scene_voice_profiles; DROP TABLE project_voice_defaults; DROP TABLE relationship_states; DROP TABLE entity_relationships; DROP TABLE entity_profile_fields; DROP TABLE research_cohort_submissions; DROP TABLE research_cohort_participants; DROP TABLE research_cohort_deletion_receipts; DROP TABLE research_wave_events; DROP TABLE research_wave_incidents; DROP TABLE research_waves; DROP TABLE research_events; DROP TABLE research_tasks; DROP TABLE research_enrollments; DROP TABLE visual_events; DROP TABLE storyboard_cards; DROP TABLE storyboards; DROP TABLE visual_candidates; DROP TABLE visual_anchors; DROP TABLE visual_assets; DROP TABLE template_events; DROP TABLE template_applications; DROP TABLE template_grants; DROP TABLE template_package_resources; DROP TABLE template_packages; DROP TABLE template_resources; DROP TABLE sprint_board_cards; DROP TABLE sprint_boards; DROP TABLE sprint_result_cards; DROP TABLE sprint_events; DROP TABLE sprint_samples; DROP TABLE sprint_sessions; DROP TABLE review_decisions; DROP TABLE review_feedback; DROP TABLE review_sessions; DROP TABLE mobile_inbox_actions; DROP TABLE mobile_inbox_items; DROP TABLE sync_conflicts; DROP TABLE sync_updates; DROP TABLE sync_object_versions; DROP TABLE sync_scene_states; DROP TABLE sync_project_configs; DROP TABLE provenance_exports; DROP TABLE provenance_events; DROP TABLE delivery_check_runs; DROP TABLE project_delivery_rule_overrides; DROP TABLE delivery_rules; DROP TABLE delivery_templates; DROP TABLE read_aloud_preferences; DELETE FROM schema_migrations WHERE version IN (6,7,8,9,10,11,12,13,14,15, 16,17,18,19,20);')
    database.close(); database = new AppDatabase(databasePath)
    expect(database.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toMatchObject({ version: 21 })
    expect(database.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='delivery_rules'").get()).toMatchObject({ name: 'delivery_rules' })
    expect(fs.readdirSync(path.join(dir, 'backups')).some((name) => name.startsWith('pre-migration-v5-to-v21-'))).toBe(true)
  })

  it('persists bounded local voice preferences and versioned source metadata', () => {
    const project = database.createProject('朗读之书')
    expect(database.saveReadAloudPreferences(project.id, { voiceUri: 'com.apple.voice.zh-CN', rate: 9, pitch: 0 })).toMatchObject({ voiceUri: 'com.apple.voice.zh-CN', rate: 2, pitch: 0.5 })
    const templates = database.listDeliveryTemplates(project.id)
    expect(templates.find((template) => template.id === 'builtin-fanqie-2026-08')).toMatchObject({ channel: '番茄小说', version: '2026.08', verifiedAt: '2026-08-26', sourceUrl: expect.stringContaining('fanqienovel.com') })
    expect(templates.find((template) => template.id === 'builtin-general-v1')).toMatchObject({ sourceUrl: '', sourceNote: expect.stringContaining('不代表任何平台') })
  })

  it('returns locatable evidence and removes a finding when its rule is disabled', () => {
    const project = database.createProject('检查之书')
    const nodes = database.listNodes(project.id); const chapter = nodes.find((node) => node.type === 'chapter')!; const first = nodes.find((node) => node.type === 'scene')!
    const repeated = '雨声漫过长街。'.repeat(80)
    database.saveScene(first.id, doc(repeated), repeated)
    const second = database.createNode({ projectId: project.id, parentId: chapter.id, type: 'scene', title: '场景 2' })
    database.saveScene(second.id, doc(repeated), repeated)
    const firstRun = runDeliveryCheck(database, project.id, 'builtin-fanqie-2026-08', [chapter.id])
    expect(firstRun.results.map((result) => result.ruleCode)).toEqual(expect.arrayContaining(['FQ-FMT-001', 'FQ-LOW-001', 'FQ-SIGN-001']))
    expect(firstRun.results.find((result) => result.ruleCode === 'FQ-FMT-001')).toMatchObject({ nodeId: first.id, quote: expect.stringContaining('雨声'), startOffset: 0, endOffset: 90 })
    expect(firstRun.results.some((result) => result.ruleCode === 'FQ-CONTENT-001')).toBe(false)
    const paragraphRule = database.getDeliveryRuleByCode(project.id, 'FQ-FMT-001')!
    database.setDeliveryRuleOverride(project.id, paragraphRule.id, false, paragraphRule.config)
    const secondRun = runDeliveryCheck(database, project.id, 'builtin-fanqie-2026-08', [chapter.id])
    expect(secondRun.results.some((result) => result.ruleCode === 'FQ-FMT-001')).toBe(false)
    expect(database.listDeliveryCheckRuns(project.id)).toHaveLength(2)
  })
})

describe('V1-D delivery API and backup', () => {
  let dir: string
  let result: ReturnType<typeof createApp>
  let cookie: string

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-delivery-api-'))
    result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'api.sqlite'), production: false }))
    cookie = (await request(result.app).post('/api/session')).headers['set-cookie'][0].split(';')[0]
  })
  afterEach(() => { result.database.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('validates preferences and restores preferences, overrides and locatable runs', async () => {
    const project = result.database.createProject('交付备份')
    const nodes = result.database.listNodes(project.id); const chapter = nodes.find((node) => node.type === 'chapter')!; const scene = nodes.find((node) => node.type === 'scene')!
    const text = '潮声拍打石阶。'.repeat(90); result.database.saveScene(scene.id, doc(text), text)
    await request(result.app).put(`/api/projects/${project.id}/read-aloud-preferences`).set('Cookie', cookie).send({ voiceUri: 'local-zh', rate: 1.35, pitch: 1 }).expect(200)
    await request(result.app).put(`/api/projects/${project.id}/read-aloud-preferences`).set('Cookie', cookie).send({ rate: 3 }).expect(400)
    const templates = await request(result.app).get(`/api/projects/${project.id}/delivery/templates`).set('Cookie', cookie).expect(200)
    const fanqie = templates.body.find((template: { id: string }) => template.id === 'builtin-fanqie-2026-08')
    const duplicateRule = fanqie.rules.find((rule: { code: string }) => rule.code === 'FQ-LOW-001')
    await request(result.app).put(`/api/projects/${project.id}/delivery/rules/${duplicateRule.id}`).set('Cookie', cookie).send({ enabled: false, config: duplicateRule.config }).expect(200)
    const checked = await request(result.app).post(`/api/projects/${project.id}/delivery/checks`).set('Cookie', cookie).send({ templateId: fanqie.id, chapterIds: [chapter.id] }).expect(201)
    expect(checked.body.results.find((item: { ruleCode: string }) => item.ruleCode === 'FQ-FMT-001').nodeId).toBe(scene.id)

    const backup = await request(result.app).get(`/api/projects/${project.id}/backup`).set('Cookie', cookie).expect(200)
    expect(backup.body.payload.delivery).toMatchObject({ readAloudPreferences: expect.objectContaining({ voiceUri: 'local-zh', rate: 1.35 }) })
    const restored = await request(result.app).post('/api/backups/restore').set('Cookie', cookie).send(backup.body).expect(201)
    expect(result.database.getReadAloudPreferences(restored.body.id)).toMatchObject({ voiceUri: 'local-zh', rate: 1.35 })
    expect(result.database.listDeliveryRuleOverrides(restored.body.id)).toContainEqual(expect.objectContaining({ ruleCode: 'FQ-LOW-001', enabled: false }))
    const restoredRun = result.database.listDeliveryCheckRuns(restored.body.id)[0]
    const restoredNodeId = restoredRun.results.find((item) => item.ruleCode === 'FQ-FMT-001')!.nodeId!
    expect(result.database.getNode(restoredNodeId)).toMatchObject({ projectId: restored.body.id, type: 'scene' })
    expect(restoredRun.chapterIds[0]).not.toBe(chapter.id)
  })
})

function doc(text: string) { return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }
