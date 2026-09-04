// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../server/db.js'

describe('AppDatabase', () => {
  let dir: string
  let database: AppDatabase

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-db-'))
    database = new AppDatabase(path.join(dir, 'test.sqlite'))
  })
  afterEach(() => { database.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('creates a writable project with a default scene', () => {
    const project = database.createProject('长夜')
    const nodes = database.listNodes(project.id)
    expect(nodes.map((node) => node.type)).toEqual(['book', 'chapter', 'scene'])
    expect(database.getScene(nodes.find((node) => node.type === 'scene')!.id)?.plainText).toBe('')
    expect(database.integrityCheck()).toBe('ok')
  })

  it('keeps the project and manuscript root titles aligned when renaming a novel', () => {
    const project = database.createProject('旧书名')
    const updated = database.updateProject(project.id, { title: '新书名', description: '新的简介' })
    expect(updated).toMatchObject({ title: '新书名', description: '新的简介' })
    expect(database.listNodes(project.id).find((node) => node.type === 'book')?.title).toBe('新书名')
  })

  it('keeps a story blueprint separate from the manuscript and restores hidden scene links', () => {
    const project = database.createProject('归航', '', { blueprint: { approach: 'guided', premise: '失踪的领航员必须带仇人穿过风暴。', endingState: '灯塔重新亮起。' }, starter: 'three_act' })
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    const plan = database.getStoryPlan(project.id)!
    expect(plan.blueprint).toMatchObject({ approach: 'guided', premise: '失踪的领航员必须带仇人穿过风暴。', endingState: '灯塔重新亮起。' })
    expect(plan.beats).toHaveLength(9)
    expect(database.listNodes(project.id)).toHaveLength(3)

    database.updateStoryBeat(plan.beats[0].id, { sceneIds: [scene.id], status: 'drafting' })
    expect(database.getStoryPlan(project.id)!.beats[0]).toMatchObject({ sceneIds: [scene.id], status: 'drafting' })
    database.softDeleteNode(scene.id, true)
    expect(database.getStoryPlan(project.id)!.beats[0].sceneIds).toEqual([])
    database.softDeleteNode(scene.id, false)
    expect(database.getStoryPlan(project.id)!.beats[0].sceneIds).toEqual([scene.id])
  })

  it('backs up a v2 database before applying later story schemas through v10', () => {
    const databasePath = database.databasePath
    database.db.exec('DROP TABLE story_beat_scenes; DROP TABLE story_beats; DROP TABLE story_blueprints;')
    database.db.exec('DROP TABLE voice_preference_stats; DROP TABLE character_voice_profiles; DROP TABLE style_analysis_runs; DROP TABLE scene_voice_profiles; DROP TABLE project_voice_defaults; DROP TABLE relationship_states; DROP TABLE entity_relationships; DROP TABLE entity_profile_fields; DROP TABLE research_cohort_submissions; DROP TABLE research_cohort_participants; DROP TABLE research_cohort_deletion_receipts; DROP TABLE research_wave_events; DROP TABLE research_wave_incidents; DROP TABLE research_waves; DROP TABLE research_events; DROP TABLE research_tasks; DROP TABLE research_enrollments; DROP TABLE visual_events; DROP TABLE storyboard_cards; DROP TABLE storyboards; DROP TABLE visual_candidates; DROP TABLE visual_anchors; DROP TABLE visual_assets; DROP TABLE template_events; DROP TABLE template_applications; DROP TABLE template_grants; DROP TABLE template_package_resources; DROP TABLE template_packages; DROP TABLE template_resources; DROP TABLE sprint_board_cards; DROP TABLE sprint_boards; DROP TABLE sprint_result_cards; DROP TABLE sprint_events; DROP TABLE sprint_samples; DROP TABLE sprint_sessions; DROP TABLE review_decisions; DROP TABLE review_feedback; DROP TABLE review_sessions; DROP TABLE mobile_inbox_actions; DROP TABLE mobile_inbox_items; DROP TABLE sync_conflicts; DROP TABLE sync_updates; DROP TABLE sync_object_versions; DROP TABLE sync_scene_states; DROP TABLE sync_project_configs; DROP TABLE provenance_exports; DROP TABLE provenance_events; DROP TABLE delivery_check_runs; DROP TABLE project_delivery_rule_overrides; DROP TABLE delivery_rules; DROP TABLE delivery_templates; DROP TABLE read_aloud_preferences; DROP TABLE style_sample_preferences; DROP TABLE style_samples; DROP TABLE series_canon_overrides; DROP TABLE series_canon_entries; DROP TABLE series_projects; DROP TABLE series; DROP TABLE knowledge_grants; DROP TABLE knowledge_facts; DROP TABLE foreshadow_events; DROP TABLE foreshadows; DELETE FROM schema_migrations WHERE version IN (3,4,5,6,7,8,9,10,11,12,13,14,15, 16,17,18,19,20);')
    database.db.prepare('DELETE FROM schema_migrations WHERE version=21').run()
    database.close()
    database = new AppDatabase(databasePath)
    expect(database.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='foreshadows'").get()).toMatchObject({ name: 'foreshadows' })
    expect(database.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_facts'").get()).toMatchObject({ name: 'knowledge_facts' })
    expect(fs.readdirSync(path.join(dir, 'backups')).some((name) => name.startsWith('pre-migration-v2-to-v21-'))).toBe(true)
  })

  it('backs up v3 before migrating the role-knowledge schema to v4', () => {
    const databasePath = database.databasePath
    database.db.exec('DROP TABLE story_beat_scenes; DROP TABLE story_beats; DROP TABLE story_blueprints;')
    database.db.exec('DROP TABLE voice_preference_stats; DROP TABLE character_voice_profiles; DROP TABLE style_analysis_runs; DROP TABLE scene_voice_profiles; DROP TABLE project_voice_defaults; DROP TABLE relationship_states; DROP TABLE entity_relationships; DROP TABLE entity_profile_fields; DROP TABLE research_cohort_submissions; DROP TABLE research_cohort_participants; DROP TABLE research_cohort_deletion_receipts; DROP TABLE research_wave_events; DROP TABLE research_wave_incidents; DROP TABLE research_waves; DROP TABLE research_events; DROP TABLE research_tasks; DROP TABLE research_enrollments; DROP TABLE visual_events; DROP TABLE storyboard_cards; DROP TABLE storyboards; DROP TABLE visual_candidates; DROP TABLE visual_anchors; DROP TABLE visual_assets; DROP TABLE template_events; DROP TABLE template_applications; DROP TABLE template_grants; DROP TABLE template_package_resources; DROP TABLE template_packages; DROP TABLE template_resources; DROP TABLE sprint_board_cards; DROP TABLE sprint_boards; DROP TABLE sprint_result_cards; DROP TABLE sprint_events; DROP TABLE sprint_samples; DROP TABLE sprint_sessions; DROP TABLE review_decisions; DROP TABLE review_feedback; DROP TABLE review_sessions; DROP TABLE mobile_inbox_actions; DROP TABLE mobile_inbox_items; DROP TABLE sync_conflicts; DROP TABLE sync_updates; DROP TABLE sync_object_versions; DROP TABLE sync_scene_states; DROP TABLE sync_project_configs; DROP TABLE provenance_exports; DROP TABLE provenance_events; DROP TABLE delivery_check_runs; DROP TABLE project_delivery_rule_overrides; DROP TABLE delivery_rules; DROP TABLE delivery_templates; DROP TABLE read_aloud_preferences; DROP TABLE style_sample_preferences; DROP TABLE style_samples; DROP TABLE series_canon_overrides; DROP TABLE series_canon_entries; DROP TABLE series_projects; DROP TABLE series; DROP TABLE knowledge_grants; DROP TABLE knowledge_facts; DELETE FROM schema_migrations WHERE version IN (4,5,6,7,8,9,10,11,12,13,14,15, 16,17,18,19,20);')
    database.db.prepare('DELETE FROM schema_migrations WHERE version=21').run()
    database.close(); database = new AppDatabase(databasePath)
    expect(database.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()).toMatchObject({ version: 21 })
    expect(fs.readdirSync(path.join(dir, 'backups')).some((name) => name.startsWith('pre-migration-v3-to-v21-'))).toBe(true)
  })

  it('saves immutable revisions and restores as a new revision', () => {
    const project = database.createProject('长夜')
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    const first = database.saveScene(scene.id, doc('第一版'), '第一版')
    database.saveScene(scene.id, doc('第二版'), '第二版')
    const before = database.listRevisions(scene.id)
    expect(before).toHaveLength(2)
    const restored = database.restoreRevision(scene.id, first.currentRevisionId!)
    expect(restored.plainText).toBe('第一版')
    expect(database.listRevisions(scene.id)).toHaveLength(3)
    expect(database.listRevisions(scene.id)[0].sourceType).toBe('restore')
  })

  it('reopens finalized scenes only when their content actually changes', () => {
    const project = database.createProject('完成态真值')
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    database.saveScene(scene.id, doc('定稿正文'), '定稿正文')
    database.updateNode(scene.id, { status: 'published' })

    database.saveScene(scene.id, doc('定稿正文'), '定稿正文')
    expect(database.getNode(scene.id)?.status).toBe('published')
    database.saveScene(scene.id, doc('定稿正文又改了'), '定稿正文又改了')
    expect(database.getNode(scene.id)?.status).toBe('revising')
  })

  it('indexes Chinese scene text for project search', () => {
    const project = database.createProject('长夜')
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    database.saveScene(scene.id, doc('沈砚把佩剑交给林照'), '沈砚把佩剑交给林照')
    expect(database.search(project.id, '佩剑')[0]).toMatchObject({ nodeId: scene.id, title: '场景 1' })
  })

  it('detects preset canon names and aliases in saved scene text', () => {
    const project = database.createProject('长夜')
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    database.createEntity({ projectId: project.id, type: 'character', canonicalName: '林照', aliases: ['阿照'] })
    database.createEntity({ projectId: project.id, type: 'item', canonicalName: '照影剑' })
    database.saveScene(scene.id, doc('阿照握紧照影剑。林照没有回头。'), '阿照握紧照影剑。林照没有回头。')

    expect(database.detectSceneCanon(scene.id)).toEqual([
      { entityId: expect.any(String), canonicalName: '林照', entityType: 'character', matchedNames: ['林照', '阿照'], occurrenceCount: 2 },
      { entityId: expect.any(String), canonicalName: '照影剑', entityType: 'item', matchedNames: ['照影剑'], occurrenceCount: 1 },
    ])
  })

  it('rejects overlapping temporal state intervals', () => {
    const project = database.createProject('长夜')
    const entity = database.createEntity({ projectId: project.id, type: 'item', canonicalName: '照影剑' })
    database.createState({ entityId: entity.id, attributeKey: 'holder', value: '沈砚', validFromNodeId: null, validToNodeId: null, worldTimeFrom: '0012-08-03', worldTimeTo: null, sourceMentionId: null })
    expect(() => database.createState({ entityId: entity.id, attributeKey: 'holder', value: '林照', validFromNodeId: null, validToNodeId: null, worldTimeFrom: '0012-08-04', worldTimeTo: null, sourceMentionId: null })).toThrow(/overlap/)
  })

  it('applies an accepted candidate and appends a canon event atomically', () => {
    const project = database.createProject('长夜')
    const entity = database.createEntity({ projectId: project.id, type: 'character', canonicalName: '沈砚' })
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    const candidate = database.createCandidate({ projectId: project.id, nodeId: scene.id, targetType: 'entity_state', targetId: entity.id, operation: 'set_state', before: null, after: { attributeKey: 'life_status', value: '死亡', worldTimeFrom: '0012-08-03' }, evidence: { quote: '沈砚倒在雨中' }, confidence: 0.95, sourceTaskId: null })
    const resolved = database.resolveCandidate(candidate.id, 'accepted')
    expect(resolved.status).toBe('accepted')
    expect(database.listStates(entity.id)[0]).toMatchObject({ attributeKey: 'life_status', value: '死亡' })
    const events = database.db.prepare('SELECT * FROM canon_events WHERE project_id=?').all(project.id)
    expect(events).toHaveLength(1)
  })

  it('suggests entity mentions without silently confirming them', () => {
    const project = database.createProject('长夜')
    const entity = database.createEntity({ projectId: project.id, type: 'character', canonicalName: '林照', aliases: ['阿照'] })
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    database.saveScene(scene.id, doc('林照看见阿照留的旧信'), '林照看见阿照留的旧信')
    const suggestions = database.suggestMentions(scene.id)
    expect(suggestions).toHaveLength(2)
    expect(suggestions.every((item) => item.entityId === entity.id && !item.confirmed)).toBe(true)
    expect(database.listMentions(scene.id)).toHaveLength(0)
  })

  it('keeps an evidence-backed foreshadow lifecycle and rejects invalid transitions', () => {
    const project = database.createProject('伏笔之书')
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    const clue = database.createForeshadow({ projectId: project.id, title: '停摆的怀表', importance: 'high', plannedPayoff: '揭示失踪时间', nodeId: scene.id, evidence: '指针停在子夜' })
    expect(clue).toMatchObject({ status: 'planted', importance: 'high' })
    expect(clue.events[0]).toMatchObject({ action: 'planted', nodeId: scene.id, evidence: '指针停在子夜' })
    database.transitionForeshadow(clue.id, { action: 'misdirected', nodeId: scene.id, evidence: '众人以为表坏了' })
    const resolved = database.transitionForeshadow(clue.id, { action: 'resolved', nodeId: scene.id, evidence: '表记录了结界停滞' })
    expect(resolved.status).toBe('resolved')
    expect(resolved.events.map((event) => event.action)).toEqual(['planted', 'misdirected', 'resolved'])
    expect(() => database.transitionForeshadow(clue.id, { action: 'misdirected' })).toThrow(/Invalid foreshadow transition/)
  })

  it('stores one evidence-backed knowledge start per character and validates project scope', () => {
    const project = database.createProject('秘密之书'); const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    const character = database.createEntity({ projectId: project.id, type: 'character', canonicalName: '林照' })
    const fact = database.createKnowledgeFact({ projectId: project.id, title: '凶手身份', detail: '凶手是沈砚', keywords: ['沈砚是凶手'], firstRevealedNodeId: scene.id })
    const grant = database.grantKnowledge(fact.id, { entityId: character.id, knownFromNodeId: scene.id, evidence: '林照读完密信' })
    expect(grant).toMatchObject({ entityId: character.id, knownFromNodeId: scene.id, evidence: '林照读完密信' })
    database.grantKnowledge(fact.id, { entityId: character.id, knownFromNodeId: scene.id, evidence: '更新证据' })
    expect(database.getKnowledgeFact(fact.id)?.grants).toHaveLength(1)
    expect(database.getKnowledgeFact(fact.id)?.grants[0].evidence).toBe('更新证据')
    const other = database.createProject('别处'); const otherScene = database.listNodes(other.id).find((node) => node.type === 'scene')!
    expect(() => database.grantKnowledge(fact.id, { entityId: character.id, knownFromNodeId: otherScene.id })).toThrow(/invalid/)
  })

  it('applies a scoped global replace and undoes the whole batch exactly', () => {
    const project = database.createProject('旧名之书')
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    database.saveScene(scene.id, doc('旧名与既有新名'), '旧名与既有新名')
    const entity = database.createEntity({ projectId: project.id, type: 'character', canonicalName: '旧名', summary: '人称旧名' })
    const preview = database.previewReplace(project.id, '旧名', '新名', ['body', 'title', 'canon'])
    expect(preview.reduce((sum, item) => sum + item.occurrences, 0)).toBeGreaterThanOrEqual(3)
    const batch = database.applyReplace(project.id, '旧名', '新名', ['body', 'title', 'canon'])
    expect(database.getScene(scene.id)?.plainText).toBe('新名与既有新名')
    expect(database.getEntity(entity.id)?.canonicalName).toBe('新名')
    database.undoReplace(batch.id)
    expect(database.getScene(scene.id)?.plainText).toBe('旧名与既有新名')
    expect(database.getEntity(entity.id)?.canonicalName).toBe('旧名')
  })

  it('trashes and restores every descendant recursively', () => {
    const project = database.createProject('树')
    const book = database.listNodes(project.id).find((node) => node.type === 'book')!
    const volume = database.createNode({ projectId: project.id, parentId: book.id, type: 'volume', title: '卷一' })
    const chapter = database.createNode({ projectId: project.id, parentId: volume.id, type: 'chapter', title: '章一' })
    const scene = database.createNode({ projectId: project.id, parentId: chapter.id, type: 'scene', title: '场一' })
    database.softDeleteNode(volume.id, true)
    expect(database.getNode(scene.id)?.deletedAt).not.toBeNull()
    database.softDeleteNode(volume.id, false)
    expect(database.getNode(scene.id)?.deletedAt).toBeNull()
  })

  it('repairs a confirmed mention anchor after text moves', () => {
    const project = database.createProject('反链')
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    const entity = database.createEntity({ projectId: project.id, type: 'character', canonicalName: '林照' })
    database.saveScene(scene.id, doc('林照来了'), '林照来了')
    database.createMention({ entityId: entity.id, nodeId: scene.id, quote: '林照', startOffset: 0, endOffset: 2, confirmed: true })
    database.saveScene(scene.id, doc('雨停了，林照来了'), '雨停了，林照来了')
    expect(database.listMentions(scene.id)[0]).toMatchObject({ startOffset: 4, endOffset: 6 })
  })

  it('handles a 200k-character project payload within the performance budget', () => {
    const project = database.createProject('长篇性能')
    const scene = database.listNodes(project.id).find((node) => node.type === 'scene')!
    const text = `${'长夜无声。'.repeat(39_999)}唯一线索`
    const start = performance.now()
    database.saveScene(scene.id, doc(text), text)
    expect(database.search(project.id, '唯一线索')[0]?.nodeId).toBe(scene.id)
    expect(performance.now() - start).toBeLessThan(2_000)
  })
})

function doc(text: string) { return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } }
