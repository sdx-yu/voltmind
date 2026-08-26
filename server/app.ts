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
import { nowIso, sha256 } from './utils.js'

const nodeInput = z.object({ parentId: z.string().nullable(), type: z.enum(['book', 'volume', 'chapter', 'scene']), title: z.string().trim().min(1).max(200), sortKey: z.number().int().optional() })
const sceneInput = z.object({ contentJson: z.record(z.string(), z.unknown()), plainText: z.string(), sourceType: z.enum(['human', 'import', 'ai_accepted', 'restore', 'merge']).default('human'), sourceTaskId: z.string().nullable().default(null) })
const entityInput = z.object({ type: z.enum(['character', 'location', 'item', 'event']), canonicalName: z.string().trim().min(1).max(100), aliases: z.array(z.string()).default([]), summary: z.string().default(''), privacyLevel: z.enum(['normal', 'author_only', 'local_private']).default('normal') })
const replaceInput = z.object({ query: z.string().min(1), replacement: z.string(), scopes: z.array(z.enum(['body', 'title', 'canon'])).min(1) })
const foreshadowStatus = z.enum(['planted', 'reinforced', 'misdirected', 'resolved'])
const foreshadowInput = z.object({ title: z.string().trim().min(1).max(120), summary: z.string().max(1000).default(''), importance: z.enum(['low', 'medium', 'high']).default('medium'), plannedPayoff: z.string().max(1000).default(''), nodeId: z.string().nullable().optional(), evidence: z.string().max(1000).default(''), note: z.string().max(1000).default('') })
const knowledgeInput = z.object({ title: z.string().trim().min(1).max(120), detail: z.string().max(2000).default(''), keywords: z.array(z.string().trim().min(2).max(100)).min(1).max(20), firstRevealedNodeId: z.string().nullable().default(null), privacyLevel: z.enum(['normal', 'author_only', 'local_private']).default('author_only') })
const seriesInput = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(1000).default(''), projectId: z.string() })
const seriesCanonInput = z.object({ type: z.enum(['character', 'location', 'item', 'event']), canonicalName: z.string().trim().min(1).max(100), aliases: z.array(z.string()).default([]), summary: z.string().max(3000).default(''), privacyLevel: z.enum(['normal', 'author_only', 'local_private']).default('normal') })
const seriesOverrideInput = z.object({ canonicalName: z.string().trim().min(1).max(100), aliases: z.array(z.string()).default([]), summary: z.string().max(3000).default(''), privacyLevel: z.enum(['normal', 'author_only', 'local_private']).default('normal') })
const styleSampleInput = z.object({ title: z.string().trim().min(1).max(120), content: z.string().trim().min(1).max(20000), guidance: z.string().max(1000).default(''), privacyLevel: z.enum(['normal', 'author_only', 'local_private']).default('author_only'), enabled: z.boolean().default(true) })

export function createApp(config: AppConfig, database = new AppDatabase(config.databasePath)) {
  const app = express()
  const vault = new LocalVault(config.dataDir)
  const ai = new AiService(database, vault)
  const sync = new SyncService(database)
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
    const input = z.object({ parentId: z.string().nullable().optional(), title: z.string().trim().min(1).max(200).optional(), sortKey: z.number().int().optional(), status: z.enum(['idea', 'planned', 'draft', 'revising', 'complete', 'published']).optional(), povEntityId: z.string().nullable().optional(), storyTime: z.string().nullable().optional() }).parse(req.body)
    const result = database.updateNode(param(req, 'id'), input)
    if (!result) return res.status(404).json({ error: 'Node not found' })
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
  app.put('/api/scenes/:id', route(async (req, res) => res.json(database.saveScene(param(req, 'id'), ...sceneArgs(sceneInput.parse(req.body))))))
  app.get('/api/scenes/:id/revisions', route(async (req, res) => res.json(database.listRevisions(param(req, 'id')))))
  app.post('/api/scenes/:id/revisions/:revisionId/restore', route(async (req, res) => res.json(database.restoreRevision(param(req, 'id'), param(req, 'revisionId')))))
  app.post('/api/scenes/:id/complete', route(async (req, res) => {
    const node = database.getNode(param(req, 'id')); const scene = database.getScene(param(req, 'id'))
    if (!node || !scene) return res.status(404).json({ error: 'Scene not found' })
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

  app.get('/api/scenes/:id/mentions', route(async (req, res) => res.json(database.listMentions(param(req, 'id')))))
  app.get('/api/scenes/:id/current-states', route(async (req, res) => res.json(currentStatesAtScene(database, param(req, 'id')))))
  app.get('/api/scenes/:id/mention-suggestions', route(async (req, res) => res.json(database.suggestMentions(param(req, 'id')))))
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
  app.get('/api/projects/:projectId/scenes/:nodeId/context', route(async (req, res) => res.json(ai.buildContext(param(req, 'projectId'), param(req, 'nodeId')))))
  app.post('/api/ai/tasks', route(async (req, res) => {
    const input = z.object({ projectId: z.string(), nodeId: z.string(), taskType: z.enum(['brainstorm', 'continue', 'rewrite', 'cold_read', 'continuity', 'extract_facts']), instruction: z.string().default(''), selectedContextIds: z.array(z.string()) }).parse(req.body)
    res.json(await ai.runTask(input))
  }))

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
    const archive = exportProject(database, param(req, 'id'))
    res.type('application/json').setHeader('Content-Disposition', `attachment; filename="project.bbd-backup"`).send(JSON.stringify(archive, null, 2))
  }))
  app.post('/api/backups/restore', route(async (req, res) => {
    const archive = backupSchema.parse(req.body)
    const restored = importProject(database, archive)
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
    const status = /not found/i.test(message) ? 404 : /overlap|already resolved/i.test(message) ? 409 : 500
    return res.status(status).json({ error: message })
  })
  return { app, database, ai, sync }
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
      if (match && !candidateExists(database, node.projectId, nodeId, entity.id, match[0])) created.push(database.createCandidate({ projectId: node.projectId, nodeId, targetType: 'entity_state', targetId: entity.id, operation: 'set_state', before: currentState(database, entity.id, 'life_status'), after: { attributeKey: 'life_status', value: '死亡', worldTimeFrom: node.storyTime }, evidence: { quote: match[0], startOffset: match.index, endOffset: (match.index ?? 0) + match[0].length, reason: '正文出现明确死亡描述' }, confidence: 0.93, sourceTaskId: null }))
    }
    if (entity.type === 'item') {
      for (const person of entities.filter((item) => item.type === 'character')) {
        const match = scene.plainText.match(new RegExp(`(?:把|将)${escapeRegExp(entity.canonicalName)}[^。！？]{0,8}(?:交给|递给|送给)${escapeRegExp(person.canonicalName)}`))
        if (match && !candidateExists(database, node.projectId, nodeId, entity.id, match[0])) created.push(database.createCandidate({ projectId: node.projectId, nodeId, targetType: 'entity_state', targetId: entity.id, operation: 'set_state', before: currentState(database, entity.id, 'holder'), after: { attributeKey: 'holder', value: person.canonicalName, worldTimeFrom: node.storyTime }, evidence: { quote: match[0], startOffset: match.index, endOffset: (match.index ?? 0) + match[0].length, reason: '正文出现明确转交关系' }, confidence: 0.9, sourceTaskId: null }))
      }
    }
  }
  return created
}

function currentStatesAtScene(database: AppDatabase, nodeId: string) {
  const node = database.getNode(nodeId); if (!node) throw new Error('Scene not found')
  const nodes = database.listNodes(node.projectId); const chapters = nodes.filter((item) => item.type === 'chapter').sort((a, b) => a.sortKey - b.sortKey); const chapterOrder = new Map(chapters.map((item, index) => [item.id, index]))
  const scenes = nodes.filter((item) => item.type === 'scene').sort((a, b) => (chapterOrder.get(a.parentId ?? '') ?? 0) - (chapterOrder.get(b.parentId ?? '') ?? 0) || a.sortKey - b.sortKey); const order = new Map(scenes.map((item, index) => [item.id, index])); const at = order.get(nodeId) ?? Number.MAX_SAFE_INTEGER
  return database.listEntities(node.projectId).flatMap((entity) => {
    const groups = new Map<string, ReturnType<AppDatabase['listStates']>>()
    for (const state of database.listStates(entity.id)) groups.set(state.attributeKey, [...(groups.get(state.attributeKey) ?? []), state])
    return [...groups.values()].map((states) => states.filter((state) => {
      if (node.storyTime && state.worldTimeFrom) return state.worldTimeFrom <= node.storyTime && (!state.worldTimeTo || node.storyTime < state.worldTimeTo)
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
  exportedAt: z.string(), project: z.object({ title: z.string(), description: z.string() }), nodes: z.array(z.any()), documents: z.array(z.any()), revisions: z.array(z.any()), entities: z.array(z.any()), states: z.array(z.any()), mentions: z.array(z.any()), candidates: z.array(z.any()), canonEvents: z.array(z.any()), settings: z.array(z.any()), sources: z.array(z.any()), foreshadows: z.array(z.any()).optional(), knowledge: z.array(z.any()).optional(), seriesBundle: z.any().nullable().optional(), styleSamples: z.array(z.any()).optional(), delivery: z.any().optional(), aiTasks: z.array(z.any()).optional(), provenance: z.object({ events: z.array(z.any()), exports: z.array(z.any()) }).optional(),
})
const backupSchema = z.object({ format: z.literal('bbd-backup-v2'), checksum: z.string().length(64), payload: backupPayloadSchema }).superRefine((archive, context) => {
  if (sha256(JSON.stringify(archive.payload)) !== archive.checksum) context.addIssue({ code: 'custom', message: '备份校验失败，文件可能已损坏或被修改' })
})
type Backup = z.infer<typeof backupSchema>

function exportProject(database: AppDatabase, projectId: string): Backup {
  const project = database.getProject(projectId)
  if (!project) throw new Error('Project not found')
  const nodes = database.listNodes(projectId, true)
  const documents = nodes.filter((node) => node.type === 'scene').map((node) => ({ nodeId: node.id, ...database.getScene(node.id) }))
  const revisions = nodes.filter((node) => node.type === 'scene').flatMap((node) => database.listRevisions(node.id))
  const entities = database.listEntities(projectId, true)
  const states = entities.flatMap((entity) => database.listStates(entity.id))
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
  const delivery = { readAloudPreferences: database.getReadAloudPreferences(projectId), ruleOverrides: database.listDeliveryRuleOverrides(projectId), checkRuns: database.listDeliveryCheckRuns(projectId) }
  const aiTasks = database.db.prepare(`SELECT id,project_id AS projectId,node_id AS nodeId,task_type AS taskType,prompt_version AS promptVersion,model,context_hash AS contextHash,output_hash AS outputHash,input_tokens AS inputTokens,output_tokens AS outputTokens,status,created_at AS createdAt FROM ai_tasks WHERE project_id=? ORDER BY created_at,rowid`).all(projectId)
  const provenance = { events: database.listProvenanceEvents(projectId), exports: database.listProvenanceExports(projectId) }
  const payload = { exportedAt: nowIso(), project: { title: project.title, description: project.description }, nodes, documents, revisions, entities, states, mentions, candidates, canonEvents, settings, sources, foreshadows, knowledge, seriesBundle, styleSamples, delivery, aiTasks, provenance }
  return { format: 'bbd-backup-v2', checksum: sha256(JSON.stringify(payload)), payload }
}

function importProject(database: AppDatabase, archive: Backup) {
  const source = archive.payload
  const project = database.createProject(`${source.project.title}（恢复）`, source.project.description)
  const idMap = new Map<string, string>(); const entityMap = new Map<string, string>(); const mentionMap = new Map<string, string>(); const candidateMap = new Map<string, string>(); const taskMap = new Map<string, string>(); const revisionMap = new Map<string, string>()
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
      database.updateNode(created.id, { status: node.status, storyTime: node.storyTime ?? null }); idMap.set(node.id, created.id)
    }
    for (const entity of source.entities as any[]) {
      const created = database.createEntity({ projectId: project.id, type: entity.type, canonicalName: entity.canonicalName, aliases: entity.aliases, summary: entity.summary, privacyLevel: entity.privacyLevel }); entityMap.set(entity.id, created.id)
    }
    for (const node of source.nodes as any[]) if (node.povEntityId && idMap.has(node.id)) database.updateNode(idMap.get(node.id)!, { povEntityId: entityMap.get(node.povEntityId) ?? null })
    for (const task of (source.aiTasks ?? []) as any[]) {
      const taskId = randomBytes(16).toString('hex'); taskMap.set(String(task.id), taskId)
      database.db.prepare(`INSERT INTO ai_tasks(id,project_id,node_id,task_type,prompt_version,model,context_hash,output_hash,input_tokens,output_tokens,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        taskId, project.id, task.nodeId ? idMap.get(String(task.nodeId)) ?? null : null, task.taskType, task.promptVersion, task.model, task.contextHash, task.outputHash ?? null, task.inputTokens ?? 0, task.outputTokens ?? 0, task.status, task.createdAt,
      )
    }
    for (const oldNode of source.nodes.filter((item: any) => item.type === 'scene') as any[]) {
      const nodeId = idMap.get(oldNode.id)!; const history = (source.revisions as any[]).filter((item) => item.nodeId === oldNode.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      if (history.length) for (const revision of history) { const saved = database.saveScene(nodeId, revision.contentJson, revision.plainText, revision.sourceType, revision.sourceTaskId ? taskMap.get(String(revision.sourceTaskId)) ?? null : null); if (saved.currentRevisionId) revisionMap.set(String(revision.id), saved.currentRevisionId) }
      else { const doc = source.documents.find((item: any) => item.nodeId === oldNode.id) as any; if (doc) database.saveScene(nodeId, doc.contentJson, doc.plainText, 'import') }
    }
    for (const mention of source.mentions as any[]) {
      const created = database.createMention({ entityId: entityMap.get(mention.entityId)!, nodeId: idMap.get(mention.nodeId)!, quote: mention.quote, startOffset: mention.startOffset, endOffset: mention.endOffset, confirmed: mention.confirmed }); mentionMap.set(mention.id, created.id)
    }
    for (const state of source.states as any[]) database.createState({ entityId: entityMap.get(state.entityId)!, attributeKey: state.attributeKey, value: state.value, validFromNodeId: state.validFromNodeId ? idMap.get(state.validFromNodeId) ?? null : null, validToNodeId: state.validToNodeId ? idMap.get(state.validToNodeId) ?? null : null, worldTimeFrom: state.worldTimeFrom, worldTimeTo: state.worldTimeTo, sourceMentionId: state.sourceMentionId ? mentionMap.get(state.sourceMentionId) ?? null : null })
    for (const candidate of source.candidates as any[]) {
      const created = database.createCandidate({ projectId: project.id, nodeId: candidate.nodeId ? idMap.get(candidate.nodeId) ?? null : null, targetType: candidate.targetType, targetId: candidate.targetType.startsWith('entity') && candidate.targetId ? entityMap.get(candidate.targetId) ?? null : candidate.targetId, operation: candidate.operation, before: candidate.before, after: candidate.after, evidence: candidate.evidence, confidence: candidate.confidence, sourceTaskId: candidate.sourceTaskId ? taskMap.get(String(candidate.sourceTaskId)) ?? null : null }); candidateMap.set(candidate.id, created.id)
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
      if (sample.scope === 'series' && sample.effectiveEnabled !== sample.enabled) database.setStyleSamplePreference(created.id, project.id, Boolean(sample.effectiveEnabled))
      if (sample.deletedAt) database.updateStyleSample(created.id, project.id, { deletedAt: nowIso() })
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
    if (source.provenance) database.replaceProvenanceForRestore(project.id, source.provenance.events, source.provenance.exports, { nodes: idMap, revisions: revisionMap, tasks: taskMap })
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
    database.db.prepare('DELETE FROM sync_conflicts WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM sync_updates WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM sync_object_versions WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM sync_scene_states WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM sync_project_configs WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM provenance_exports WHERE project_id=?').run(projectId)
    database.db.prepare('DELETE FROM provenance_events WHERE project_id=?').run(projectId)
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
  } finally { database.db.exec('PRAGMA foreign_keys=ON') }
}
