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

describe('V1-M mobile companion contract', () => {
  let dir: string
  let result: ReturnType<typeof createApp>
  let cookie: string

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-mobile-'))
    result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'mobile.sqlite'), production: false }))
    cookie = (await request(result.app).post('/api/session')).headers['set-cookie'][0].split(';')[0]
  })
  afterEach(() => { result.database.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('backs up v8 and applies the v9–v11 immutable schemas', () => {
    const databasePath = result.database.databasePath
    result.database.db.exec('DROP TABLE voice_preference_stats; DROP TABLE character_voice_profiles; DROP TABLE style_analysis_runs; DROP TABLE scene_voice_profiles; DROP TABLE project_voice_defaults; DROP TABLE relationship_states; DROP TABLE entity_relationships; DROP TABLE entity_profile_fields; DROP TABLE research_cohort_submissions; DROP TABLE research_cohort_participants; DROP TABLE research_cohort_deletion_receipts; DROP TABLE research_wave_events; DROP TABLE research_wave_incidents; DROP TABLE research_waves; DROP TABLE research_events; DROP TABLE research_tasks; DROP TABLE research_enrollments; DROP TABLE visual_events; DROP TABLE storyboard_cards; DROP TABLE storyboards; DROP TABLE visual_candidates; DROP TABLE visual_anchors; DROP TABLE visual_assets; DROP TABLE template_events; DROP TABLE template_applications; DROP TABLE template_grants; DROP TABLE template_package_resources; DROP TABLE template_packages; DROP TABLE template_resources; DROP TABLE sprint_board_cards; DROP TABLE sprint_boards; DROP TABLE sprint_result_cards; DROP TABLE sprint_events; DROP TABLE sprint_samples; DROP TABLE sprint_sessions; DROP TABLE review_decisions; DROP TABLE review_feedback; DROP TABLE review_sessions; DROP TABLE mobile_inbox_actions; DROP TABLE mobile_inbox_items; DELETE FROM schema_migrations WHERE version IN (9,10,11,12,13,14,15, 16,17,18,19,20);')
    result.database.close(); result = { ...result, database: new AppDatabase(databasePath) }
    expect(result.database.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toMatchObject({ version: 20 })
    expect(result.database.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mobile_inbox_actions'").get()).toMatchObject({ name: 'mobile_inbox_actions' })
    expect(fs.readdirSync(path.join(dir, 'backups')).some((name) => name.startsWith('pre-migration-v8-to-v20-'))).toBe(true)
  })

  it('retains 20 notes and converges duplicate, out-of-order actions through the API', async () => {
    const project = result.database.createProject('移动收集')
    for (let index = 0; index < 20; index += 1) {
      const payload = mobileItem(`mobile-${index.toString().padStart(4, '0')}`, `灵感 ${index}`, index % 2 ? project.id : null)
      await request(result.app).post('/api/mobile/inbox').set('Cookie', cookie).send(payload).expect(201)
      await request(result.app).post('/api/mobile/inbox').set('Cookie', cookie).send(payload).expect(201)
    }
    const target = 'mobile-0000'
    const later = { id: 'action-later', action: 'approved', note: '', createdAt: '2026-08-27T10:00:00.000Z' }
    const earlier = { id: 'action-early', action: 'revisit', note: '', createdAt: '2026-08-27T09:00:00.000Z' }
    await request(result.app).post(`/api/mobile/inbox/${target}/actions`).set('Cookie', cookie).send(later).expect(201)
    await request(result.app).post(`/api/mobile/inbox/${target}/actions`).set('Cookie', cookie).send(earlier).expect(201)
    await request(result.app).post(`/api/mobile/inbox/${target}/actions`).set('Cookie', cookie).send(later).expect(201)
    const inbox = await request(result.app).get('/api/mobile/inbox').set('Cookie', cookie).expect(200)
    expect(inbox.body).toHaveLength(20)
    expect(inbox.body.find((item: any) => item.id === target)).toMatchObject({ currentAction: 'approved', actions: [{ id: 'action-early' }, { id: 'action-later' }] })
  })

  it('includes project mobile notes in checksum backup and remaps them on restore', async () => {
    const project = result.database.createProject('审阅备份'); const scene = result.database.listNodes(project.id).find((node) => node.type === 'scene')!
    result.database.createMobileInboxItem({ ...mobileItem('mobile-backup', '这里的动机需要加强', project.id), targetNodeId: scene.id, kind: 'review_note' })
    result.database.createMobileInboxAction({ id: 'action-backup', itemId: 'mobile-backup', action: 'approved', note: '', createdAt: '2026-08-27T11:00:00.000Z' })
    const archive = await request(result.app).get(`/api/projects/${project.id}/backup`).set('Cookie', cookie).expect(200)
    expect(archive.body.payload.mobileInbox).toHaveLength(1)
    const restored = await request(result.app).post('/api/backups/restore').set('Cookie', cookie).send(archive.body).expect(201)
    const restoredItems = result.database.listMobileInbox(restored.body.id).filter((item) => item.projectId === restored.body.id)
    expect(restoredItems).toHaveLength(1); expect(restoredItems[0]).toMatchObject({ content: '这里的动机需要加强', currentAction: 'approved' })
    expect(restoredItems[0].targetNodeId).not.toBe(scene.id)
  })

  it('unions assigned and unassigned mobile events through encrypted bbd-sync-v1', () => {
    const a = result.database; const project = a.createProject('移动接力'); const scene = a.listNodes(project.id).find((node) => node.type === 'scene')!
    a.createMobileInboxItem({ ...mobileItem('mobile-assigned', '项目笔记', project.id), targetNodeId: scene.id })
    a.createMobileInboxItem(mobileItem('mobile-free', '稍后归类', null))
    a.createMobileInboxAction({ id: 'action-sync', itemId: 'mobile-free', action: 'revisit', note: '', createdAt: '2026-08-27T09:00:00.000Z' })
    const syncA = new SyncService(a); const { recoveryPhrase } = syncA.initialize(project.id, '手机 A'); const transfer = syncA.exportPackage(project.id, recoveryPhrase)
    expect(syncA.inspectPackage(transfer, recoveryPhrase).mobileItemCount).toBe(2)
    const b = new AppDatabase(path.join(dir, 'replica.sqlite'))
    try {
      const syncB = new SyncService(b); syncB.importPackage(transfer, recoveryPhrase, '电脑 B')
      expect(b.listMobileInbox(project.id)).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'mobile-assigned' }), expect.objectContaining({ id: 'mobile-free', currentAction: 'revisit' })]))
      expect(syncB.importPackage(transfer, recoveryPhrase)).toMatchObject({ duplicate: true })
    } finally { b.close() }
  }, 15_000)
})

function mobileItem(id: string, content: string, projectId: string | null) { return { id, projectId, targetNodeId: null, kind: 'inspiration' as const, content, originDeviceId: 'device-test', createdAt: '2026-08-27T08:00:00.000Z' } }
