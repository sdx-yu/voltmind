import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { z } from 'zod'
import { Packer, Document, Paragraph, HeadingLevel } from 'docx'
import type { AppConfig } from './config.js'
import { AppDatabase } from './db.js'
import { LocalVault } from './vault.js'
import { AiService } from './ai.js'
import { checkContinuity } from './continuity.js'
import { checkPovKnowledge } from './knowledge.js'
import { runDeliveryCheck } from './delivery.js'
import { buildProvenanceBundle, renderProvenanceHtml, verifyProvenanceBundle } from './provenance.js'
import { SyncService } from './sync.js'
import { ReviewService } from './review.js'
import { SprintService } from './sprint.js'
import { TemplateService } from './template.js'
import { VisualService } from './visual.js'
import { ResearchService, buildReleaseReadiness, buildSupportBundle } from './research.js'
import { ResearchCohortService } from './researchCohort.js'
import { ResearchWaveService } from './researchWave.js'
import type { VisualSelectedField } from '../shared/types.js'
import { compareStoryTime, describeStoryTime } from '../shared/storyTime.js'
import { newId, nowIso, sha256 } from './utils.js'

const nodeInput = z.object({ parentId: z.string().nullable(), type: z.enum(['book', 'volume', 'chapter', 'scene']), title: z.string().trim().min(1).max(200), sortKey: z.number().int().optional() })
const storyTimeInput = z.object({
  version: z.literal(1), mode: z.enum(['calendar', 'custom', 'relative', 'sequence']), precision: z.enum(['exact', 'day', 'month', 'year', 'approximate']), displayLabel: z.string().max(120),
  calendarDate: z.string().max(10), clockTime: z.string().max(5), era: z.string().max(40), eraOrder: z.number().int().min(1).max(9999), year: z.number().int().min(0).max(99999).nullable(), month: z.number().int().min(1).max(99).nullable(), day: z.number().int().min(1).max(99).nullable(), period: z.string().max(20),
  anchorNodeId: z.string().nullable(), relation: z.enum(['before', 'same', 'after']), offsetValue: z.number().int().min(0).max(99999), offsetUnit: z.enum(['scene', 'hour', 'day', 'month', 'year']),
}).superRefine((value, context) => {
  if (value.mode === 'calendar' && !isValidCalendarDate(value.calendarDate)) context.addIssue({ code: 'custom', message: '请选择有效的现代日期' })
  if (value.clockTime && !isValidClockTime(value.clockTime)) context.addIssue({ code: 'custom', message: '时刻格式不正确' })
  if (value.mode === 'custom' && value.year === null) context.addIssue({ code: 'custom', message: '古风或自定义纪年需要填写年份' })
  if ((value.mode === 'relative' || value.mode === 'sequence') && !value.anchorNodeId) context.addIssue({ code: 'custom', message: '请选择作为时间锚点的场景' })
  if (value.mode === 'relative' && value.relation !== 'same' && value.offsetValue < 1) context.addIssue({ code: 'custom', message: '相对时间的间隔至少为 1' })
})
const sceneInput = z.object({ contentJson: z.record(z.string(), z.unknown()), plainText: z.string(), sourceType: z.enum(['human', 'import', 'ai_accepted', 'restore', 'merge']).default('human'), sourceTaskId: z.string().nullable().default(null) })
const entityInput = z.object({ type: z.enum(['character', 'location', 'item', 'event']), canonicalName: z.string().trim().min(1).max(100), aliases: z.array(z.string()).default([]), summary: z.string().default(''), privacyLevel: z.enum(['normal', 'author_only', 'local_private']).default('normal') })
const privacyLevel = z.enum(['normal', 'author_only', 'local_private'])
const profileFieldInput = z.object({ category: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(60), value: z.string().max(5000).default(''), sortKey: z.number().int().optional(), privacyLevel: privacyLevel.default('author_only') })
const relationshipInput = z.object({ sourceEntityId: z.string(), targetEntityId: z.string(), relationType: z.string().trim().min(1).max(60), direction: z.enum(['directed', 'mutual']).default('mutual'), label: z.string().trim().max(80).default(''), summary: z.string().max(2000).default(''), privacyLevel: privacyLevel.default('normal') })
const relationshipStateInput = z.object({ statusLabel: z.string().trim().min(1).max(80), note: z.string().max(2000).default(''), validFromNodeId: z.string().nullable().default(null), validToNodeId: z.string().nullable().default(null), worldTimeFrom: z.string().nullable().default(null), worldTimeTo: z.string().nullable().default(null), sourceNodeId: z.string().nullable().default(null), evidence: z.string().max(2000).default('') })
const replaceInput = z.object({ query: z.string().min(1), replacement: z.string(), scopes: z.array(z.enum(['body', 'title', 'canon'])).min(1) })
const foreshadowStatus = z.enum(['planted', 'reinforced', 'misdirected', 'resolved'])
const foreshadowInput = z.object({ title: z.string().trim().min(1).max(120), summary: z.string().max(1000).default(''), importance: z.enum(['low', 'medium', 'high']).default('medium'), plannedPayoff: z.string().max(1000).default(''), nodeId: z.string().nullable().optional(), evidence: z.string().max(1000).default(''), note: z.string().max(1000).default('') })
const knowledgeInput = z.object({ title: z.string().trim().min(1).max(120), detail: z.string().max(2000).default(''), keywords: z.array(z.string().trim().min(2).max(100)).min(1).max(20), firstRevealedNodeId: z.string().nullable().default(null), privacyLevel: z.enum(['normal', 'author_only', 'local_private']).default('author_only') })
const seriesInput = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(1000).default(''), projectId: z.string() })
const seriesCanonInput = z.object({ type: z.enum(['character', 'location', 'item', 'event']), canonicalName: z.string().trim().min(1).max(100), aliases: z.array(z.string()).default([]), summary: z.string().max(3000).default(''), privacyLevel: z.enum(['normal', 'author_only', 'local_private']).default('normal') })
const seriesOverrideInput = z.object({ canonicalName: z.string().trim().min(1).max(100), aliases: z.array(z.string()).default([]), summary: z.string().max(3000).default(''), privacyLevel: z.enum(['normal', 'author_only', 'local_private']).default('normal') })
const styleSampleInput = z.object({ title: z.string().trim().min(1).max(120), content: z.string().trim().min(1).max(20000), guidance: z.string().max(1000).default(''), privacyLevel: z.enum(['normal', 'author_only', 'local_private']).default('author_only'), enabled: z.boolean().default(true) })
const voiceInput = z.object({
  family: z.enum(['natural', 'restrained', 'bright', 'delicate', 'hard', 'classical', 'uncanny', 'poetic']).optional(),
  intensity: z.enum(['light', 'standard', 'vivid']).optional(),
  pace: z.enum(['slow', 'balanced', 'fast']).optional(),
  imagery: z.enum(['low', 'medium', 'high']).optional(),
  distance: z.enum(['close', 'medium', 'distant']).optional(),
  interiority: z.enum(['light', 'medium', 'deep']).optional(),
  intents: z.array(z.enum(['advance_conflict', 'build_pressure', 'ease_pace', 'deepen_emotion', 'build_suspense', 'strengthen_image', 'drive_dialogue', 'stay_objective'])).max(3).optional(),
  register: z.enum(['literary', 'balanced', 'vernacular']).optional(),
  sentence: z.enum(['short', 'mixed', 'long']).optional(),
  dialogue: z.enum(['sparse', 'balanced', 'heavy']).optional(),
  allusion: z.enum(['none', 'light', 'dense']).optional(),
  slang: z.enum(['avoid', 'light', 'ok']).optional(),
  authorNote: z.string().max(400).optional(),
})
const selectionAnchorInput = z.object({ nodeId: z.string(), sourceContentHash: z.string().length(64), startOffset: z.number().int().nonnegative(), endOffset: z.number().int().nonnegative(), originalText: z.string().min(1).max(5000), contextBefore: z.string().max(200), contextAfter: z.string().max(200) })
const aiTaskInput = z.object({ projectId: z.string(), nodeId: z.string(), taskType: z.enum(['word_inspiration', 'style_rewrite', 'idea_to_prose', 'polish', 'beat', 'brainstorm', 'continue', 'rewrite', 'cold_read', 'continuity', 'extract_facts']), instruction: z.string().default(''), selectedContextIds: z.array(z.string()), selectionAnchor: selectionAnchorInput.optional() })
const characterVoiceInput = z.object({ register: z.enum(['literary', 'balanced', 'vernacular']).optional(), sentence: z.enum(['short', 'mixed', 'long']).optional(), directness: z.enum(['indirect', 'balanced', 'direct']).optional(), emotion: z.enum(['restrained', 'balanced', 'expressive']).optional(), signature: z.string().max(200).optional(), avoid: z.string().max(200).optional() })
const reviewPhraseInput = z.object({ recoveryPhrase: z.string().min(1).max(200) })
const reviewPackageInput = reviewPhraseInput.extend({ package: z.unknown() })

export function createApp(config: AppConfig, database = new AppDatabase(config.databasePath)) {
  const app = express()
  const vault = new LocalVault(config.dataDir)
  const ai = new AiService(database, vault)
  const sync = new SyncService(database)
  const reviews = new ReviewService(database)
  const sprints = new SprintService(database)
  const templates = new TemplateService(database)
  const visuals = new VisualService(database)
  const research = new ResearchService(database)
  const researchCohort = new ResearchCohortService(database)
  const researchWaves = new ResearchWaveService(database)
  const sessionToken = randomBytes(24).toString('hex')
  const allowedOrigins = new Set([`http://${config.host}:4318`, `http://${config.host}:${config.port}`])

  app.disable('x-powered-by')
  app.use((req, res, next) => { const origin = req.headers.origin; if (origin && !allowedOrigins.has(origin)) return res.status(403).json({ error: 'Origin is not allowed' }); next() })
  app.use(cors({ origin: [...allowedOrigins], credentials: true }))
  app.use(express.json({ limit: '50mb' }))

  app.get('/api/health', (_req, res) => res.json({ ok: true, integrity: database.integrityCheck(), rescueMode: false, time: nowIso() }))
  app.post('/api/session', (req, res) => {
    if (!isLoopback(req.ip)) return res.status(403).json({ error: 'Only loopback clients are allowed' })
    res.setHeader('Set-Cookie', `bbd_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`)
    return res.json({ ok: true })
  })
  app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path === '/session') return next()
    const cookie = parseCookies(req.headers.cookie ?? '').bbd_session
    if (cookie !== sessionToken) return res.status(401).json({ error: 'Local session required' })
    return next()
  })

  app.get('/api/projects', (req, res) => res.json(database.listProjects(req.query.trash === '1')))
  app.post('/api/projects', route(async (req, res) => {
    const input = z.object({ title: z.string().trim().min(1).max(200), description: z.string().default('') }).parse(req.body)
    res.status(201).json(database.createProject(input.title, input.description))
  }))
  app.patch('/api/projects/:id', route(async (req, res) => {
    const input = z.object({ title: z.string().trim().min(1).max(200).optional(), description: z.string().optional(), deletedAt: z.string().nullable().optional() }).parse(req.body)
    const result = database.updateProject(param(req, 'id'), input)
    if (!result) return res.status(404).json({ error: 'Project not found' })
    res.json(result)
  }))
  app.delete('/api/projects/:id', route(async (req, res) => {
    const result = database.updateProject(param(req, 'id'), { deletedAt: nowIso() })
    if (!result) return res.status(404).json({ error: 'Project not found' })
    res.json(result)
  }))
  app.post('/api/projects/:id/restore', route(async (req, res) => {
    const result = database.updateProject(param(req, 'id'), { deletedAt: null })
    if (!result) return res.status(404).json({ error: 'Project not found' })
    res.json(result)
  }))
  app.get('/api/projects/:id/tree', route(async (req, res) => res.json(database.listNodes(param(req, 'id'), req.query.trash === '1'))))
  app.post('/api/projects/:id/nodes', route(async (req, res) => res.status(201).json(database.createNode({ projectId: param(req, 'id'), ...nodeInput.parse(req.body) }))))
  app.patch('/api/nodes/:id', route(async (req, res) => {
    const input = z.object({ parentId: z.string().nullable().optional(), title: z.string().trim().min(1).max(200).optional(), sortKey: z.number().int().optional(), status: z.enum(['idea', 'planned', 'draft', 'revising']).optional(), povEntityId: z.string().nullable().optional(), storyTime: z.string().max(120).nullable().optional(), storyTimeSpec: storyTimeInput.nullable().optional() }).parse(req.body)
    const nodeId = param(req, 'id'); const current = database.getNode(nodeId)
    if (!current) return res.status(404).json({ error: 'Node not found' })
    if (input.storyTimeSpec?.anchorNodeId) {
      const seen = new Set([nodeId]); let anchorId: string | null = input.storyTimeSpec.anchorNodeId
      while (anchorId) {
        if (seen.has(anchorId)) return res.status(400).json({ error: '故事时间不能形成循环引用' })
        seen.add(anchorId)
        const anchor = database.getNode(anchorId)
        if (!anchor || anchor.type !== 'scene' || anchor.projectId !== current.projectId || anchor.deletedAt) return res.status(400).json({ error: '时间锚点必须是本作品中有效的场景' })
        anchorId = anchor.storyTimeSpec?.anchorNodeId ?? null
      }
    }
    if (input.storyTimeSpec) {
      const nodes = database.listNodes(current.projectId)
      const nextNode = { ...current, ...input }
      input.storyTime = describeStoryTime(nextNode, nodes.map((item) => item.id === nodeId ? nextNode : item))
    }
    const result = database.updateNode(nodeId, input)
    res.json(result)
  }))
  app.delete('/api/nodes/:id', route(async (req, res) => {
    const result = database.softDeleteNode(param(req, 'id'), true)
    if (!result) return res.status(404).json({ error: 'Node not found' })
    res.json(result)
  }))
  app.post('/api/nodes/:id/restore', route(async (req, res) => {
    const result = database.softDeleteNode(param(req, 'id'), false)
    if (!result) return res.status(404).json({ error: 'Node not found' })
    const input = z.object({ parentId: z.string().nullable().optional() }).parse(req.body ?? {})
    res.json(input.parentId === undefined ? result : database.updateNode(result.id, { parentId: input.parentId }))
  }))
  app.post('/api/nodes/:id/split', route(async (req, res) => {
    const node = database.getNode(param(req, 'id')); const scene = database.getScene(param(req, 'id'))
    if (!node || !scene || node.type !== 'scene') return res.status(404).json({ error: 'Scene not found' })
    const offset = z.object({ offset: z.number().int().min(1).max(Math.max(1, scene.plainText.length - 1)) }).parse(req.body).offset
    const before = scene.plainText.slice(0, offset).trimEnd(); const after = scene.plainText.slice(offset).trimStart()
    if (!before || !after) return res.status(400).json({ error: '拆分点两侧都需要有正文' })
    const next = database.transaction(() => { const created = database.createNode({ projectId: node.projectId, parentId: node.parentId, type: 'scene', title: `${node.title}（下）`, sortKey: node.sortKey + 1 }); database.saveScene(node.id, plainTextDoc(before), before, 'merge'); database.saveScene(created.id, plainTextDoc(after), after, 'merge'); return created })
    res.status(201).json(next)
  }))
  app.post('/api/nodes/:id/merge-next', route(async (req, res) => {
    const node = database.getNode(param(req, 'id')); if (!node || node.type !== 'scene') return res.status(404).json({ error: 'Scene not found' })
    const next = database.listNodes(node.projectId).filter((item) => item.type === 'scene' && item.parentId === node.parentId && item.sortKey > node.sortKey).sort((a, b) => a.sortKey - b.sortKey)[0]
    if (!next) return res.status(409).json({ error: '没有可合并的下一场景' })
    const text = [database.getScene(node.id)?.plainText ?? '', database.getScene(next.id)?.plainText ?? ''].filter(Boolean).join('\n\n')
    database.transaction(() => { database.saveScene(node.id, plainTextDoc(text), text, 'merge'); database.softDeleteNode(next.id, true) })
    res.json({ node: database.getNode(node.id), mergedNodeId: next.id })
  }))

  app.get('/api/scenes/:id', route(async (req, res) => {
    const scene = database.getScene(param(req, 'id'))
    if (!scene) return res.status(404).json({ error: 'Scene not found' })
    res.json(scene)
  }))
  app.put('/api/scenes/:id', route(async (req, res) => {
    const nodeId = param(req, 'id')
    const document = database.saveScene(nodeId, ...sceneArgs(sceneInput.parse(req.body)))
    res.json({ document, node: database.getNode(nodeId) })
  }))
  app.get('/api/scenes/:id/revisions', route(async (req, res) => res.json(database.listRevisions(param(req, 'id')))))
  app.post('/api/scenes/:id/revisions/:revisionId/restore', route(async (req, res) => res.json(database.restoreRevision(param(req, 'id'), param(req, 'revisionId')))))
  app.post('/api/scenes/:id/complete', route(async (req, res) => {
    const node = database.getNode(param(req, 'id')); const scene = database.getScene(param(req, 'id'))
    if (!node || !scene) return res.status(404).json({ error: 'Scene not found' })
    if (node.status === 'complete' || node.status === 'published') return res.status(409).json({ error: '场景已经完成；如需修改，请先进入修订' })
    const candidates = database.transaction(() => { const extracted = extractFactCandidates(database, node.id); database.updateNode(node.id, { status: 'complete' }); return extracted })
    const entities = database.listEntities(node.projectId); const states = entities.flatMap((entity) => database.listStates(entity.id))
    const issues = checkContinuity({ node: database.getNode(node.id)!, plainText: scene.plainText, entities, states, nodes: database.listNodes(node.projectId) })
    res.json({ node: database.getNode(node.id), candidates, issues })
  }))
  app.get('/api/projects/:id/search', route(async (req, res) => res.json(database.search(param(req, 'id'), String(req.query.q ?? '')))))
  app.post('/api/projects/:id/replace/preview', route(async (req, res) => {
    const input = replaceInput.parse(req.body); res.json(database.previewReplace(param(req, 'id'), input.query, input.replacement, input.scopes))
  }))
  app.post('/api/projects/:id/replace', route(async (req, res) => {
    const input = replaceInput.parse(req.body); res.status(201).json(database.applyReplace(param(req, 'id'), input.query, input.replacement, input.scopes))
  }))
  app.post('/api/replace-batches/:id/undo', route(async (req, res) => res.json(database.undoReplace(param(req, 'id')))))

  app.get('/api/projects/:id/entities', route(async (req, res) => res.json(database.listEntities(param(req, 'id'), req.query.trash === '1'))))
  app.post('/api/projects/:id/entities', route(async (req, res) => res.status(201).json(database.createEntity({ projectId: param(req, 'id'), ...entityInput.parse(req.body) }))))
  app.patch('/api/entities/:id', route(async (req, res) => {
    const input = entityInput.partial().extend({ deletedAt: z.string().nullable().optional() }).parse(req.body)
    const result = database.updateEntity(param(req, 'id'), input)
    if (!result) return res.status(404).json({ error: 'Entity not found' })
    res.json(result)
  }))
  app.delete('/api/entities/:id', route(async (req, res) => {
    const result = database.updateEntity(param(req, 'id'), { deletedAt: nowIso() }); if (!result) return res.status(404).json({ error: 'Entity not found' }); res.json(result)
  }))
  app.post('/api/entities/:id/restore', route(async (req, res) => {
    const result = database.updateEntity(param(req, 'id'), { deletedAt: null }); if (!result) return res.status(404).json({ error: 'Entity not found' }); res.json(result)
  }))
  app.get('/api/projects/:id/foreshadows', route(async (req, res) => res.json(database.listForeshadows(param(req, 'id'), req.query.trash === '1'))))
  app.post('/api/projects/:id/foreshadows', route(async (req, res) => res.status(201).json(database.createForeshadow({ projectId: param(req, 'id'), ...foreshadowInput.parse(req.body) }))))
  app.patch('/api/foreshadows/:id', route(async (req, res) => {
    const input = z.object({ title: z.string().trim().min(1).max(120).optional(), summary: z.string().max(1000).optional(), importance: z.enum(['low', 'medium', 'high']).optional(), plannedPayoff: z.string().max(1000).optional(), deletedAt: z.string().nullable().optional() }).parse(req.body)
    const result = database.updateForeshadow(param(req, 'id'), input); if (!result) return res.status(404).json({ error: 'Foreshadow not found' }); res.json(result)
  }))
  app.delete('/api/foreshadows/:id', route(async (req, res) => {
    const result = database.updateForeshadow(param(req, 'id'), { deletedAt: nowIso() }); if (!result) return res.status(404).json({ error: 'Foreshadow not found' }); res.json(result)
  }))
  app.post('/api/foreshadows/:id/transitions', route(async (req, res) => {
    const input = z.object({ action: foreshadowStatus, nodeId: z.string().nullable().optional(), evidence: z.string().max(1000).default(''), note: z.string().max(1000).default('') }).parse(req.body)
    res.json(database.transitionForeshadow(param(req, 'id'), input))
  }))
  app.get('/api/projects/:id/knowledge', route(async (req, res) => res.json(database.listKnowledgeFacts(param(req, 'id'), req.query.trash === '1'))))
  app.post('/api/projects/:id/knowledge', route(async (req, res) => res.status(201).json(database.createKnowledgeFact({ projectId: param(req, 'id'), ...knowledgeInput.parse(req.body) }))))
  app.patch('/api/knowledge/:id', route(async (req, res) => {
    const input = knowledgeInput.partial().extend({ deletedAt: z.string().nullable().optional() }).parse(req.body)
    const result = database.updateKnowledgeFact(param(req, 'id'), input); if (!result) return res.status(404).json({ error: 'Knowledge fact not found' }); res.json(result)
  }))
  app.delete('/api/knowledge/:id', route(async (req, res) => {
    const result = database.updateKnowledgeFact(param(req, 'id'), { deletedAt: nowIso() }); if (!result) return res.status(404).json({ error: 'Knowledge fact not found' }); res.json(result)
  }))
  app.put('/api/knowledge/:id/grants/:entityId', route(async (req, res) => {
    const input = z.object({ knownFromNodeId: z.string(), sourceNodeId: z.string().nullable().default(null), evidence: z.string().max(1000).default(''), note: z.string().max(1000).default('') }).parse(req.body)
    res.json(database.grantKnowledge(param(req, 'id'), { entityId: param(req, 'entityId'), ...input }))
  }))
  app.delete('/api/knowledge/:id/grants/:entityId', route(async (req, res) => res.json({ ok: database.revokeKnowledgeGrant(param(req, 'id'), param(req, 'entityId')) })))
  app.get('/api/series', route(async (_req, res) => res.json(database.listSeries())))
  app.post('/api/series', route(async (req, res) => res.status(201).json(database.createSeries(seriesInput.parse(req.body)))))
  app.get('/api/projects/:id/series', route(async (req, res) => res.json(database.getSeriesForProject(param(req, 'id')))))
  app.patch('/api/series/:id', route(async (req, res) => {
    const input = z.object({ actorProjectId: z.string(), name: z.string().trim().min(1).max(120).optional(), description: z.string().max(1000).optional() }).parse(req.body)
    res.json(requireFound(database.updateSeries(param(req, 'id'), input, input.actorProjectId), 'Series'))
  }))
  app.put('/api/series/:id/projects/:projectId', route(async (req, res) => {
    const { actorProjectId } = z.object({ actorProjectId: z.string() }).parse(req.body)
    res.json(database.addProjectToSeries(param(req, 'id'), param(req, 'projectId'), actorProjectId))
  }))
  app.delete('/api/series/:id/projects/:projectId', route(async (req, res) => {
    const actorProjectId = z.string().parse(req.query.actorProjectId)
    res.json({ ok: database.removeProjectFromSeries(param(req, 'id'), param(req, 'projectId'), actorProjectId) })
  }))
  app.get('/api/projects/:id/series-canon', route(async (req, res) => res.json(database.listSeriesCanonForProject(param(req, 'id')))))
  app.post('/api/series/:id/canon', route(async (req, res) => {
    const input = z.object({ actorProjectId: z.string(), entry: seriesCanonInput }).parse(req.body)
    res.status(201).json(database.createSeriesCanon({ seriesId: param(req, 'id'), actorProjectId: input.actorProjectId, ...input.entry }))
  }))
  app.patch('/api/series-canon/:id', route(async (req, res) => {
    const input = z.object({ actorProjectId: z.string(), patch: seriesCanonInput.partial() }).parse(req.body)
    res.json(requireFound(database.updateSeriesCanon(param(req, 'id'), input.patch, input.actorProjectId), 'Series canon entry'))
  }))
  app.delete('/api/series-canon/:id', route(async (req, res) => {
    const actorProjectId = z.string().parse(req.query.actorProjectId)
    res.json(requireFound(database.updateSeriesCanon(param(req, 'id'), { deletedAt: nowIso() }, actorProjectId), 'Series canon entry'))
  }))
  app.put('/api/series-canon/:id/overrides/:projectId', route(async (req, res) => res.json(database.upsertSeriesCanonOverride(param(req, 'id'), param(req, 'projectId'), seriesOverrideInput.parse(req.body)))))
  app.delete('/api/series-canon/:id/overrides/:projectId', route(async (req, res) => res.json({ ok: database.deleteSeriesCanonOverride(param(req, 'id'), param(req, 'projectId')) })))
  app.get('/api/projects/:projectId/scenes/:nodeId/voice', route(async (req, res) => res.json(database.getVoiceProfile(param(req, 'projectId'), param(req, 'nodeId')))))
  app.put('/api/projects/:projectId/scenes/:nodeId/voice', route(async (req, res) => res.json(database.saveVoiceProfile(param(req, 'projectId'), param(req, 'nodeId'), voiceInput.parse(req.body)))))
  app.delete('/api/projects/:projectId/scenes/:nodeId/voice', route(async (req, res) => res.json(database.resetVoiceProfile(param(req, 'projectId'), param(req, 'nodeId')))))
  app.get('/api/projects/:id/voice-default', route(async (req, res) => res.json(database.getProjectVoiceProfile(param(req, 'id')))))
  app.put('/api/projects/:id/voice-default', route(async (req, res) => res.json(database.saveProjectVoiceDefault(param(req, 'id'), voiceInput.parse(req.body)))))
  app.post('/api/projects/:id/voice-analyses', route(async (req, res) => {
    const input = z.object({ sampleIds: z.array(z.string()).min(1).max(20) }).parse(req.body)
    res.status(201).json(database.analyzeStyleSamples(param(req, 'id'), input.sampleIds))
  }))
  app.get('/api/projects/:id/voice-analyses', route(async (req, res) => res.json(database.listStyleAnalyses(param(req, 'id')))))
  app.post('/api/projects/:id/voice-analyses/:runId/confirm', route(async (req, res) => res.json(database.confirmStyleAnalysis(param(req, 'id'), param(req, 'runId'), voiceInput.parse(req.body ?? {})))))
  app.get('/api/projects/:projectId/scenes/:nodeId/voice-consistency', route(async (req, res) => res.json(database.getVoiceConsistency(param(req, 'projectId'), param(req, 'nodeId')))))
  app.get('/api/projects/:projectId/characters/:entityId/voice', route(async (req, res) => res.json(database.getCharacterVoice(param(req, 'projectId'), param(req, 'entityId')))))
  app.put('/api/projects/:projectId/characters/:entityId/voice', route(async (req, res) => res.json(database.saveCharacterVoice(param(req, 'projectId'), param(req, 'entityId'), characterVoiceInput.parse(req.body)))))
  app.get('/api/projects/:id/voice-preferences', route(async (req, res) => res.json(database.listVoicePreferences(param(req, 'id')))))
  app.delete('/api/projects/:id/voice-preferences', route(async (req, res) => res.json({ ok: database.clearVoicePreferences(param(req, 'id')) })))
  app.get('/api/projects/:id/style-samples', route(async (req, res) => res.json(database.listStyleSamples(param(req, 'id'), req.query.trash === '1'))))
  app.post('/api/projects/:id/style-samples', route(async (req, res) => res.status(201).json(database.createStyleSample({ projectId: param(req, 'id'), actorProjectId: param(req, 'id'), ...styleSampleInput.parse(req.body) }))))
  app.post('/api/series/:id/style-samples', route(async (req, res) => {
    const input = z.object({ actorProjectId: z.string(), sample: styleSampleInput }).parse(req.body)
    res.status(201).json(database.createStyleSample({ seriesId: param(req, 'id'), actorProjectId: input.actorProjectId, ...input.sample }))
  }))
  app.patch('/api/style-samples/:id', route(async (req, res) => {
    const input = z.object({ projectId: z.string(), patch: styleSampleInput.partial().extend({ deletedAt: z.string().nullable().optional() }) }).parse(req.body)
    res.json(requireFound(database.updateStyleSample(param(req, 'id'), input.projectId, input.patch), 'Style sample'))
  }))
  app.delete('/api/style-samples/:id', route(async (req, res) => {
    const projectId = z.string().parse(req.query.projectId)
    res.json(requireFound(database.updateStyleSample(param(req, 'id'), projectId, { deletedAt: nowIso() }), 'Style sample'))
  }))
  app.put('/api/style-samples/:id/preferences/:projectId', route(async (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body)
    res.json(database.setStyleSamplePreference(param(req, 'id'), param(req, 'projectId'), enabled))
  }))
  app.get('/api/entities/:id/mentions', route(async (req, res) => {
    const rows = database.db.prepare('SELECT * FROM mentions WHERE entity_id=? ORDER BY created_at DESC').all(param(req, 'id'))
    res.json(rows.map((row: any) => ({ id: String(row.id), entityId: String(row.entity_id), nodeId: String(row.node_id), quote: String(row.quote), startOffset: Number(row.start_offset), endOffset: Number(row.end_offset), confirmed: Boolean(row.confirmed), createdAt: String(row.created_at) })))
  }))
  app.get('/api/entities/:id/states', route(async (req, res) => res.json(database.listStates(param(req, 'id')))))
  app.post('/api/entities/:id/states', route(async (req, res) => {
    const input = z.object({ attributeKey: z.string().min(1), value: z.unknown(), validFromNodeId: z.string().nullable().default(null), validToNodeId: z.string().nullable().default(null), worldTimeFrom: z.string().nullable().default(null), worldTimeTo: z.string().nullable().default(null), sourceMentionId: z.string().nullable().default(null) }).parse(req.body)
    res.status(201).json(database.createState({ entityId: param(req, 'id'), ...input }))
  }))
  app.get('/api/entities/:id/profile-fields', route(async (req, res) => res.json(database.listProfileFields(param(req, 'id')))))
  app.post('/api/entities/:id/profile-fields', route(async (req, res) => res.status(201).json(database.createProfileField({ entityId: param(req, 'id'), ...profileFieldInput.parse(req.body) }))))
  app.patch('/api/profile-fields/:id', route(async (req, res) => res.json(requireFound(database.updateProfileField(param(req, 'id'), profileFieldInput.partial().parse(req.body)), 'Profile field'))))
  app.delete('/api/profile-fields/:id', route(async (req, res) => res.json({ ok: database.deleteProfileField(param(req, 'id')) })))

  app.get('/api/projects/:id/relationships', route(async (req, res) => res.json(database.listRelationships(param(req, 'id'), typeof req.query.entityId === 'string' ? req.query.entityId : null, typeof req.query.atNodeId === 'string' ? req.query.atNodeId : null, req.query.trash === '1'))))
  app.post('/api/projects/:id/relationships', route(async (req, res) => res.status(201).json(database.createRelationship({ projectId: param(req, 'id'), ...relationshipInput.parse(req.body) }))))
  app.patch('/api/relationships/:id', route(async (req, res) => res.json(requireFound(database.updateRelationship(param(req, 'id'), relationshipInput.omit({ sourceEntityId: true, targetEntityId: true }).partial().extend({ deletedAt: z.string().nullable().optional() }).parse(req.body)), 'Relationship'))))
  app.delete('/api/relationships/:id', route(async (req, res) => res.json(requireFound(database.updateRelationship(param(req, 'id'), { deletedAt: nowIso() }), 'Relationship'))))
  app.post('/api/relationships/:id/states', route(async (req, res) => res.status(201).json(database.createRelationshipState({ relationshipId: param(req, 'id'), ...relationshipStateInput.parse(req.body) }))))

  app.get('/api/scenes/:id/mentions', route(async (req, res) => res.json(database.listMentions(param(req, 'id')))))
  app.get('/api/scenes/:id/current-states', route(async (req, res) => res.json(currentStatesAtScene(database, param(req, 'id')))))
  app.get('/api/scenes/:id/mention-suggestions', route(async (req, res) => res.json(database.suggestMentions(param(req, 'id')))))
  app.get('/api/scenes/:id/canon-detections', route(async (req, res) => res.json(database.detectSceneCanon(param(req, 'id')))))
  app.post('/api/scenes/:id/mentions', route(async (req, res) => {
    const input = z.object({ entityId: z.string(), quote: z.string(), startOffset: z.number().int().nonnegative(), endOffset: z.number().int().positive(), confirmed: z.boolean().default(true) }).parse(req.body)
    res.status(201).json(database.createMention({ nodeId: param(req, 'id'), ...input }))
  }))

  app.get('/api/projects/:id/candidates', route(async (req, res) => res.json(database.listCandidates(param(req, 'id'), String(req.query.status ?? 'pending')))))
  app.post('/api/projects/:id/candidates', route(async (req, res) => {
    const input = z.object({ nodeId: z.string().nullable().default(null), targetType: z.string(), targetId: z.string().nullable().default(null), operation: z.string(), before: z.unknown().default(null), after: z.unknown(), evidence: z.object({ quote: z.string().optional(), startOffset: z.number().optional(), endOffset: z.number().optional(), reason: z.string().optional() }).default({}), confidence: z.number().min(0).max(1).default(1), sourceTaskId: z.string().nullable().default(null) }).parse(req.body)
    res.status(201).json(database.createCandidate({ projectId: param(req, 'id'), ...input }))
  }))
  app.post('/api/candidates/:id/resolve', route(async (req, res) => {
    const input = z.object({ status: z.enum(['accepted', 'accepted_modified', 'ignored', 'exception']), modifiedAfter: z.unknown().optional() }).parse(req.body)
    res.json(database.resolveCandidate(param(req, 'id'), input.status, input.modifiedAfter))
  }))

  app.get('/api/scenes/:id/check', route(async (req, res) => {
    const node = database.getNode(param(req, 'id'))
    const scene = database.getScene(param(req, 'id'))
    if (!node || !scene) return res.status(404).json({ error: 'Scene not found' })
    const entities = database.listEntities(node.projectId)
    const states = entities.flatMap((entity) => database.listStates(entity.id))
    const nodes = database.listNodes(node.projectId)
    const issues = [...checkContinuity({ node, plainText: scene.plainText, entities, states, nodes }), ...checkPovKnowledge({ node, plainText: scene.plainText, entities, facts: database.listKnowledgeFacts(node.projectId), nodes })]
    const ignored = new Set((database.db.prepare('SELECT rule,evidence_hash FROM continuity_exceptions WHERE node_id=?').all(node.id) as any[]).map((row) => `${row.rule}:${row.evidence_hash}`))
    res.json(issues.filter((issue) => !ignored.has(`${issue.rule}:${sha256(issue.currentEvidence.quote)}`)))
  }))
  app.post('/api/scenes/:id/check/exceptions', route(async (req, res) => {
    const node = database.getNode(param(req, 'id')); if (!node) return res.status(404).json({ error: 'Scene not found' })
    const input = z.object({ rule: z.string(), quote: z.string(), reason: z.string().default('') }).parse(req.body)
    database.db.prepare('INSERT OR IGNORE INTO continuity_exceptions(id,project_id,node_id,rule,evidence_hash,reason,created_at) VALUES(?,?,?,?,?,?,?)').run(randomBytes(16).toString('hex'), node.projectId, node.id, input.rule, sha256(input.quote), input.reason, nowIso())
    res.status(201).json({ ok: true })
  }))

  app.get('/api/projects/:id/settings/:key', route(async (req, res) => res.json({ value: database.getSetting(param(req, 'id'), param(req, 'key'), null) })))
  app.put('/api/projects/:id/settings/:key', route(async (req, res) => {
    database.setSetting(param(req, 'id'), param(req, 'key'), req.body.value)
    res.json({ ok: true })
  }))
  app.get('/api/projects/:id/stats', route(async (req, res) => res.json(database.writingStats(param(req, 'id')))))
  app.get('/api/projects/:id/read-aloud-preferences', route(async (req, res) => res.json(database.getReadAloudPreferences(param(req, 'id')))))
  app.put('/api/projects/:id/read-aloud-preferences', route(async (req, res) => {
    const input = z.object({ voiceUri: z.string().max(500).optional(), rate: z.number().min(0.5).max(2).optional(), pitch: z.number().min(0.5).max(2).optional() }).parse(req.body)
    res.json(database.saveReadAloudPreferences(param(req, 'id'), input))
  }))
  app.get('/api/projects/:id/delivery/templates', route(async (req, res) => res.json(database.listDeliveryTemplates(param(req, 'id')))))
  app.put('/api/projects/:id/delivery/rules/:ruleId', route(async (req, res) => {
    const input = z.object({ enabled: z.boolean(), config: z.record(z.string(), z.unknown()).default({}) }).parse(req.body)
    res.json(database.setDeliveryRuleOverride(param(req, 'id'), param(req, 'ruleId'), input.enabled, input.config))
  }))
  app.post('/api/projects/:id/delivery/checks', route(async (req, res) => {
    const input = z.object({ templateId: z.string(), chapterIds: z.array(z.string()).default([]) }).parse(req.body)
    res.status(201).json(runDeliveryCheck(database, param(req, 'id'), input.templateId, input.chapterIds))
  }))
  app.get('/api/projects/:id/delivery/checks', route(async (req, res) => res.json(database.listDeliveryCheckRuns(param(req, 'id')))))

  app.get('/api/projects/:id/provenance', route(async (req, res) => res.json(database.listProvenanceEvents(param(req, 'id'), req.query.nodeId ? String(req.query.nodeId) : null))))
  app.get('/api/projects/:id/provenance/exports', route(async (req, res) => res.json(database.listProvenanceExports(param(req, 'id')))))
  app.post('/api/projects/:id/provenance/ai-decisions', route(async (req, res) => {
    const projectId = param(req, 'id')
    const input = z.object({ nodeId: z.string(), taskId: z.string(), decision: z.enum(['accepted', 'rejected', 'undone']) }).parse(req.body)
    const task = database.db.prepare('SELECT * FROM ai_tasks WHERE id=? AND project_id=? AND node_id=?').get(input.taskId, projectId, input.nodeId) as Record<string, unknown> | undefined
    if (!task) return res.status(404).json({ error: 'AI task not found' })
    const eventType = input.decision === 'accepted' ? 'ai_accepted' : input.decision === 'rejected' ? 'ai_rejected' : 'ai_undone'
    const family = database.getVoiceProfile(projectId, input.nodeId).family
    database.recordVoicePreference(projectId, family, String(task.task_type), input.decision)
    res.status(201).json(database.recordProvenanceEvent({ projectId, nodeId: input.nodeId, eventType, actorType: 'human', sourceTaskId: input.taskId, contentHash: String(task.output_hash ?? ''), metadata: { decision: input.decision, taskType: String(task.task_type), model: String(task.model) } }))
  }))
  app.post('/api/projects/:id/provenance/exports', route(async (req, res) => {
    const projectId = param(req, 'id')
    const input = z.object({ format: z.enum(['json', 'html']).default('json'), includeTextExcerpts: z.boolean().default(false) }).parse(req.body)
    const bundle = buildProvenanceBundle(database, projectId, input.includeTextExcerpts)
    const verification = verifyProvenanceBundle(bundle)
    if (!verification.ok) throw new Error('Generated provenance bundle failed self-verification')
    database.recordProvenanceExport(projectId, bundle.manifestHash, bundle.manifest.events.length, input.includeTextExcerpts)
    const project = database.getProject(projectId)!
    const content = input.format === 'json' ? JSON.stringify(bundle, null, 2) : renderProvenanceHtml(bundle)
    res.status(201).json({ fileName: `${safeFileName(project.title)}-创作来源.${input.format}`, mimeType: input.format === 'json' ? 'application/json' : 'text/html', content, manifestHash: bundle.manifestHash, eventCount: bundle.manifest.events.length })
  }))
  app.post('/api/provenance/verify', route(async (req, res) => {
    res.json(verifyProvenanceBundle(req.body))
  }))

  app.get('/api/projects/:id/sync', route(async (req, res) => res.json(sync.status(param(req, 'id')))))
  app.post('/api/projects/:id/sync/initialize', route(async (req, res) => {
    const input = z.object({ deviceName: z.string().trim().min(1).max(80) }).parse(req.body)
    res.status(201).json(sync.initialize(param(req, 'id'), input.deviceName))
  }))
  app.post('/api/projects/:id/sync/export', route(async (req, res) => {
    const input = z.object({ recoveryPhrase: z.string().min(20).max(500) }).parse(req.body)
    res.status(201).json(sync.exportPackage(param(req, 'id'), input.recoveryPhrase))
  }))
  app.get('/api/projects/:id/sync/conflicts', route(async (req, res) => res.json(sync.listConflicts(param(req, 'id')))))
  app.post('/api/projects/:id/sync/conflicts/:conflictId/resolve', route(async (req, res) => {
    const input = z.object({ resolution: z.enum(['keep_local', 'use_remote', 'acknowledge_remote']) }).parse(req.body)
    res.json(sync.resolveConflict(param(req, 'id'), param(req, 'conflictId'), input.resolution))
  }))
  app.post('/api/sync/inspect', route(async (req, res) => {
    const input = z.object({ package: z.unknown(), recoveryPhrase: z.string().min(20).max(500) }).parse(req.body)
    res.json(sync.inspectPackage(input.package, input.recoveryPhrase))
  }))
  app.post('/api/sync/import', route(async (req, res) => {
    const input = z.object({ package: z.unknown(), recoveryPhrase: z.string().min(20).max(500), deviceName: z.string().trim().min(1).max(80).default('这台设备') }).parse(req.body)
    res.status(201).json(sync.importPackage(input.package, input.recoveryPhrase, input.deviceName))
  }))
  app.post('/api/sync/drill', route(async (_req, res) => res.json(sync.runDrill())))

  app.get('/api/projects/:id/reviews', route(async (req, res) => res.json(database.listReviewSessions(param(req, 'id')).filter((session) => session.projectId === param(req, 'id')))))
  app.get('/api/reviews/received', route(async (_req, res) => res.json(database.listReviewSessions().filter((session) => session.direction === 'received'))))
  app.post('/api/projects/:id/reviews', route(async (req, res) => {
    const input = z.object({ reviewerName: z.string().trim().min(1).max(120), role: z.enum(['editor', 'beta_reader', 'co_writer']), sceneIds: z.array(z.string()).min(1).max(100), includeProvenance: z.boolean().default(false), expiresAt: z.string().datetime().nullable().default(null) }).parse(req.body)
    res.status(201).json(reviews.createAssignment(param(req, 'id'), input))
  }))
  app.post('/api/reviews/:id/export-assignment', route(async (req, res) => res.json(reviews.exportAssignment(param(req, 'id'), reviewPhraseInput.parse(req.body).recoveryPhrase))))
  app.post('/api/reviews/:id/export-response', route(async (req, res) => res.json(reviews.exportResponse(param(req, 'id'), reviewPhraseInput.parse(req.body).recoveryPhrase))))
  app.post('/api/reviews/inspect', route(async (req, res) => { const input = reviewPackageInput.parse(req.body); res.json(reviews.inspectPackage(input.package, input.recoveryPhrase)) }))
  app.post('/api/reviews/import', route(async (req, res) => { const input = reviewPackageInput.extend({ targetProjectId: z.string().optional() }).parse(req.body); res.status(201).json(reviews.importPackage(input.package, input.recoveryPhrase, input.targetProjectId)) }))
  app.post('/api/reviews/:id/feedback', route(async (req, res) => {
    const input = z.object({ id: z.string().optional(), sceneId: z.string(), kind: z.enum(['comment', 'suggestion']), body: z.string().trim().min(1).max(5000), paragraphIndex: z.number().int().min(0), startOffset: z.number().int().min(0), endOffset: z.number().int().positive(), replacementText: z.string().max(20000).optional() }).parse(req.body)
    res.status(201).json(reviews.addFeedback(param(req, 'id'), input))
  }))
  app.post('/api/projects/:projectId/reviews/feedback/:feedbackId/decide', route(async (req, res) => {
    const input = z.object({ decision: z.enum(['accepted', 'rejected', 'deferred']), note: z.string().max(2000).default('') }).parse(req.body)
    res.json(reviews.decide(param(req, 'projectId'), param(req, 'feedbackId'), input.decision, input.note))
  }))

  app.get('/api/projects/:id/sprints', route(async (req, res) => res.json(sprints.list(param(req, 'id')))))
  app.post('/api/projects/:id/sprints', route(async (req, res) => {
    const input = z.object({ scope: z.enum(['scene', 'project']), sceneId: z.string().nullable().optional(), durationMinutes: z.number().int().min(10).max(120), goalWords: z.number().int().min(1).max(50_000) }).parse(req.body)
    res.status(201).json(sprints.start(param(req, 'id'), input))
  }))
  app.post('/api/sprints/:id/pause', route(async (req, res) => res.json(sprints.pause(param(req, 'id'), z.object({ reason: z.string().max(80).default('manual') }).parse(req.body ?? {}).reason))))
  app.post('/api/sprints/:id/resume', route(async (req, res) => res.json(sprints.resume(param(req, 'id')))))
  app.post('/api/sprints/:id/reconcile', route(async (req, res) => {
    const input = z.object({ sleepDetected: z.boolean().default(false), lastObservedAt: z.string().datetime().optional(), reason: z.string().max(80).optional() }).parse(req.body ?? {})
    res.json(sprints.reconcile(param(req, 'id'), input))
  }))
  app.post('/api/sprints/:id/complete', route(async (req, res) => res.json(sprints.complete(param(req, 'id'), z.object({ participantLabel: z.string().max(40).default('匿名作者') }).parse(req.body ?? {}).participantLabel))))
  app.post('/api/sprints/:id/cancel', route(async (req, res) => res.json(sprints.cancel(param(req, 'id')))))
  app.get('/api/sprint-cards/:id/export', route(async (req, res) => res.json(sprints.exportCard(param(req, 'id')))))
  app.post('/api/sprint-cards/inspect', route(async (req, res) => res.json(sprints.inspect(z.object({ package: z.unknown() }).parse(req.body).package))))
  app.get('/api/projects/:id/sprint-boards', route(async (req, res) => res.json(sprints.listBoards(param(req, 'id')))))
  app.post('/api/projects/:id/sprint-boards', route(async (req, res) => {
    const input = z.object({ name: z.string().trim().min(1).max(80), period: z.enum(['day', 'week']), targetWords: z.number().int().min(1).max(10_000_000), periodStartedAt: z.string().datetime() }).parse(req.body)
    res.status(201).json(sprints.createBoard(param(req, 'id'), input))
  }))
  app.post('/api/sprint-boards/:id/cards/import', route(async (req, res) => res.status(201).json(sprints.importToBoard(param(req, 'id'), z.object({ package: z.unknown() }).parse(req.body).package))))
  app.post('/api/sprint-boards/:id/cards/local/:cardId', route(async (req, res) => res.status(201).json(sprints.addLocalCard(param(req, 'id'), param(req, 'cardId')))))

  app.get('/api/template-packages', route(async (req, res) => res.json(templates.listInstallations(req.query.includeUninstalled !== '0'))))
  app.get('/api/template-packages/:id/export', route(async (req, res) => res.json(requireFound(templates.getInstallation(param(req, 'id')), 'Template package').package)))
  app.post('/api/template-packages/inspect', route(async (req, res) => res.json(templates.inspectPackage(z.object({ package: z.unknown() }).parse(req.body).package))))
  app.post('/api/template-packages', route(async (req, res) => res.status(201).json(templates.installPackage(z.object({ package: z.unknown() }).parse(req.body).package))))
  app.patch('/api/template-packages/:id', route(async (req, res) => {
    const input = z.object({ status: z.enum(['enabled', 'disabled', 'uninstalled']) }).parse(req.body)
    res.json(templates.setInstallationStatus(param(req, 'id'), input.status))
  }))
  app.get('/api/projects/:projectId/template-packages/:packageId/grants', route(async (req, res) => res.json(templates.listGrants(param(req, 'projectId'), param(req, 'packageId')))))
  app.put('/api/projects/:projectId/template-packages/:packageId/grants/:capability', route(async (req, res) => {
    const capability = z.enum(['project.summary.read', 'plan.nodes.create', 'local.rules.run']).parse(param(req, 'capability'))
    const granted = z.object({ granted: z.boolean() }).parse(req.body).granted
    res.json(templates.setGrant(param(req, 'projectId'), param(req, 'packageId'), capability, granted))
  }))
  app.post('/api/projects/:projectId/template-packages/:packageId/preview', route(async (req, res) => res.json(templates.preview(param(req, 'projectId'), param(req, 'packageId')))))
  app.post('/api/projects/:projectId/template-packages/:packageId/applications', route(async (req, res) => {
    const input = z.object({ previewHash: z.string().length(64), conflictStrategy: z.enum(['cancel', 'rename']).default('cancel') }).parse(req.body)
    res.status(201).json(templates.apply(param(req, 'projectId'), param(req, 'packageId'), input.previewHash, input.conflictStrategy))
  }))
  app.get('/api/projects/:id/template-applications', route(async (req, res) => res.json(templates.listApplications(param(req, 'id')))))
  app.post('/api/template-applications/:id/revert', route(async (req, res) => res.json(templates.revert(param(req, 'id')))))

  app.get('/api/projects/:id/visual-anchors', route(async (req, res) => res.json(visuals.listAnchors(param(req, 'id')))))
  app.post('/api/projects/:id/visual-anchors', route(async (req, res) => {
    const input = z.object({ entityId: z.string(), selectedFields: z.array(z.string()).min(1).max(20), styleNote: z.string().max(1000).default('') }).parse(req.body)
    res.status(201).json(visuals.createAnchor(param(req, 'id'), input.entityId, input.selectedFields as VisualSelectedField[], input.styleNote))
  }))
  app.patch('/api/visual-anchors/:id', route(async (req, res) => {
    const input = z.object({ selectedFields: z.array(z.string()).min(1).max(20).optional(), styleNote: z.string().max(1000).optional() }).parse(req.body)
    res.json(visuals.refreshAnchor(param(req, 'id'), input.selectedFields as VisualSelectedField[] | undefined, input.styleNote))
  }))
  app.post('/api/visual-anchors/:id/candidates', route(async (req, res) => {
    const input = z.object({ fileName: z.string().min(1).max(240), mimeType: z.enum(['image/png', 'image/jpeg']), contentBase64: z.string().min(1).max(14_000_000), sourceLabel: z.string().max(120).default('作者本地导入') }).parse(req.body)
    res.status(201).json(visuals.importCandidate(param(req, 'id'), input))
  }))
  app.post('/api/visual-candidates/:id/resolve', route(async (req, res) => res.json(visuals.resolveCandidate(param(req, 'id'), z.object({ decision: z.enum(['accepted', 'rejected']) }).parse(req.body).decision))))
  app.get('/api/visual-assets/:hash/content', route(async (req, res) => {
    const result = visuals.getAsset(param(req, 'hash')); if (!result) return res.status(404).json({ error: 'Visual asset not found' })
    res.setHeader('Content-Type', result.asset.mimeType); res.setHeader('Content-Length', String(result.asset.byteSize)); res.setHeader('Cache-Control', 'private, max-age=31536000, immutable'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.send(result.bytes)
  }))
  app.get('/api/projects/:id/storyboards', route(async (req, res) => res.json(visuals.listStoryboards(param(req, 'id')))))
  app.post('/api/projects/:projectId/scenes/:sceneId/storyboard', route(async (req, res) => {
    const title = z.object({ title: z.string().trim().min(1).max(160).optional() }).parse(req.body ?? {}).title
    res.status(201).json(visuals.getOrCreateStoryboard(param(req, 'projectId'), param(req, 'sceneId'), title))
  }))
  app.post('/api/storyboards/:id/cards', route(async (req, res) => {
    const input = z.object({ purpose: z.string().trim().min(1).max(160), note: z.string().max(2000).default(''), anchorIds: z.array(z.string()).max(20).default([]), assetHash: z.string().length(64).nullable().default(null), visualDescription: z.string().max(4000).default('') }).parse(req.body)
    res.status(201).json(visuals.addStoryboardCard(param(req, 'id'), input))
  }))
  app.post('/api/storyboard-cards/:id/move', route(async (req, res) => res.json(visuals.moveStoryboardCard(param(req, 'id'), z.object({ direction: z.enum(['up', 'down']) }).parse(req.body).direction))))
  app.delete('/api/storyboard-cards/:id', route(async (req, res) => res.json(visuals.deleteStoryboardCard(param(req, 'id')))))

  app.get('/api/research/status', route(async (_req, res) => res.json(research.getStatus())))
  app.post('/api/research/enroll', route(async (req, res) => {
    const input = z.object({ adultOrAuthorized: z.literal(true), manuscriptRights: z.literal(true), localOnlyUnderstood: z.literal(true), voluntary: z.literal(true) }).strict().parse(req.body)
    res.status(201).json(research.enroll(input))
  }))
  app.post('/api/research/tasks', route(async (req, res) => {
    const input = z.object({ projectId: z.string(), taskType: z.enum(['canon_loop', 'fact_lookup', 'restore_drill', 'legacy_import', 'weekly_reflection']) }).strict().parse(req.body)
    res.status(201).json(research.startTask(input.projectId, input.taskType))
  }))
  app.post('/api/research/tasks/:id/complete', route(async (req, res) => {
    const input = z.object({ outcome: z.enum(['completed', 'abandoned']), goalAchieved: z.boolean(), difficulty: z.number().int().min(1).max(5), minutesSaved: z.number().int().min(0).max(480), issueCodes: z.array(z.enum(['hard_to_find', 'false_positive', 'missed_fact', 'confusing_candidate', 'slow', 'recovery_failed', 'data_loss'])).max(7) }).strict().parse(req.body)
    res.json(research.completeTask(param(req, 'id'), input))
  }))
  app.delete('/api/research/enrollment', route(async (_req, res) => res.json(research.withdraw())))
  app.get('/api/research/export', route(async (_req, res) => res.json(research.exportBundle())))
  app.post('/api/research/inspect', route(async (req, res) => res.json(research.verifyBundle(z.object({ package: z.unknown() }).strict().parse(req.body).package))))
  app.get('/api/support/bundle', route(async (_req, res) => res.json(buildSupportBundle(database, config))))
  app.get('/api/release/readiness', route(async (_req, res) => res.json(buildReleaseReadiness(database, config))))
  app.get('/api/research-cohort/status', route(async (_req, res) => res.json(researchCohort.getStatus())))
  app.post('/api/research-cohort/import', route(async (req, res) => {
    const input = z.object({
      package: z.unknown(),
      evidenceClass: z.enum(['external_attested', 'engineering_fixture']),
      segment: z.enum(['web_serial', 'revision_novel', 'ai_assisted', 'other_target']),
      attestation: z.object({ targetAuthorConfirmed: z.boolean(), independentParticipantConfirmed: z.boolean(), manuscriptRightsConfirmed: z.boolean(), realUseConfirmed: z.boolean() }).strict(),
      retentionUntil: z.iso.datetime(),
      waveId: z.string().uuid().nullable().optional(),
    }).strict().parse(req.body)
    res.status(201).json(researchCohort.importBundle({ researchPackage: input.package, evidenceClass: input.evidenceClass, segment: input.segment, attestation: input.attestation, retentionUntil: input.retentionUntil, waveId: input.waveId }))
  }))
  app.delete('/api/research-cohort/participants/:hash', route(async (req, res) => {
    z.object({ confirm: z.literal(true) }).strict().parse(req.body)
    res.json(researchCohort.deleteParticipant(param(req, 'hash')))
  }))
  app.post('/api/research-cohort/purge-expired', route(async (req, res) => {
    z.object({ confirm: z.literal(true) }).strict().parse(req.body)
    res.json(researchCohort.purgeExpired())
  }))
  app.get('/api/research-cohort/export', route(async (_req, res) => res.json(researchCohort.exportBundle())))
  app.get('/api/research-waves/status', route(async (_req, res) => res.json(researchWaves.getStatus())))
  app.post('/api/research-waves', route(async (req, res) => {
    const input = z.object({
      kind: z.enum(['external_controlled', 'engineering_rehearsal']), windowStart: z.iso.datetime(), windowEnd: z.iso.datetime(), targetParticipants: z.number().int().min(1).max(10),
      quotas: z.object({ web_serial: z.number().int().nonnegative(), revision_novel: z.number().int().nonnegative(), ai_assisted: z.number().int().nonnegative(), other_target: z.number().int().nonnegative() }).strict(),
      readiness: z.object({ protocolReviewed: z.boolean(), controlledRosterReady: z.boolean(), deletionContactReady: z.boolean(), supportRouteRehearsed: z.boolean() }).strict(),
    }).strict().parse(req.body)
    res.status(201).json(researchWaves.createWave(input))
  }))
  app.post('/api/research-waves/:id/transition', route(async (req, res) => {
    const next = z.object({ next: z.enum(['draft', 'recruiting', 'active', 'paused', 'review', 'closed', 'cancelled']) }).strict().parse(req.body).next
    res.json(researchWaves.transition(param(req, 'id'), next))
  }))
  app.post('/api/research-waves/:id/incidents', route(async (req, res) => {
    const input = z.object({ code: z.enum(['onboarding_blocked', 'support_request', 'recovery_failed', 'data_loss', 'privacy_request', 'protocol_deviation']), severity: z.enum(['low', 'medium', 'high', 'critical']) }).strict().parse(req.body)
    res.status(201).json(researchWaves.reportIncident(param(req, 'id'), input.code, input.severity))
  }))
  app.post('/api/research-waves/:id/incidents/:incidentId/resolve', route(async (req, res) => {
    z.object({ confirm: z.literal(true) }).strict().parse(req.body)
    res.json(researchWaves.resolveIncident(param(req, 'id'), param(req, 'incidentId')))
  }))
  app.get('/api/research-waves/:id/kit', route(async (req, res) => res.json(researchWaves.exportKit(param(req, 'id')))))

  app.get('/api/mobile/inbox', route(async (req, res) => res.json(database.listMobileInbox(req.query.projectId ? String(req.query.projectId) : undefined))))
  app.post('/api/mobile/inbox', route(async (req, res) => {
    const input = z.object({ id: z.string().min(8).max(100), projectId: z.string().nullable(), targetNodeId: z.string().nullable(), kind: z.enum(['inspiration', 'scene_idea', 'review_note']), content: z.string().trim().min(1).max(10000), originDeviceId: z.string().max(100).nullable().default(null), createdAt: z.iso.datetime() }).parse(req.body)
    res.status(201).json(database.createMobileInboxItem(input))
  }))
  app.post('/api/mobile/inbox/:id/actions', route(async (req, res) => {
    const input = z.object({ id: z.string().min(8).max(100), action: z.enum(['filed', 'dismissed', 'revisit', 'approved']), note: z.string().max(1000).default(''), createdAt: z.iso.datetime() }).parse(req.body)
    res.status(201).json(database.createMobileInboxAction({ ...input, itemId: param(req, 'id') }))
  }))
  app.get('/api/mobile/library', route(async (_req, res) => {
    const projects = database.listProjects()
    const scenes = projects.flatMap((project) => database.listNodes(project.id).filter((node) => node.type === 'scene').map((node) => {
      const document = database.getScene(node.id)!; const revision = database.listRevisions(node.id)[0]
      return { id: node.id, projectId: project.id, projectTitle: project.title, title: node.title, plainText: document.plainText, updatedAt: document.updatedAt, provenanceLabel: revision?.provenanceLabel ?? null }
    })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100)
    const sprintCards = projects.flatMap((project) => database.listSprintSessions(project.id).flatMap((session) => session.resultCard ? [session.resultCard] : [])).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50)
    res.json({ projects, scenes, sprintCards })
  }))

  app.post('/api/import', route(async (req, res) => {
    const input = z.object({ title: z.string().trim().min(1).max(200), chapters: z.array(z.object({ title: z.string().min(1).max(200), text: z.string(), contentJson: z.record(z.string(), z.unknown()) })).min(1), original: z.object({ fileName: z.string().min(1), mimeType: z.string(), byteSize: z.number().int().nonnegative(), contentHash: z.string().length(64), contentBase64: z.string() }) }).parse(req.body)
    const originalBytes = Buffer.from(input.original.contentBase64, 'base64'); const actualHash = sha256(originalBytes)
    if (actualHash !== input.original.contentHash || originalBytes.length !== input.original.byteSize) return res.status(422).json({ error: '原文件校验失败，已取消导入' })
    res.status(201).json(database.createImportedProject(input))
  }))

  app.get('/api/ai/settings', (_req, res) => res.json(ai.getSettings()))
  app.put('/api/ai/settings', route(async (req, res) => {
    const input = z.object({ baseUrl: z.string(), model: z.string(), apiKey: z.string().default('') }).parse(req.body)
    res.json(ai.saveSettings(input))
  }))
  app.post('/api/ai/test', route(async (req, res) => res.json(await ai.testConnection(req.body?.baseUrl ? z.object({ baseUrl: z.string(), model: z.string(), apiKey: z.string() }).parse(req.body) : undefined))))
  app.post('/api/ai/warm', route(async (_req, res) => res.json(await ai.warmModel())))
  app.get('/api/projects/:projectId/scenes/:nodeId/context', route(async (req, res) => res.json(ai.buildContext(param(req, 'projectId'), param(req, 'nodeId')))))
  app.post('/api/ai/tasks', route(async (req, res) => {
    const input = aiTaskInput.parse(req.body)
    res.json(await ai.runTask(input))
  }))
  app.post('/api/ai/tasks/stream', async (req, res) => {
    const parsed = aiTaskInput.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'AI 任务参数不完整' })
    res.status(200); res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders()
    const controller = new AbortController(); const abortIfOpen = () => { if (!res.writableEnded) controller.abort() }
    req.on('aborted', abortIfOpen); res.on('close', abortIfOpen)
    const send = (event: unknown) => { if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`) }
    try {
      const result = await ai.runTaskStreaming(parsed.data, send, controller.signal)
      send({ type: 'complete', result })
    } catch (error) {
      const detail = error as { message?: string; code?: string; retryable?: boolean }
      send({ type: 'error', error: detail.message ?? 'AI 任务失败', code: detail.code ?? 'provider_error', retryable: detail.retryable ?? true })
    } finally {
      req.off('aborted', abortIfOpen); res.off('close', abortIfOpen); if (!res.writableEnded) res.end()
    }
  })

  app.get('/api/projects/:id/export', route(async (req, res) => {
    const project = database.getProject(param(req, 'id'))
    if (!project) return res.status(404).json({ error: 'Project not found' })
    const format = String(req.query.format ?? 'txt')
    const selectedChapters = String(req.query.chapters ?? '').split(',').filter(Boolean)
    const template = String(req.query.template ?? 'standard')
    const nodes = database.listNodes(project.id)
    const chapters = nodes.filter((node) => node.type === 'chapter' && (!selectedChapters.length || selectedChapters.includes(node.id)))
    const sections = chapters.map((chapter) => {
      const scenes = nodes.filter((node) => node.parentId === chapter.id && node.type === 'scene')
      return { title: chapter.title, text: scenes.map((scene) => database.getScene(scene.id)?.plainText ?? '').join('\n\n') }
    })
    if (format === 'docx') {
      const children = sections.flatMap((section) => [new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_1 }), ...section.text.split('\n').map((line) => new Paragraph(line))])
      const document = new Document({ sections: [{ children: template === 'submission' ? [new Paragraph({ text: project.title, heading: HeadingLevel.TITLE }), ...children] : children }] })
      const buffer = await Packer.toBuffer(document)
      res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(project.title)}.docx`).send(buffer)
      return
    }
    const body = `${template === 'submission' ? `${format === 'md' ? '# ' : ''}${project.title}\n\n` : ''}${sections.map((section) => `${format === 'md' ? '# ' : ''}${section.title}\n\n${section.text}`).join('\n\n')}`
    res.type('text/plain; charset=utf-8').setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(project.title)}.${format === 'md' ? 'md' : 'txt'}`).send(body)
  }))

  app.get('/api/projects/:id/backup', route(async (req, res) => {
    const archive = exportProject(database, templates, visuals, param(req, 'id'))
    res.type('application/json').setHeader('Content-Disposition', `attachment; filename="project.bbd-backup"`).send(JSON.stringify(archive, null, 2))
  }))
  app.post('/api/backups/restore', route(async (req, res) => {
    const archive = backupSchema.parse(req.body)
    const restored = importProject(database, templates, visuals, archive)
    res.status(201).json(restored)
  }))

  if (config.production) {
    const distPath = config.staticDir
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath))
      app.get('/{*splat}', (_req, res) => res.sendFile(path.join(distPath, 'index.html')))
    }
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message === 'Invalid input' ? '请求格式不正确' : error.issues[0]?.message, details: error.issues })
    const message = error instanceof Error ? error.message : 'Unknown error'
    const status = /not found/i.test(message) ? 404 : /overlap|already resolved|already has an active|already active|already exists|ID collision|hash collision|outside this board period|title conflict|preview is stale|already reverted|Canon changed|必须明确选择|不能静默改写|strict continuation|consent receipt changed|was deleted|cannot change waves|target is already full|segment quota is already full|Invalid research wave transition|Closed research wave|正文已变化|正文选区/i.test(message) ? 409 : /恢复短语|接力包|内容寻址|来源链校验|integrity check|no longer matches|image type|image dimensions|real PNG|real JPEG|Sprint event|Sprint result|Template structure hash|Template package hash|Research package|semantic verification|tampered/i.test(message) ? 422 : /capability grant required|capability was not requested|package is not enabled|local_private|Research consent is required/i.test(message) ? 403 : /must be|required|invalid|too many|unsupported|another project|frozen wave window|accepts only|not accepting packages|仅允许|不能为空/i.test(message) ? 400 : 500
    return res.status(status).json({ error: message })
  })
  return { app, database, ai, sync, reviews, sprints, templates, visuals, research, researchCohort, researchWaves }
}

function route(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => void handler(req, res, next).catch(next)
}

function sceneArgs(input: z.infer<typeof sceneInput>): [Record<string, unknown>, string, 'human' | 'import' | 'ai_accepted' | 'restore' | 'merge', string | null] {
  return [input.contentJson, input.plainText, input.sourceType, input.sourceTaskId]
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?\"<>|]/g, '_').slice(0, 100) || '笔不怠'
}

function plainTextDoc(text: string): Record<string, unknown> {
  return { type: 'doc', content: text.split(/\n/).map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : undefined })) }
}

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('=')).filter((pair) => pair.length === 2).map(([key, value]) => [key, decodeURIComponent(value)]))
}

function param(req: Request, key: string): string {
  const value = req.params[key]
  return Array.isArray(value) ? value[0] : value
}

function isLoopback(ip: string | undefined) {
  return !ip || ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1')
}

function extractFactCandidates(database: AppDatabase, nodeId: string) {
  const node = database.getNode(nodeId); const scene = database.getScene(nodeId)
  if (!node || !scene) return []
  const entities = database.listEntities(node.projectId); const created = []
  for (const entity of entities) {
    if (entity.type === 'character') {
      const match = scene.plainText.match(new RegExp(`${escapeRegExp(entity.canonicalName)}[^。！？]{0,12}(死亡|身亡|死去|断了气)`))
      if (match && !candidateExists(database, node.projectId, nodeId, entity.id, match[0])) created.push(database.createCandidate({ projectId: node.projectId, nodeId, targetType: 'entity_state', targetId: entity.id, operation: 'set_state', before: currentState(database, entity.id, 'life_status'), after: { attributeKey: 'life_status', value: '死亡', worldTimeFrom: node.storyTimeSpec ? null : node.storyTime }, evidence: { quote: match[0], startOffset: match.index, endOffset: (match.index ?? 0) + match[0].length, reason: '正文出现明确死亡描述' }, confidence: 0.93, sourceTaskId: null }))
    }
    if (entity.type === 'item') {
      for (const person of entities.filter((item) => item.type === 'character')) {
        const match = scene.plainText.match(new RegExp(`(?:把|将)${escapeRegExp(entity.canonicalName)}[^。！？]{0,8}(?:交给|递给|送给)${escapeRegExp(person.canonicalName)}`))
        if (match && !candidateExists(database, node.projectId, nodeId, entity.id, match[0])) created.push(database.createCandidate({ projectId: node.projectId, nodeId, targetType: 'entity_state', targetId: entity.id, operation: 'set_state', before: currentState(database, entity.id, 'holder'), after: { attributeKey: 'holder', value: person.canonicalName, worldTimeFrom: node.storyTimeSpec ? null : node.storyTime }, evidence: { quote: match[0], startOffset: match.index, endOffset: (match.index ?? 0) + match[0].length, reason: '正文出现明确转交关系' }, confidence: 0.9, sourceTaskId: null }))
      }
    }
  }
  return created
}

function currentStatesAtScene(database: AppDatabase, nodeId: string) {
  const node = database.getNode(nodeId); if (!node) throw new Error('Scene not found')
  const nodes = database.listNodes(node.projectId); const chapters = nodes.filter((item) => item.type === 'chapter').sort((a, b) => a.sortKey - b.sortKey); const chapterOrder = new Map(chapters.map((item, index) => [item.id, index]))
  const scenes = nodes.filter((item) => item.type === 'scene').sort((a, b) => (chapterOrder.get(a.parentId ?? '') ?? 0) - (chapterOrder.get(b.parentId ?? '') ?? 0) || a.sortKey - b.sortKey); const storyScenes = [...scenes].sort((a, b) => compareStoryTime(a, b, scenes)); const order = new Map(storyScenes.map((item, index) => [item.id, index])); const at = order.get(nodeId) ?? Number.MAX_SAFE_INTEGER
  return database.listEntities(node.projectId).flatMap((entity) => {
    const groups = new Map<string, ReturnType<AppDatabase['listStates']>>()
    for (const state of database.listStates(entity.id)) groups.set(state.attributeKey, [...(groups.get(state.attributeKey) ?? []), state])
    return [...groups.values()].map((states) => states.filter((state) => {
      if (!node.storyTimeSpec && node.storyTime && state.worldTimeFrom) return state.worldTimeFrom <= node.storyTime && (!state.worldTimeTo || node.storyTime < state.worldTimeTo)
      const from = state.validFromNodeId ? order.get(state.validFromNodeId) ?? Number.MAX_SAFE_INTEGER : -1; const to = state.validToNodeId ? order.get(state.validToNodeId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
      return from <= at && at < to
    }).at(-1)).filter(Boolean)
  })
}

function currentState(database: AppDatabase, entityId: string, key: string) { return database.listStates(entityId).filter((state) => state.attributeKey === key).at(-1)?.value ?? null }
function candidateExists(database: AppDatabase, projectId: string, nodeId: string, targetId: string, quote: string) { return Boolean(database.db.prepare("SELECT 1 FROM candidate_changes WHERE project_id=? AND node_id=? AND target_id=? AND json_extract(evidence_json,'$.quote')=? LIMIT 1").get(projectId, nodeId, targetId, quote)) }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function requireFound<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`${label} not found`)
  return value
}

const backupPayloadSchema = z.object({
  exportedAt: z.string(), project: z.object({ title: z.string(), description: z.string() }), nodes: z.array(z.any()), documents: z.array(z.any()), revisions: z.array(z.any()), entities: z.array(z.any()), states: z.array(z.any()), profileFields: z.array(z.any()).optional(), relationships: z.array(z.any()).optional(), mentions: z.array(z.any()), candidates: z.array(z.any()), canonEvents: z.array(z.any()), settings: z.array(z.any()), sources: z.array(z.any()), foreshadows: z.array(z.any()).optional(), knowledge: z.array(z.any()).optional(), seriesBundle: z.any().nullable().optional(), styleSamples: z.array(z.any()).optional(), voice: z.object({ projectDefault: z.any().nullable(), profiles: z.array(z.any()), analyses: z.array(z.any()).optional(), characterProfiles: z.array(z.any()).optional(), preferences: z.array(z.any()).optional() }).optional(), delivery: z.any().optional(), aiTasks: z.array(z.any()).optional(), provenance: z.object({ events: z.array(z.any()), exports: z.array(z.any()) }).optional(), mobileInbox: z.array(z.any()).optional(), review: z.array(z.any()).optional(), sprint: z.any().optional(), templates: z.any().optional(), visuals: z.any().optional(),
})
const backupSchema = z.object({ format: z.literal('bbd-backup-v2'), checksum: z.string().length(64), payload: backupPayloadSchema }).superRefine((archive, context) => {
  if (sha256(JSON.stringify(archive.payload)) !== archive.checksum) context.addIssue({ code: 'custom', message: '备份校验失败，文件可能已损坏或被修改' })
})
type Backup = z.infer<typeof backupSchema>

function exportProject(database: AppDatabase, templates: TemplateService, visuals: VisualService, projectId: string): Backup {
  const project = database.getProject(projectId)
  if (!project) throw new Error('Project not found')
  const nodes = database.listNodes(projectId, true)
  const documents = nodes.filter((node) => node.type === 'scene').map((node) => ({ nodeId: node.id, ...database.getScene(node.id) }))
  const revisions = nodes.filter((node) => node.type === 'scene').flatMap((node) => database.listRevisions(node.id))
  const entities = database.listEntities(projectId, true)
  const states = entities.flatMap((entity) => database.listStates(entity.id))
  const profileFields = entities.flatMap((entity) => database.listProfileFields(entity.id))
  const relationships = database.listRelationships(projectId, null, null, true)
  const sceneIds = nodes.filter((node) => node.type === 'scene').map((node) => node.id)
  const mentions = sceneIds.flatMap((nodeId) => database.listMentions(nodeId))
  const candidates = ['pending', 'accepted', 'accepted_modified', 'ignored', 'exception'].flatMap((status) => database.listCandidates(projectId, status))
  const canonEvents = database.db.prepare('SELECT * FROM canon_events WHERE project_id=? ORDER BY created_at').all(projectId)
  const settings = database.db.prepare('SELECT key,value_json FROM project_settings WHERE project_id=?').all(projectId)
  const sources = database.db.prepare('SELECT file_name,mime_type,byte_size,content_hash,content_base64,created_at FROM imported_sources WHERE project_id=?').all(projectId)
  const foreshadows = database.listForeshadows(projectId, true)
  const knowledge = database.listKnowledgeFacts(projectId, true)
  const series = database.getSeriesForProject(projectId)
  const seriesBundle = series ? { series: { name: series.name, description: series.description }, canon: database.listSeriesCanon(series.id, projectId, true) } : null
  const styleSamples = database.listStyleSamples(projectId, true)
  const voice = {
    projectDefault: database.getProjectVoiceDefault(projectId), profiles: database.listVoiceProfiles(projectId),
    analyses: database.listStyleAnalyses(projectId), characterProfiles: database.listCharacterVoices(projectId), preferences: database.listVoicePreferences(projectId),
  }
  const delivery = { readAloudPreferences: database.getReadAloudPreferences(projectId), ruleOverrides: database.listDeliveryRuleOverrides(projectId), checkRuns: database.listDeliveryCheckRuns(projectId) }
  const aiTasks = database.db.prepare(`SELECT id,project_id AS projectId,node_id AS nodeId,task_type AS taskType,prompt_version AS promptVersion,model,context_hash AS contextHash,output_hash AS outputHash,input_tokens AS inputTokens,output_tokens AS outputTokens,status,created_at AS createdAt,effective_style_hash AS effectiveStyleHash,selection_hash AS selectionHash FROM ai_tasks WHERE project_id=? ORDER BY created_at,rowid`).all(projectId)
  const provenance = { events: database.listProvenanceEvents(projectId), exports: database.listProvenanceExports(projectId) }
  const mobileInbox = database.listMobileInbox(projectId).filter((item) => item.projectId === projectId)
  const review = database.listReviewSessions(projectId).filter((session) => session.projectId === projectId).map((session) => ({ id: session.id, projectTitle: session.projectTitle, role: session.role, reviewerName: session.reviewerName, sceneIds: session.sceneIds, scenes: session.scenes, includeProvenance: session.includeProvenance, status: session.status, expiresAt: session.expiresAt, createdAt: session.createdAt, feedback: session.feedback }))
  const sprintSessions = database.listSprintSessions(projectId)
  const sprintBoards = database.listSprintBoards(projectId).map((board) => ({ ...board, packages: database.listSprintBoardPackages(board.id) }))
  const sprint = { sessions: sprintSessions, boards: sprintBoards }
  const templateBundle = templates.exportProjectBundle(projectId)
  const visualBundle = visuals.exportProjectBundle(projectId)
  const payload = { exportedAt: nowIso(), project: { title: project.title, description: project.description }, nodes, documents, revisions, entities, states, profileFields, relationships, mentions, candidates, canonEvents, settings, sources, foreshadows, knowledge, seriesBundle, styleSamples, voice, delivery, aiTasks, provenance, mobileInbox, review, sprint, templates: templateBundle, visuals: visualBundle }
  return { format: 'bbd-backup-v2', checksum: sha256(JSON.stringify(payload)), payload }
}

function importProject(database: AppDatabase, templates: TemplateService, visuals: VisualService, archive: Backup) {
  const source = archive.payload
  const project = database.createProject(`${source.project.title}（恢复）`, source.project.description)
  const idMap = new Map<string, string>(); const entityMap = new Map<string, string>(); const relationshipMap = new Map<string, string>(); const mentionMap = new Map<string, string>(); const candidateMap = new Map<string, string>(); const taskMap = new Map<string, string>(); const revisionMap = new Map<string, string>(); const styleSampleMap = new Map<string, string>()
  try {
    const defaults = database.listNodes(project.id); const book = defaults.find((item) => item.type === 'book')!
    for (const node of defaults.filter((item) => item.type === 'scene')) { database.db.prepare('DELETE FROM scene_search WHERE node_id=?').run(node.id); database.db.prepare('DELETE FROM scene_documents WHERE node_id=?').run(node.id) }
    database.db.prepare("DELETE FROM manuscript_nodes WHERE project_id=? AND type!='book'").run(project.id)
    const sourceBook = source.nodes.find((item: any) => item.type === 'book')
    if (sourceBook) { database.updateNode(book.id, { title: sourceBook.title, sortKey: sourceBook.sortKey }); idMap.set(sourceBook.id, book.id) }
    const pending = source.nodes.filter((item: any) => item.type !== 'book')
    while (pending.length) {
      const readyIndex = pending.findIndex((node: any) => !node.parentId || idMap.has(node.parentId))
      if (readyIndex < 0) throw new Error('备份中的书稿树存在断裂引用')
      const node: any = pending.splice(readyIndex, 1)[0]
      const created = database.createNode({ projectId: project.id, parentId: node.parentId ? idMap.get(node.parentId)! : book.id, type: node.type, title: node.title, sortKey: node.sortKey })
      database.updateNode(created.id, { status: node.status, storyTime: node.storyTime ?? null, storyTimeSpec: node.storyTimeSpec ?? null }); idMap.set(node.id, created.id)
    }
    for (const entity of source.entities as any[]) {
      const created = database.createEntity({ projectId: project.id, type: entity.type, canonicalName: entity.canonicalName, aliases: entity.aliases, summary: entity.summary, privacyLevel: entity.privacyLevel }); entityMap.set(entity.id, created.id)
    }
    for (const node of source.nodes as any[]) if (node.povEntityId && idMap.has(node.id)) database.updateNode(idMap.get(node.id)!, { povEntityId: entityMap.get(node.povEntityId) ?? null })
    for (const task of (source.aiTasks ?? []) as any[]) {
      const taskId = randomBytes(16).toString('hex'); taskMap.set(String(task.id), taskId)
      database.db.prepare(`INSERT INTO ai_tasks(id,project_id,node_id,task_type,prompt_version,model,context_hash,output_hash,input_tokens,output_tokens,status,created_at,effective_style_hash,selection_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        taskId, project.id, task.nodeId ? idMap.get(String(task.nodeId)) ?? null : null, task.taskType, task.promptVersion, task.model, task.contextHash, task.outputHash ?? null, task.inputTokens ?? 0, task.outputTokens ?? 0, task.status, task.createdAt, task.effectiveStyleHash ?? null, task.selectionHash ?? null,
      )
    }
    for (const oldNode of source.nodes.filter((item: any) => item.type === 'scene') as any[]) {
      const nodeId = idMap.get(oldNode.id)!; const history = (source.revisions as any[]).filter((item) => item.nodeId === oldNode.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      if (history.length) for (const revision of history) { const saved = database.saveScene(nodeId, revision.contentJson, revision.plainText, revision.sourceType, revision.sourceTaskId ? taskMap.get(String(revision.sourceTaskId)) ?? null : null, true); if (saved.currentRevisionId) revisionMap.set(String(revision.id), saved.currentRevisionId) }
      else { const doc = source.documents.find((item: any) => item.nodeId === oldNode.id) as any; if (doc) database.saveScene(nodeId, doc.contentJson, doc.plainText, 'import', null, true) }
    }
    for (const mention of source.mentions as any[]) {
      const created = database.createMention({ entityId: entityMap.get(mention.entityId)!, nodeId: idMap.get(mention.nodeId)!, quote: mention.quote, startOffset: mention.startOffset, endOffset: mention.endOffset, confirmed: mention.confirmed }); mentionMap.set(mention.id, created.id)
    }
    for (const state of source.states as any[]) database.createState({ entityId: entityMap.get(state.entityId)!, attributeKey: state.attributeKey, value: state.value, validFromNodeId: state.validFromNodeId ? idMap.get(state.validFromNodeId) ?? null : null, validToNodeId: state.validToNodeId ? idMap.get(state.validToNodeId) ?? null : null, worldTimeFrom: state.worldTimeFrom, worldTimeTo: state.worldTimeTo, sourceMentionId: state.sourceMentionId ? mentionMap.get(state.sourceMentionId) ?? null : null })
    for (const field of (source.profileFields ?? []) as any[]) database.createProfileField({ entityId: entityMap.get(field.entityId)!, category: field.category, label: field.label, value: field.value, sortKey: field.sortKey, privacyLevel: field.privacyLevel })
    for (const relationship of (source.relationships ?? []) as any[]) {
      const created = database.createRelationship({ projectId: project.id, sourceEntityId: entityMap.get(relationship.sourceEntityId)!, targetEntityId: entityMap.get(relationship.targetEntityId)!, relationType: relationship.relationType, direction: relationship.direction, label: relationship.label, summary: relationship.summary, privacyLevel: relationship.privacyLevel })
      relationshipMap.set(relationship.id, created.id)
      for (const state of relationship.states ?? []) database.createRelationshipState({ relationshipId: created.id, statusLabel: state.statusLabel, note: state.note, validFromNodeId: state.validFromNodeId ? idMap.get(state.validFromNodeId) ?? null : null, validToNodeId: state.validToNodeId ? idMap.get(state.validToNodeId) ?? null : null, worldTimeFrom: state.worldTimeFrom, worldTimeTo: state.worldTimeTo, sourceNodeId: state.sourceNodeId ? idMap.get(state.sourceNodeId) ?? null : null, evidence: state.evidence })
      if (relationship.deletedAt) database.updateRelationship(created.id, { deletedAt: nowIso() })
    }
    for (const candidate of source.candidates as any[]) {
      const mappedTargetId = candidate.targetType === 'relationship_state' && candidate.targetId ? relationshipMap.get(candidate.targetId) ?? null : candidate.targetType.startsWith('entity') && candidate.targetId ? entityMap.get(candidate.targetId) ?? null : candidate.targetId
      const created = database.createCandidate({ projectId: project.id, nodeId: candidate.nodeId ? idMap.get(candidate.nodeId) ?? null : null, targetType: candidate.targetType, targetId: mappedTargetId, operation: candidate.operation, before: candidate.before, after: candidate.after, evidence: candidate.evidence, confidence: candidate.confidence, sourceTaskId: candidate.sourceTaskId ? taskMap.get(String(candidate.sourceTaskId)) ?? null : null }); candidateMap.set(candidate.id, created.id)
      if (candidate.status !== 'pending') database.db.prepare('UPDATE candidate_changes SET status=?,resolved_at=? WHERE id=?').run(candidate.status, candidate.resolvedAt, created.id)
    }
    let previousHash: string | null = null
    for (const event of source.canonEvents as any[]) { const payload = String(event.payload_json); const createdAt = String(event.created_at); const eventHash = sha256(`${previousHash ?? ''}:${payload}:${createdAt}`); database.db.prepare('INSERT INTO canon_events(id,project_id,candidate_id,event_type,payload_json,effective_node_id,created_at,previous_hash,event_hash) VALUES(?,?,?,?,?,?,?,?,?)').run(randomBytes(16).toString('hex'), project.id, event.candidate_id ? candidateMap.get(String(event.candidate_id)) ?? null : null, event.event_type, payload, event.effective_node_id ? idMap.get(String(event.effective_node_id)) ?? null : null, createdAt, previousHash, eventHash); previousHash = eventHash }
    for (const setting of source.settings as any[]) database.db.prepare('INSERT OR REPLACE INTO project_settings(project_id,key,value_json) VALUES(?,?,?)').run(project.id, setting.key, setting.value_json)
    for (const imported of source.sources as any[]) database.db.prepare('INSERT INTO imported_sources(id,project_id,file_name,mime_type,byte_size,content_hash,content_base64,created_at) VALUES(?,?,?,?,?,?,?,?)').run(randomBytes(16).toString('hex'), project.id, imported.file_name, imported.mime_type, imported.byte_size, imported.content_hash, imported.content_base64, imported.created_at)
    for (const foreshadow of (source.foreshadows ?? []) as any[]) {
      const events = [...(foreshadow.events ?? [])].sort((a: any, b: any) => String(a.createdAt).localeCompare(String(b.createdAt)))
      const first = events.find((event: any) => event.action === 'planted')
      const created = database.createForeshadow({ projectId: project.id, title: foreshadow.title, summary: foreshadow.summary, importance: foreshadow.importance, plannedPayoff: foreshadow.plannedPayoff, nodeId: first?.nodeId ? idMap.get(first.nodeId) ?? null : null, evidence: first?.evidence ?? '', note: first?.note ?? '' })
      for (const event of events.filter((item: any) => item !== first && item.action !== 'planted')) database.transitionForeshadow(created.id, { action: event.action, nodeId: event.nodeId ? idMap.get(event.nodeId) ?? null : null, evidence: event.evidence, note: event.note })
      if (foreshadow.deletedAt) database.updateForeshadow(created.id, { deletedAt: nowIso() })
    }
    for (const fact of (source.knowledge ?? []) as any[]) {
      const created = database.createKnowledgeFact({ projectId: project.id, title: fact.title, detail: fact.detail, keywords: fact.keywords, firstRevealedNodeId: fact.firstRevealedNodeId ? idMap.get(fact.firstRevealedNodeId) ?? null : null, privacyLevel: fact.privacyLevel })
      for (const grant of fact.grants ?? []) database.grantKnowledge(created.id, { entityId: entityMap.get(grant.entityId)!, knownFromNodeId: idMap.get(grant.knownFromNodeId)!, sourceNodeId: grant.sourceNodeId ? idMap.get(grant.sourceNodeId) ?? null : null, evidence: grant.evidence, note: grant.note })
      if (fact.deletedAt) database.updateKnowledgeFact(created.id, { deletedAt: nowIso() })
    }
    let restoredSeriesId: string | null = null
    if (source.seriesBundle?.series) {
      const restoredSeries = database.createSeries({ name: `${source.seriesBundle.series.name}（恢复）`, description: source.seriesBundle.series.description ?? '', projectId: project.id })
      restoredSeriesId = restoredSeries.id
      for (const entry of source.seriesBundle.canon ?? []) {
        const created = database.createSeriesCanon({ seriesId: restoredSeries.id, actorProjectId: project.id, type: entry.type, canonicalName: entry.canonicalName, aliases: entry.aliases ?? [], summary: entry.summary ?? '', privacyLevel: entry.privacyLevel ?? 'normal' })
        if (entry.override) database.upsertSeriesCanonOverride(created.id, project.id, { canonicalName: entry.override.canonicalName, aliases: entry.override.aliases ?? [], summary: entry.override.summary ?? '', privacyLevel: entry.override.privacyLevel ?? 'normal' })
        if (entry.deletedAt) database.updateSeriesCanon(created.id, { deletedAt: nowIso() }, project.id)
      }
    }
    for (const sample of (source.styleSamples ?? []) as any[]) {
      if (sample.scope === 'series' && !restoredSeriesId) continue
      const created = database.createStyleSample({ projectId: sample.scope === 'project' ? project.id : null, seriesId: sample.scope === 'series' ? restoredSeriesId : null, actorProjectId: project.id, title: sample.title, content: sample.content, guidance: sample.guidance ?? '', privacyLevel: sample.privacyLevel ?? 'author_only', enabled: sample.enabled !== false })
      styleSampleMap.set(String(sample.id), created.id)
      if (sample.scope === 'series' && sample.effectiveEnabled !== sample.enabled) database.setStyleSamplePreference(created.id, project.id, Boolean(sample.effectiveEnabled))
      if (sample.deletedAt) database.updateStyleSample(created.id, project.id, { deletedAt: nowIso() })
    }
    for (const analysis of source.voice?.analyses ?? []) {
      const sampleIds = (analysis.sampleIds ?? []).map((id: string) => styleSampleMap.get(String(id))).filter(Boolean) as string[]
      if (!sampleIds.length) continue
      const restored = database.analyzeStyleSamples(project.id, sampleIds)
      if (analysis.confirmedAt) database.confirmStyleAnalysis(project.id, restored.id, analysis.suggested ?? {})
    }
    if (source.voice?.projectDefault) database.saveProjectVoiceDefault(project.id, source.voice.projectDefault)
    for (const profile of source.voice?.profiles ?? []) {
      const nodeId = idMap.get(String(profile.nodeId))
      if (nodeId) database.saveVoiceProfile(project.id, nodeId, profile)
    }
    for (const profile of source.voice?.characterProfiles ?? []) {
      const entityId = entityMap.get(String(profile.entityId))
      if (entityId) database.saveCharacterVoice(project.id, entityId, profile)
    }
    for (const preference of source.voice?.preferences ?? []) {
      for (let index = 0; index < Number(preference.accepted ?? 0); index += 1) database.recordVoicePreference(project.id, preference.family, preference.taskType, 'accepted')
      for (let index = 0; index < Number(preference.rejected ?? 0); index += 1) database.recordVoicePreference(project.id, preference.family, preference.taskType, 'rejected')
      for (let index = 0; index < Number(preference.undone ?? 0); index += 1) database.recordVoicePreference(project.id, preference.family, preference.taskType, 'undone')
    }
    if (source.delivery?.readAloudPreferences) database.saveReadAloudPreferences(project.id, { voiceUri: source.delivery.readAloudPreferences.voiceUri ?? '', rate: source.delivery.readAloudPreferences.rate ?? 1, pitch: source.delivery.readAloudPreferences.pitch ?? 1 })
    for (const override of source.delivery?.ruleOverrides ?? []) {
      const rule = database.getDeliveryRuleByCode(project.id, String(override.ruleCode))
      if (rule) database.setDeliveryRuleOverride(project.id, rule.id, Boolean(override.enabled), override.config ?? {})
    }
    const availableTemplates = new Set(database.listDeliveryTemplates(project.id).map((template) => template.id))
    for (const run of source.delivery?.checkRuns ?? []) if (availableTemplates.has(run.templateId)) database.saveDeliveryCheckRun(
      project.id,
      run.templateId,
      (run.chapterIds ?? []).map((id: string) => idMap.get(id)).filter(Boolean) as string[],
      (run.results ?? []).map((result: any) => ({ ...result, nodeId: result.nodeId ? idMap.get(result.nodeId) ?? null : null })),
      run.createdAt ?? nowIso(),
    )
    if (source.visuals) visuals.importProjectBundle(project.id, source.visuals, { entities: entityMap, nodes: idMap })
    if (source.provenance) database.replaceProvenanceForRestore(project.id, source.provenance.events, source.provenance.exports, { nodes: idMap, revisions: revisionMap, tasks: taskMap })
    for (const session of source.review ?? []) {
      const sessionId = randomBytes(16).toString('hex')
      const mappedSceneIds = (session.sceneIds ?? []).map((id: string) => idMap.get(id)).filter(Boolean) as string[]
      if (!mappedSceneIds.length) continue
      database.createReviewSession({ id: sessionId, projectId: project.id, sourceProjectId: project.id, projectTitle: project.title, role: session.role, reviewerName: session.reviewerName, sceneIds: mappedSceneIds, scenes: (session.scenes ?? []).map((scene: any) => ({ ...scene, id: idMap.get(scene.id) })).filter((scene: any) => scene.id), includeProvenance: Boolean(session.includeProvenance), direction: 'restored', status: 'archived', projectFingerprint: '', keySalt: '', keyVerifier: '', expiresAt: session.expiresAt ?? null, createdAt: session.createdAt ?? nowIso() })
      for (const feedback of session.feedback ?? []) {
        const sceneId = idMap.get(String(feedback.sceneId)); if (!sceneId || !mappedSceneIds.includes(sceneId)) continue
        const feedbackId = randomBytes(16).toString('hex')
        database.db.prepare('INSERT INTO review_feedback(id,session_id,scene_id,scene_title,kind,body,anchor_json,original_text,replacement_text,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(feedbackId, sessionId, sceneId, feedback.sceneTitle, feedback.kind, feedback.body, JSON.stringify(feedback.anchor), feedback.originalText ?? '', feedback.replacementText ?? '', feedback.createdAt ?? nowIso())
        for (const decision of feedback.decisions ?? []) database.db.prepare('INSERT INTO review_decisions(id,feedback_id,decision,note,created_at) VALUES(?,?,?,?,?)').run(randomBytes(16).toString('hex'), feedbackId, decision.decision, decision.note ?? '', decision.createdAt ?? nowIso())
      }
    }
    for (const item of source.mobileInbox ?? []) {
      const itemId = randomBytes(16).toString('hex')
      database.createMobileInboxItem({ id: itemId, projectId: project.id, targetNodeId: item.targetNodeId ? idMap.get(String(item.targetNodeId)) ?? null : null, kind: item.kind, content: item.content, originDeviceId: null, createdAt: item.createdAt })
      for (const action of item.actions ?? []) database.createMobileInboxAction({ id: randomBytes(16).toString('hex'), itemId, action: action.action, note: action.note ?? '', createdAt: action.createdAt })
    }
    for (const session of source.sprint?.sessions ?? []) {
      const sessionId = newId(); const sceneId = session.sceneId ? idMap.get(String(session.sceneId)) ?? null : null
      if (session.scope === 'scene' && !sceneId) continue
      const sourceBaseline = session.samples?.find((sample: any) => sample.kind === 'start')?.scenes ?? []
      const baseline = sourceBaseline.map((scene: any) => ({ ...scene, sceneId: idMap.get(String(scene.sceneId)) })).filter((scene: any) => scene.sceneId)
      if (!baseline.length) continue
      database.createSprintSession({ id: sessionId, projectId: project.id, scope: session.scope, sceneId, durationMinutes: session.durationMinutes, goalWords: session.goalWords, baseline, startedAt: session.startedAt, plannedEndAt: session.plannedEndAt })
      database.db.prepare('DELETE FROM sprint_samples WHERE session_id=?').run(sessionId)
      for (const sample of session.samples ?? []) {
        const scenes = (sample.scenes ?? []).map((scene: any) => ({ ...scene, sceneId: idMap.get(String(scene.sceneId)) })).filter((scene: any) => scene.sceneId)
        database.addSprintSample({ id: newId(), sessionId, kind: sample.kind, capturedAt: sample.capturedAt, activeElapsedMs: sample.activeElapsedMs, totalWords: sample.totalWords, netWords: sample.netWords, scenes })
      }
      for (const event of session.events ?? []) database.appendSprintEvent({ id: newId(), sessionId, type: event.type, occurredAt: event.occurredAt, activeElapsedMs: event.activeElapsedMs, metadata: event.metadata ?? {} })
      const finalStatus = ['completed', 'cancelled'].includes(session.status) ? session.status : 'cancelled'
      const endedAt = session.endedAt ?? archive.payload.exportedAt
      if (!['completed', 'cancelled'].includes(session.status)) database.appendSprintEvent({ sessionId, type: 'cancelled', occurredAt: endedAt, activeElapsedMs: session.activeElapsedMs ?? 0, metadata: { reason: 'backup_restore' } })
      database.updateSprintSession(sessionId, { status: finalStatus, clockStatus: session.clockStatus ?? 'ok', pausedAt: null, endedAt, totalPausedMs: session.totalPausedMs ?? 0, lastReconciledAt: endedAt })
      if (finalStatus === 'completed' && session.resultCard) {
        const events = database.getSprintSession(sessionId)!.events
        database.createSprintResultCard({ ...session.resultCard, id: newId(), sessionId, projectId: project.id, projectFingerprint: sha256(`bbd-sprint-v1:project:${project.id}`), scopeFingerprint: sha256(`bbd-sprint-v1:scope:${project.id}:${session.scope}:${sceneId ?? 'all'}`), eventChainHead: events.at(-1)!.eventHash, eventCount: events.length })
      }
    }
    for (const board of source.sprint?.boards ?? []) {
      const restoredBoard = database.createSprintBoard({ projectId: project.id, name: board.name, period: board.period, targetWords: board.targetWords, periodStartedAt: board.periodStartedAt })
      for (const sprintPackage of board.packages ?? []) database.addSprintBoardCard(restoredBoard.id, sprintPackage, board.updatedAt ?? nowIso())
    }
    if (source.templates) templates.importProjectBundle(project.id, source.templates, idMap)
    for (const node of source.nodes as any[]) if (node.deletedAt && idMap.has(node.id)) database.softDeleteNode(idMap.get(node.id)!, true)
    for (const entity of source.entities as any[]) if (entity.deletedAt && entityMap.has(entity.id)) database.updateEntity(entityMap.get(entity.id)!, { deletedAt: nowIso() })
    return database.getProject(project.id)
  } catch (error) {
    cleanupProject(database, project.id)
    throw error
  }
}

function cleanupProject(database: AppDatabase, projectId: string) {
  database.db.exec('PRAGMA foreign_keys=OFF')
  try {
    database.db.prepare('UPDATE research_tasks SET project_id=NULL WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM visual_events WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM storyboard_cards WHERE storyboard_id IN (SELECT id FROM storyboards WHERE project_id=?)').run(projectId)
    database.db.prepare('DELETE FROM storyboards WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM visual_candidates WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM visual_anchors WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM template_events WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM template_applications WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM template_grants WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM sprint_board_cards WHERE board_id IN (SELECT id FROM sprint_boards WHERE project_id=?)').run(projectId)
    database.db.prepare('DELETE FROM sprint_boards WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM sprint_result_cards WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM sprint_events WHERE session_id IN (SELECT id FROM sprint_sessions WHERE project_id=?)').run(projectId)
    database.db.prepare('DELETE FROM sprint_samples WHERE session_id IN (SELECT id FROM sprint_sessions WHERE project_id=?)').run(projectId)
    database.db.prepare('DELETE FROM sprint_sessions WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM review_decisions WHERE feedback_id IN (SELECT f.id FROM review_feedback f JOIN review_sessions s ON s.id=f.session_id WHERE s.project_id=?)').run(projectId)
    database.db.prepare('DELETE FROM review_feedback WHERE session_id IN (SELECT id FROM review_sessions WHERE project_id=?)').run(projectId)
    database.db.prepare('DELETE FROM review_sessions WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM mobile_inbox_actions WHERE item_id IN (SELECT id FROM mobile_inbox_items WHERE project_id=?)').run(projectId)
    database.db.prepare('DELETE FROM mobile_inbox_items WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM sync_conflicts WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM sync_updates WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM sync_object_versions WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM sync_scene_states WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM sync_project_configs WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM provenance_exports WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM provenance_events WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM voice_preference_stats WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM style_analysis_runs WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM character_voice_profiles WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM scene_voice_profiles WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM project_voice_defaults WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM ai_tasks WHERE project_id=?').run(projectId)
    const seriesId = (database.db.prepare('SELECT series_id FROM series_projects WHERE project_id=?').get(projectId) as any)?.series_id as string | undefined
    database.db.prepare('DELETE FROM delivery_check_runs WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM project_delivery_rule_overrides WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM read_aloud_preferences WHERE project_id=?').run(projectId)
    const styleSampleIds = database.db.prepare('SELECT id FROM style_samples WHERE project_id=? OR series_id=?').all(projectId, seriesId ?? '').map((row: any) => String(row.id))
    for (const id of styleSampleIds) database.db.prepare('DELETE FROM style_sample_preferences WHERE sample_id=?').run(id)
    database.db.prepare('DELETE FROM style_samples WHERE project_id=? OR series_id=?').run(projectId, seriesId ?? '')
    database.db.prepare('DELETE FROM series_canon_overrides WHERE project_id=?').run(projectId)
    if (seriesId) { database.db.prepare('DELETE FROM series_canon_overrides WHERE entry_id IN (SELECT id FROM series_canon_entries WHERE series_id=?)').run(seriesId); database.db.prepare('DELETE FROM series_canon_entries WHERE series_id=?').run(seriesId) }
    database.db.prepare('DELETE FROM series_projects WHERE project_id=?').run(projectId)
    if (seriesId) database.db.prepare('DELETE FROM series WHERE id=?').run(seriesId)
    const nodeIds = database.db.prepare('SELECT id FROM manuscript_nodes WHERE project_id=?').all(projectId).map((row: any) => String(row.id))
    const entityIds = database.db.prepare('SELECT id FROM entities WHERE project_id=?').all(projectId).map((row: any) => String(row.id))
    const foreshadowIds = database.db.prepare('SELECT id FROM foreshadows WHERE project_id=?').all(projectId).map((row: any) => String(row.id))
    for (const id of foreshadowIds) database.db.prepare('DELETE FROM foreshadow_events WHERE foreshadow_id=?').run(id)
    database.db.prepare('DELETE FROM foreshadows WHERE project_id=?').run(projectId)
    const knowledgeIds = database.db.prepare('SELECT id FROM knowledge_facts WHERE project_id=?').all(projectId).map((row: any) => String(row.id))
    for (const id of knowledgeIds) database.db.prepare('DELETE FROM knowledge_grants WHERE knowledge_id=?').run(id)
    database.db.prepare('DELETE FROM knowledge_facts WHERE project_id=?').run(projectId)
    for (const id of nodeIds) { database.db.prepare('DELETE FROM scene_search WHERE node_id=?').run(id); database.db.prepare('DELETE FROM revisions WHERE node_id=?').run(id); database.db.prepare('DELETE FROM scene_documents WHERE node_id=?').run(id); database.db.prepare('DELETE FROM mentions WHERE node_id=?').run(id) }
    for (const id of entityIds) database.db.prepare('DELETE FROM entity_states WHERE entity_id=?').run(id)
    for (const table of ['candidate_changes', 'canon_events', 'operation_log', 'project_settings', 'imported_sources', 'replace_batches', 'continuity_exceptions']) database.db.prepare(`DELETE FROM ${table} WHERE project_id=?`).run(projectId)
    database.db.prepare('DELETE FROM manuscript_nodes WHERE project_id=?').run(projectId); database.db.prepare('DELETE FROM entities WHERE project_id=?').run(projectId); database.db.prepare('DELETE FROM projects WHERE id=?').run(projectId)
    database.db.exec(`DELETE FROM visual_assets WHERE content_hash NOT IN (SELECT asset_hash FROM visual_candidates) AND content_hash NOT IN (SELECT asset_hash FROM storyboard_cards WHERE asset_hash IS NOT NULL)`)
  } finally { database.db.exec('PRAGMA foreign_keys=ON') }
}

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= days[month - 1]
}

function isValidClockTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60)
}
