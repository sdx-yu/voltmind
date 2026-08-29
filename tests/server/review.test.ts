// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../../server/app.js'
import { getConfig } from '../../server/config.js'
import { AppDatabase, createReviewAnchor, resolveReviewAnchor } from '../../server/db.js'
import { ReviewService } from '../../server/review.js'
import type { ReviewPackage } from '../../shared/types.js'

describe('V2-R encrypted role review relay', () => {
  let dir: string
  const databases: AppDatabase[] = []

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-review-')) })
  afterEach(() => { for (const database of databases) database.close(); databases.length = 0; fs.rmSync(dir, { recursive: true, force: true }) })

  function database(name: string) { const value = new AppDatabase(path.join(dir, `${name}.sqlite`)); databases.push(value); return value }
  function manuscript(db: AppDatabase, title = '审阅之书', text = '第一段正文。\n\n第二段需要修改。') {
    const project = db.createProject(title); const scene = db.listNodes(project.id).find((node) => node.type === 'scene')!
    db.saveScene(scene.id, doc(text), text)
    return { project, scene }
  }

  it('backs up v9 and creates the isolated v10 review schema through v11', () => {
    let db = database('migration'); const databasePath = db.databasePath
    db.db.exec('DROP TABLE relationship_states; DROP TABLE entity_relationships; DROP TABLE entity_profile_fields; DROP TABLE research_cohort_submissions; DROP TABLE research_cohort_participants; DROP TABLE research_cohort_deletion_receipts; DROP TABLE research_wave_events; DROP TABLE research_wave_incidents; DROP TABLE research_waves; DROP TABLE research_events; DROP TABLE research_tasks; DROP TABLE research_enrollments; DROP TABLE visual_events; DROP TABLE storyboard_cards; DROP TABLE storyboards; DROP TABLE visual_candidates; DROP TABLE visual_anchors; DROP TABLE visual_assets; DROP TABLE template_events; DROP TABLE template_applications; DROP TABLE template_grants; DROP TABLE template_package_resources; DROP TABLE template_packages; DROP TABLE template_resources; DROP TABLE sprint_board_cards; DROP TABLE sprint_boards; DROP TABLE sprint_result_cards; DROP TABLE sprint_events; DROP TABLE sprint_samples; DROP TABLE sprint_sessions; DROP TABLE review_decisions; DROP TABLE review_feedback; DROP TABLE review_sessions; DELETE FROM schema_migrations WHERE version IN (10,11,12,13,14,15, 16,17);')
    db.close(); databases.pop(); db = new AppDatabase(databasePath); databases.push(db)
    expect(db.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toMatchObject({ version: 17 })
    expect(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='review_feedback'").get()).toMatchObject({ name: 'review_feedback' })
    expect(fs.readdirSync(path.join(dir, 'backups')).some((name) => name.startsWith('pre-migration-v9-to-v17-'))).toBe(true)
  })

  it('encrypts assignment metadata and rejects wrong phrases and tampering', () => {
    const db = database('author'); const service = new ReviewService(db); const { project, scene } = manuscript(db, '密文书名', '不可泄露的正文')
    const created = service.createAssignment(project.id, { reviewerName: '林编辑', role: 'editor', sceneIds: [scene.id], includeProvenance: false, expiresAt: null })
    const serialized = JSON.stringify(created.package)
    expect(serialized).not.toContain('密文书名'); expect(serialized).not.toContain('不可泄露的正文'); expect(serialized).not.toContain('林编辑')
    expect(service.inspectPackage(created.package, created.recoveryPhrase)).toMatchObject({ valid: true, mode: 'assignment', projectTitle: '密文书名', role: 'editor' })
    expect(() => service.inspectPackage(created.package, '0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000')).toThrow()
    const tampered: ReviewPackage = { ...created.package, ciphertext: `${created.package.ciphertext.slice(0, -2)}AA` }
    expect(() => service.inspectPackage(tampered, created.recoveryPhrase)).toThrow(/校验|损坏/)
  })

  it('enforces role scope and relays idempotent feedback without sharing project access', () => {
    const authorDb = database('author'); const reviewerDb = database('reviewer'); const author = new ReviewService(authorDb); const reviewer = new ReviewService(reviewerDb); const { project, scene } = manuscript(authorDb)
    const assignment = author.createAssignment(project.id, { reviewerName: '试读者', role: 'beta_reader', sceneIds: [scene.id], includeProvenance: false, expiresAt: null })
    const imported = reviewer.importPackage(assignment.package, assignment.recoveryPhrase)
    expect(imported.session.projectId).toBeNull(); expect(reviewerDb.listProjects()).toHaveLength(0)
    expect(() => reviewer.addFeedback(imported.session.id, { sceneId: scene.id, kind: 'suggestion', body: '改一下', paragraphIndex: 1, startOffset: 0, endOffset: 3, replacementText: '替换' })).toThrow(/only comment|只能/)
    reviewer.addFeedback(imported.session.id, { id: 'feedback-comment-0001', sceneId: scene.id, kind: 'comment', body: '这里的动机还可以更清楚。', paragraphIndex: 1, startOffset: 0, endOffset: 3 })
    const response = reviewer.exportResponse(imported.session.id, assignment.recoveryPhrase)
    expect(author.importPackage(response, assignment.recoveryPhrase, project.id)).toMatchObject({ duplicate: false })
    expect(author.importPackage(response, assignment.recoveryPhrase, project.id)).toMatchObject({ duplicate: true })
    expect(authorDb.getReviewSession(assignment.session.id)?.feedback[0]).toMatchObject({ body: '这里的动机还可以更清楚。', kind: 'comment', anchorStatus: 'exact' })
    const other = authorDb.createProject('另一项目')
    expect(() => author.importPackage(response, assignment.recoveryPhrase, other.id)).toThrow(/不属于/)
  })

  it('resolves exact, candidate and lost anchors and accepts an editor suggestion explicitly', () => {
    const text = '第一段正文。\n\n第二段需要修改。'; const anchor = createReviewAnchor(text, 1, 3, 7)
    expect(resolveReviewAnchor(text, anchor)).toEqual({ status: 'exact', offset: text.indexOf('需要修改') })
    expect(resolveReviewAnchor(`新增开场。\n\n${text}`, anchor)).toMatchObject({ status: 'candidate', offset: expect.any(Number) })
    expect(resolveReviewAnchor('第一段正文。\n\n目标已经消失。', anchor)).toEqual({ status: 'lost', offset: null })

    const authorDb = database('author'); const reviewerDb = database('editor'); const author = new ReviewService(authorDb); const reviewer = new ReviewService(reviewerDb); const { project, scene } = manuscript(authorDb, '编辑接力', text)
    const assignment = author.createAssignment(project.id, { reviewerName: '责任编辑', role: 'editor', sceneIds: [scene.id], includeProvenance: true, expiresAt: null })
    reviewer.importPackage(assignment.package, assignment.recoveryPhrase)
    reviewer.addFeedback(assignment.session.id, { sceneId: scene.id, kind: 'suggestion', body: '语气更明确。', paragraphIndex: 1, startOffset: 3, endOffset: 7, replacementText: '必须重写' })
    author.importPackage(reviewer.exportResponse(assignment.session.id, assignment.recoveryPhrase), assignment.recoveryPhrase, project.id)
    const feedback = authorDb.getReviewSession(assignment.session.id)!.feedback[0]
    author.decide(project.id, feedback.id, 'accepted', '采纳编辑意见')
    expect(authorDb.getScene(scene.id)?.plainText).toBe('第一段正文。\n\n第二段必须重写。')
    expect(authorDb.getReviewSession(assignment.session.id)?.feedback[0].currentDecision).toBe('accepted')
    expect(authorDb.listProvenanceEvents(project.id).some((event) => event.eventType === 'review_suggestion_accepted')).toBe(true)
  })

  it('backs up review history without cryptographic secrets and restores it archived', async () => {
    const result = createApp(getConfig({ dataDir: dir, databasePath: path.join(dir, 'backup.sqlite'), production: false })); databases.push(result.database)
    const cookie = (await request(result.app).post('/api/session')).headers['set-cookie'][0].split(';')[0]
    const { project, scene } = manuscript(result.database, '可恢复审阅')
    const created = (await request(result.app).post(`/api/projects/${project.id}/reviews`).set('Cookie', cookie).send({ reviewerName: '归档编辑', role: 'editor', sceneIds: [scene.id], includeProvenance: true, expiresAt: null }).expect(201)).body
    expect(created).toMatchObject({ recoveryPhrase: expect.any(String), package: { format: 'bbd-review-v1', mode: 'assignment' } })
    expect((await request(result.app).get(`/api/projects/${project.id}/reviews`).set('Cookie', cookie).expect(200)).body).toHaveLength(1)
    const archive = (await request(result.app).get(`/api/projects/${project.id}/backup`).set('Cookie', cookie).expect(200)).body
    expect(archive.payload.review[0]).toMatchObject({ reviewerName: '归档编辑', role: 'editor' })
    expect(JSON.stringify(archive.payload.review)).not.toMatch(/keySalt|keyVerifier|recoveryPhrase|projectFingerprint/)
    const restored = (await request(result.app).post('/api/backups/restore').set('Cookie', cookie).send(archive).expect(201)).body
    expect(result.database.listReviewSessions(restored.id).find((session) => session.projectId === restored.id)).toMatchObject({ direction: 'restored', status: 'archived', reviewerName: '归档编辑' })
  })
})

function doc(text: string): Record<string, unknown> { return { type: 'doc', content: text.split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) } }
