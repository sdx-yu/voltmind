// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { getConfig } from '../../server/config.js'
import { AppDatabase } from '../../server/db.js'
import { buildProvenanceBundle, verifyProvenanceBundle } from '../../server/provenance.js'

describe('V1-E provenance chain', () => {
  let dir: string
  let database: AppDatabase

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-provenance-')); database = new AppDatabase(path.join(dir, 'provenance.sqlite')) })
  afterEach(() => { database.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('backfills legacy revisions while upgrading a v6 database to the current schema', () => {
    const project = database.createProject('旧书')
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    database.saveScene(scene.id, doc('人工旧稿'), '人工旧稿')
    const databasePath = database.databasePath
    database.db.exec("DROP TABLE research_events; DROP TABLE research_tasks; DROP TABLE research_enrollments; DROP TABLE visual_events; DROP TABLE storyboard_cards; DROP TABLE storyboards; DROP TABLE visual_candidates; DROP TABLE visual_anchors; DROP TABLE visual_assets; DROP TABLE template_events; DROP TABLE template_applications; DROP TABLE template_grants; DROP TABLE template_package_resources; DROP TABLE template_packages; DROP TABLE template_resources; DROP TABLE sprint_board_cards; DROP TABLE sprint_boards; DROP TABLE sprint_result_cards; DROP TABLE sprint_events; DROP TABLE sprint_samples; DROP TABLE sprint_sessions; DROP TABLE review_decisions; DROP TABLE review_feedback; DROP TABLE review_sessions; DROP TABLE mobile_inbox_actions; DROP TABLE mobile_inbox_items; DROP TABLE sync_conflicts; DROP TABLE sync_updates; DROP TABLE sync_object_versions; DROP TABLE sync_scene_states; DROP TABLE sync_project_configs; DROP TABLE provenance_exports; DROP TABLE provenance_events; DELETE FROM schema_migrations WHERE version IN (7,8,9,10,11,12,13,14); UPDATE revisions SET provenance_label='';")
    database.close(); database = new AppDatabase(databasePath)
    expect(database.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toMatchObject({ version: 14 })
    expect(database.listRevisions(scene.id)[0]).toMatchObject({ provenanceLabel: 'human', sourceTaskId: null })
    expect(database.listProvenanceEvents(project.id)[0]).toMatchObject({ eventType: 'human_edit', contentHash: expect.any(String) })
    expect(fs.readdirSync(path.join(dir, 'backups')).some((name) => name.startsWith('pre-migration-v6-to-v14-'))).toBe(true)
  })

  it('links accepted AI text to its task and labels later author edits without storing prompt or output text', async () => {
    database.close()
    const result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'api.sqlite'), production: false }))
    database = result.database
    const session = await request(result.app).post('/api/session')
    const cookie = session.headers['set-cookie'][0].split(';')[0]
    const project = (await request(result.app).post('/api/projects').set('Cookie', cookie).send({ title: '来源之书' }).expect(201)).body
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    await request(result.app).put(`/api/scenes/${scene.id}`).set('Cookie', cookie).send({ contentJson: doc('作者初稿'), plainText: '作者初稿' }).expect(200)
    const context = (await request(result.app).get(`/api/projects/${project.id}/scenes/${scene.id}/context`).set('Cookie', cookie).expect(200)).body
    const task = (await request(result.app).post('/api/ai/tasks').set('Cookie', cookie).send({ projectId: project.id, nodeId: scene.id, taskType: 'brainstorm', instruction: 'TOP_SECRET_PROMPT', selectedContextIds: context.map((item: { id: string }) => item.id) }).expect(200)).body
    await request(result.app).post(`/api/projects/${project.id}/provenance/ai-decisions`).set('Cookie', cookie).send({ nodeId: scene.id, taskId: task.taskId, decision: 'accepted' }).expect(201)
    await request(result.app).put(`/api/scenes/${scene.id}`).set('Cookie', cookie).send({ contentJson: doc('作者初稿\nAI 候选'), plainText: '作者初稿\nAI 候选', sourceType: 'ai_accepted', sourceTaskId: task.taskId }).expect(200)
    await request(result.app).put(`/api/scenes/${scene.id}`).set('Cookie', cookie).send({ contentJson: doc('作者初稿\nAI 候选，作者再改'), plainText: '作者初稿\nAI 候选，作者再改' }).expect(200)

    const revisions = database.listRevisions(scene.id)
    expect(revisions.find((revision) => revision.provenanceLabel === 'ai_accepted')).toMatchObject({ sourceTaskId: task.taskId })
    expect(revisions[0].provenanceLabel).toBe('human_after_ai')
    const bundle = buildProvenanceBundle(database, project.id)
    expect(verifyProvenanceBundle(bundle)).toMatchObject({ ok: true, chainValid: true, manifestHashValid: true })
    const serialized = JSON.stringify(bundle)
    expect(serialized).not.toContain('TOP_SECRET_PROMPT')
    expect(serialized).not.toContain(task.output)
    expect(bundle.manifest.privacy).toEqual({ includesTextExcerpts: false, excludesPromptsAndSecrets: true })
    const tampered = structuredClone(bundle)
    tampered.manifest.events[0].metadata = { changed: true }
    expect(verifyProvenanceBundle(tampered)).toMatchObject({ ok: false })

    const exported = await request(result.app).post(`/api/projects/${project.id}/provenance/exports`).set('Cookie', cookie).send({ format: 'json', includeTextExcerpts: false }).expect(201)
    expect(JSON.parse(exported.body.content)).toMatchObject({ format: 'bbd-provenance-v1', manifestHash: exported.body.manifestHash })
    await request(result.app).post('/api/provenance/verify').set('Cookie', cookie).send(JSON.parse(exported.body.content)).expect(200).expect((response) => expect(response.body.ok).toBe(true))

    const sourceHashes = database.listProvenanceEvents(project.id).map((event) => event.eventHash)
    const backup = await request(result.app).get(`/api/projects/${project.id}/backup`).set('Cookie', cookie).expect(200)
    expect(JSON.stringify(backup.body)).not.toContain('TOP_SECRET_PROMPT')
    const restored = await request(result.app).post('/api/backups/restore').set('Cookie', cookie).send(backup.body).expect(201)
    const restoredEvents = database.listProvenanceEvents(restored.body.id)
    expect(restoredEvents.map((event) => event.eventHash)).toEqual(sourceHashes)
    const restoredAiRevision = database.listNodes(restored.body.id).filter((node) => node.type === 'scene').flatMap((node) => database.listRevisions(node.id)).find((revision) => revision.provenanceLabel === 'ai_accepted')!
    expect(restoredAiRevision.sourceTaskId).toEqual(expect.any(String))
    expect(database.db.prepare('SELECT 1 AS found FROM ai_tasks WHERE id=? AND project_id=?').get(restoredAiRevision.sourceTaskId!, restored.body.id)).toMatchObject({ found: 1 })
    expect(verifyProvenanceBundle(buildProvenanceBundle(database, restored.body.id)).ok).toBe(true)
  })
})

function doc(text: string) { return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }
