import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { diffChars } from 'diff'
import * as Y from 'yjs'
import type {
  Entity,
  EntityProfileField,
  EntityRelationship,
  EntityState,
  ManuscriptNode,
  MobileInboxItem,
  Project,
  ProvenanceEvent,
  Revision,
  SceneDocument,
  StoryPlan,
  SyncApplyResult,
  SyncConflict,
  SyncDrillResult,
  SyncPackageInspection,
  SyncProjectStatus,
  SyncTransferPackage,
  SyncVector,
} from '../shared/types.js'
import { AppDatabase, provenanceEventHash } from './db.js'
import { jsonParse, newId, normalizeName, nowIso, sha256 } from './utils.js'

type Row = Record<string, unknown>

interface SyncScenePayload {
  node: ManuscriptNode
  document: SceneDocument
  revisions: Revision[]
  yState: string
  yStateVector: string
  vector: SyncVector
  contentHash: string
  deleted: boolean
}

interface SyncEntityPayload {
  entity: Entity
  states: EntityState[]
  profileFields?: EntityProfileField[]
  relationships?: EntityRelationship[]
  vector: SyncVector
  contentHash: string
  deleted: boolean
}

interface SyncAttachmentPayload {
  id: string
  projectId: string
  address: string
  fileName: string
  mimeType: string
  byteSize: number
  contentHash: string
  contentBase64: string
  createdAt: string
}

interface SyncPayload {
  version: 1
  project: Project
  nodes: ManuscriptNode[]
  scenes: SyncScenePayload[]
  entities: SyncEntityPayload[]
  attachments: SyncAttachmentPayload[]
  mobileInbox?: MobileInboxItem[]
  storyPlan?: StoryPlan
  provenance: ProvenanceEvent[]
  createdAt: string
}

interface SyncConfigRow {
  projectId: string
  deviceId: string
  deviceName: string
  keySalt: string
  keyVerifier: string
  sequence: number
  vector: SyncVector
  createdAt: string
  updatedAt: string
  lastExportedAt: string | null
  lastImportedAt: string | null
}

export class SyncService {
  constructor(private readonly database: AppDatabase) {}

  status(projectId: string): SyncProjectStatus {
    if (!this.database.getProject(projectId)) throw new Error('Project not found')
    const config = this.config(projectId)
    return {
      initialized: Boolean(config), protocolVersion: 'bbd-sync-v1', deviceId: config?.deviceId ?? null, deviceName: config?.deviceName ?? '', sequence: config?.sequence ?? 0,
      vector: config?.vector ?? {}, pendingPackages: Number((this.database.db.prepare("SELECT COUNT(*) AS count FROM sync_updates WHERE project_id=? AND direction='outgoing'").get(projectId) as Row).count),
      unresolvedConflicts: Number((this.database.db.prepare("SELECT COUNT(*) AS count FROM sync_conflicts WHERE project_id=? AND status='pending'").get(projectId) as Row).count),
      lastExportedAt: config?.lastExportedAt ?? null, lastImportedAt: config?.lastImportedAt ?? null, engineeringOnly: true,
    }
  }

  initialize(projectId: string, deviceName: string): { status: SyncProjectStatus; recoveryPhrase: string } {
    if (!this.database.getProject(projectId)) throw new Error('Project not found')
    if (this.config(projectId)) throw new Error('同步实验已初始化；恢复短语不会再次显示')
    const recoveryPhrase = generateRecoveryPhrase()
    const keySalt = randomBytes(16).toString('base64')
    const verifier = keyVerifier(deriveSyncKey(recoveryPhrase, keySalt))
    const createdAt = nowIso()
    this.database.db.prepare('INSERT INTO sync_project_configs(project_id,device_id,device_name,key_salt,key_verifier,sequence,vector_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(
      projectId, newId(), cleanDeviceName(deviceName), keySalt, verifier, 0, '{}', createdAt, createdAt,
    )
    return { status: this.status(projectId), recoveryPhrase }
  }

  exportPackage(projectId: string, recoveryPhrase: string): SyncTransferPackage {
    const project = this.database.getProject(projectId)
    const config = this.requireConfig(projectId)
    const key = this.requireKey(config, recoveryPhrase)
    if (!project) throw new Error('Project not found')
    const sequence = config.sequence + 1
    const vector = { ...config.vector, [config.deviceId]: sequence }
    const nodes = this.database.listNodes(projectId, true)
    const scenes = nodes.filter((node) => node.type === 'scene').map((node) => this.captureScene(projectId, node, vector))
    const entities = this.database.listEntities(projectId, true).map((entity) => this.captureEntity(projectId, entity, vector))
    const attachments = this.captureAttachments(projectId)
    const mobileInbox = this.database.listMobileInbox(projectId)
    const payload: SyncPayload = { version: 1, project, nodes, scenes, entities, attachments, mobileInbox, storyPlan: this.database.getStoryPlan(projectId, true) ?? undefined, provenance: this.database.listProvenanceEvents(projectId), createdAt: nowIso() }
    const transfer = encryptPayload(payload, {
      projectFingerprint: projectFingerprint(projectId, config.keySalt), senderDeviceId: config.deviceId, senderDeviceName: config.deviceName,
      sequence, vector, keySalt: config.keySalt, keyVerifier: config.keyVerifier,
    }, key)
    const createdAt = nowIso()
    this.database.transaction(() => {
      this.database.db.prepare('UPDATE sync_project_configs SET sequence=?,vector_json=?,updated_at=?,last_exported_at=? WHERE project_id=?').run(sequence, JSON.stringify(vector), createdAt, createdAt, projectId)
      this.database.db.prepare(`INSERT INTO sync_updates(id,project_id,sender_device_id,sequence,vector_json,envelope_json,payload_hash,direction,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        transfer.packageId, projectId, config.deviceId, sequence, JSON.stringify(vector), JSON.stringify(transfer), transfer.ciphertextHash, 'outgoing', 'ready', transfer.createdAt,
      )
    })
    return transfer
  }

  inspectPackage(value: unknown, recoveryPhrase: string): SyncPackageInspection {
    const transfer = parseTransfer(value)
    const payload = decryptPayload(transfer, recoveryPhrase)
    validatePayload(payload)
    return {
      valid: true, projectFingerprint: transfer.projectFingerprint, senderDeviceName: transfer.senderDeviceName, sequence: transfer.sequence, vector: transfer.vector,
      projectTitle: payload.project.title, sceneCount: payload.scenes.length, entityCount: payload.entities.length, attachmentCount: payload.attachments.length, mobileItemCount: payload.mobileInbox?.length ?? 0, provenanceEventCount: payload.provenance.length, createdAt: transfer.createdAt,
    }
  }

  importPackage(value: unknown, recoveryPhrase: string, deviceName = '这台设备'): SyncApplyResult {
    const transfer = parseTransfer(value)
    const payload = decryptPayload(transfer, recoveryPhrase)
    validatePayload(payload)
    const existingProject = this.database.getProject(payload.project.id)
    if (!existingProject) return this.bootstrap(payload, transfer, recoveryPhrase, deviceName)
    const config = this.requireConfig(payload.project.id)
    this.requireKey(config, recoveryPhrase)
    if (projectFingerprint(payload.project.id, config.keySalt) !== transfer.projectFingerprint || config.keySalt !== transfer.keySalt) throw new Error('接力包属于另一个同步项目')
    const duplicate = this.database.db.prepare('SELECT 1 FROM sync_updates WHERE project_id=? AND payload_hash=?').get(payload.project.id, transfer.ciphertextHash)
    if (duplicate) return { project: existingProject, bootstrapped: false, duplicate: true, appliedScenes: 0, mergedScenes: 0, appliedEntities: 0, conflictsCreated: 0, provenance: 'unchanged' }

    const provenanceRelation = chainRelation(this.database.listProvenanceEvents(payload.project.id), payload.provenance)
    let appliedScenes = 0; let mergedScenes = 0; let appliedEntities = 0; let conflictsCreated = 0
    this.database.transaction(() => {
      this.ensureMissingNodes(payload)
      if (payload.storyPlan) this.database.syncStoryPlan(payload.project.id, payload.storyPlan)
      if (provenanceRelation === 'remote_extends') this.appendProvenance(payload.project.id, payload.provenance)
      else if (provenanceRelation === 'fork') { this.createProvenanceConflict(payload.project.id, payload.provenance, transfer); conflictsCreated += 1 }

      for (const remote of payload.scenes) {
        const outcome = this.applyScene(payload.project.id, remote, transfer)
        appliedScenes += outcome.applied ? 1 : 0; mergedScenes += outcome.merged ? 1 : 0; conflictsCreated += outcome.conflict ? 1 : 0
      }
      for (const remote of payload.entities) if (!this.database.getEntity(remote.entity.id)) this.writeEntity(remote, false)
      for (const remote of payload.entities) {
        const outcome = this.applyEntity(payload.project.id, remote, transfer)
        appliedEntities += outcome.applied ? 1 : 0; conflictsCreated += outcome.conflict ? 1 : 0
      }
      this.writeAttachments(payload.project.id, payload.attachments)
      this.writeMobileInbox(payload.project.id, payload.mobileInbox ?? [])
      const mergedVector = maxVector(config.vector, transfer.vector)
      const importedAt = nowIso()
      this.database.db.prepare('UPDATE sync_project_configs SET vector_json=?,updated_at=?,last_imported_at=? WHERE project_id=?').run(JSON.stringify(mergedVector), importedAt, importedAt, payload.project.id)
      this.database.db.prepare(`INSERT INTO sync_updates(id,project_id,sender_device_id,sequence,vector_json,envelope_json,payload_hash,direction,status,created_at,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        newId(), payload.project.id, transfer.senderDeviceId, transfer.sequence, JSON.stringify(transfer.vector), JSON.stringify(transfer), transfer.ciphertextHash, 'incoming', conflictsCreated ? 'conflict' : 'applied', transfer.createdAt, importedAt,
      )
      if (mergedScenes) this.database.recordProvenanceEvent({ projectId: payload.project.id, eventType: 'sync_merge', actorType: 'system', contentHash: transfer.ciphertextHash, metadata: { senderDeviceId: transfer.senderDeviceId, senderDeviceName: transfer.senderDeviceName, mergedScenes, packageId: transfer.packageId } })
    })
    return { project: this.database.getProject(payload.project.id)!, bootstrapped: false, duplicate: false, appliedScenes, mergedScenes, appliedEntities, conflictsCreated, provenance: provenanceRelation === 'remote_extends' ? 'extended' : provenanceRelation === 'fork' ? 'conflict' : 'unchanged' }
  }

  listConflicts(projectId: string): SyncConflict[] {
    if (!this.database.getProject(projectId)) throw new Error('Project not found')
    return (this.database.db.prepare('SELECT * FROM sync_conflicts WHERE project_id=? ORDER BY status,created_at DESC,rowid DESC').all(projectId) as Row[]).map(mapConflict)
  }

  resolveConflict(projectId: string, conflictId: string, resolution: 'keep_local' | 'use_remote' | 'acknowledge_remote'): SyncConflict {
    const row = this.database.db.prepare("SELECT * FROM sync_conflicts WHERE id=? AND project_id=? AND status='pending'").get(conflictId, projectId) as Row | undefined
    if (!row) throw new Error('Sync conflict not found')
    const conflict = mapConflict(row)
    if (conflict.objectType === 'provenance' && resolution === 'use_remote') throw new Error('来源链不能静默改写；请保留本机链或知悉远端分叉')
    if (conflict.objectType !== 'provenance' && resolution === 'acknowledge_remote') throw new Error('正文和正典冲突必须明确选择本机或接力包版本')
    this.database.transaction(() => {
      if (conflict.objectType === 'entity' && resolution === 'use_remote') {
        const remote = jsonParse<SyncEntityPayload>(row.remote_value_json ? String(row.remote_value_json) : null, null as never)
        if (!remote) throw new Error('远端正典值不可用')
        this.writeEntity(remote)
      }
      if (conflict.objectType === 'scene' && resolution === 'use_remote') {
        const remote = jsonParse<SyncScenePayload>(row.remote_value_json ? String(row.remote_value_json) : null, null as never)
        if (!remote) throw new Error('远端场景值不可用')
        this.writeSceneState(projectId, remote, remote.yState, false)
      }
      const resolvedAt = nowIso(); const vector = maxVector(conflict.localVector, conflict.remoteVector)
      if (conflict.objectType !== 'provenance') this.upsertObjectVersion(projectId, conflict.objectType, conflict.objectId, vector, String(resolution === 'use_remote' ? conflict.remoteSummary.contentHash ?? '' : conflict.localSummary.contentHash ?? ''), Boolean(resolution === 'use_remote' ? conflict.remoteSummary.deleted : conflict.localSummary.deleted))
      this.database.db.prepare("UPDATE sync_conflicts SET status='resolved',resolution=?,resolved_at=? WHERE id=?").run(resolution, resolvedAt, conflictId)
      this.database.recordProvenanceEvent({ projectId, eventType: 'sync_conflict_resolved', actorType: 'human', contentHash: sha256(`${conflictId}:${resolution}`), metadata: { conflictId, objectType: conflict.objectType, kind: conflict.kind, resolution, remoteHead: conflict.remoteSummary.chainHead ?? null } })
    })
    return this.listConflicts(projectId).find((item) => item.id === conflictId)!
  }

  runDrill(): SyncDrillResult {
    const checks: SyncDrillResult['checks'] = []
    const phrase = generateRecoveryPhrase(); const salt = randomBytes(16).toString('base64'); const key = deriveSyncKey(phrase, salt)
    const sample: SyncPayload = { version: 1, project: { id: 'p', title: '机密标题', description: '', createdAt: '', updatedAt: '', deletedAt: null }, nodes: [], scenes: [], entities: [], attachments: [], mobileInbox: [], provenance: [], createdAt: nowIso() }
    const transfer = encryptPayload(sample, { projectFingerprint: projectFingerprint('p', salt), senderDeviceId: 'a', senderDeviceName: '设备 A', sequence: 1, vector: { a: 1 }, keySalt: salt, keyVerifier: keyVerifier(key) }, key)
    checks.push({ code: 'E2EE', label: '服务端只见密文', passed: !JSON.stringify(transfer).includes('机密标题') && decryptPayload(transfer, phrase).project.title === '机密标题', detail: '标题与正文对象只存在于 AES-256-GCM 密文内' })
    let wrongKeyBlocked = false; try { decryptPayload(transfer, generateRecoveryPhrase()) } catch { wrongKeyBlocked = true }
    checks.push({ code: 'WRONG_KEY', label: '错误恢复短语阻断', passed: wrongKeyBlocked, detail: '错误短语无法通过密钥校验或认证标签' })
    const base = new Y.Doc(); base.getText('body').insert(0, '中间'); const baseUpdate = Y.encodeStateAsUpdate(base)
    const a = new Y.Doc(); const b = new Y.Doc(); Y.applyUpdate(a, baseUpdate); Y.applyUpdate(b, baseUpdate); a.getText('body').insert(0, '甲'); b.getText('body').insert(b.getText('body').length, '乙')
    const first = mergeYStates(toBase64(Y.encodeStateAsUpdate(a)), toBase64(Y.encodeStateAsUpdate(b))).text
    const second = mergeYStates(toBase64(Y.encodeStateAsUpdate(b)), toBase64(Y.encodeStateAsUpdate(a))).text
    checks.push({ code: 'CRDT', label: '乱序与重复更新收敛', passed: first === second && first.includes('甲') && first.includes('乙'), detail: `两个隔离副本收敛为“${first}”` })
    const missing = structuredClone(transfer); missing.chunks = missing.chunks.slice(1)
    let missingBlocked = false; try { decryptPayload(missing, phrase) } catch { missingBlocked = true }
    checks.push({ code: 'RESUME', label: '缺块可检测并续传', passed: missingBlocked && transfer.chunks.every((chunk, index) => chunk.index === index), detail: `${transfer.chunkCount} 个带独立哈希的数据块可按序补齐` })
    checks.push({ code: 'VECTOR', label: '并发业务修改显式冲突', passed: compareVectors({ a: 2 }, { a: 1, b: 1 }) === 'concurrent', detail: '版本向量不会把并发正典修改误判为先后覆盖' })
    return { ok: checks.every((check) => check.passed), checks }
  }

  private captureScene(projectId: string, node: ManuscriptNode, vector: SyncVector): SyncScenePayload {
    const document = this.database.getScene(node.id)!
    const state = this.reconcileSceneState(projectId, node.id, document.plainText)
    const contentHash = sha256(JSON.stringify({ title: node.title, status: node.status, storyTime: node.storyTime, storyTimeSpec: node.storyTimeSpec ?? null, deletedAt: node.deletedAt, plainText: document.plainText }))
    return { node, document, revisions: this.database.listRevisions(node.id).slice().reverse(), yState: state.stateBase64, yStateVector: state.stateVectorBase64, vector: this.versionForExport(projectId, 'scene', node.id, vector, contentHash, Boolean(node.deletedAt)), contentHash, deleted: Boolean(node.deletedAt) }
  }

  private captureEntity(projectId: string, entity: Entity, vector: SyncVector): SyncEntityPayload {
    const states = this.database.listStates(entity.id)
    const profileFields = this.database.listProfileFields(entity.id)
    const relationships = this.database.listRelationships(projectId, entity.id, null, true).filter((item) => item.sourceEntityId === entity.id)
    const contentHash = sha256(JSON.stringify({ entity, states, profileFields, relationships }))
    return { entity, states, profileFields, relationships, vector: this.versionForExport(projectId, 'entity', entity.id, vector, contentHash, Boolean(entity.deletedAt)), contentHash, deleted: Boolean(entity.deletedAt) }
  }

  private captureAttachments(projectId: string): SyncAttachmentPayload[] {
    const attachments = (this.database.db.prepare('SELECT * FROM imported_sources WHERE project_id=? ORDER BY created_at,rowid').all(projectId) as Row[]).map((row) => ({
      id: String(row.id), projectId, address: `sha256:${String(row.content_hash)}`, fileName: String(row.file_name), mimeType: String(row.mime_type), byteSize: Number(row.byte_size), contentHash: String(row.content_hash), contentBase64: String(row.content_base64), createdAt: String(row.created_at),
    }))
    for (const attachment of attachments) { const bytes = Buffer.from(attachment.contentBase64, 'base64'); if (bytes.length !== attachment.byteSize || sha256(bytes) !== attachment.contentHash) throw new Error('本地附件内容寻址校验失败，已取消导出') }
    return attachments
  }

  private writeAttachments(projectId: string, attachments: SyncAttachmentPayload[]) {
    for (const attachment of attachments) {
      const bytes = Buffer.from(attachment.contentBase64, 'base64')
      if (attachment.projectId !== projectId || attachment.address !== `sha256:${attachment.contentHash}` || bytes.length !== attachment.byteSize || sha256(bytes) !== attachment.contentHash) throw new Error('接力包中的附件内容寻址校验失败')
      if (this.database.db.prepare('SELECT 1 FROM imported_sources WHERE project_id=? AND content_hash=?').get(projectId, attachment.contentHash)) continue
      const id = this.database.db.prepare('SELECT 1 FROM imported_sources WHERE id=?').get(attachment.id) ? newId() : attachment.id
      this.database.db.prepare('INSERT INTO imported_sources(id,project_id,file_name,mime_type,byte_size,content_hash,content_base64,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id, projectId, attachment.fileName, attachment.mimeType, attachment.byteSize, attachment.contentHash, attachment.contentBase64, attachment.createdAt)
    }
  }

  private writeMobileInbox(projectId: string, items: MobileInboxItem[]) {
    for (const item of items) {
      if (item.projectId !== null && item.projectId !== projectId) throw new Error('接力包中的移动收集项属于另一个项目')
      this.database.createMobileInboxItem({ id: item.id, projectId: item.projectId, targetNodeId: item.targetNodeId, kind: item.kind, content: item.content, originDeviceId: item.originDeviceId, createdAt: item.createdAt })
      for (const action of item.actions) this.database.createMobileInboxAction(action)
    }
  }

  private reconcileSceneState(projectId: string, nodeId: string, plainText: string) {
    const row = this.database.db.prepare('SELECT state_base64 FROM sync_scene_states WHERE node_id=?').get(nodeId) as Row | undefined
    const result = reconcileYText(row ? String(row.state_base64) : null, plainText)
    const updatedAt = nowIso()
    this.database.db.prepare(`INSERT INTO sync_scene_states(node_id,project_id,state_base64,state_vector_base64,plain_hash,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET state_base64=excluded.state_base64,state_vector_base64=excluded.state_vector_base64,plain_hash=excluded.plain_hash,updated_at=excluded.updated_at`).run(nodeId, projectId, result.stateBase64, result.stateVectorBase64, sha256(plainText), updatedAt)
    return result
  }

  private versionForExport(projectId: string, objectType: string, objectId: string, vector: SyncVector, contentHash: string, deleted: boolean): SyncVector {
    const row = this.objectVersion(projectId, objectType, objectId)
    if (row && row.contentHash === contentHash && row.deleted === deleted) return row.vector
    this.upsertObjectVersion(projectId, objectType, objectId, vector, contentHash, deleted)
    return vector
  }

  private applyScene(projectId: string, remote: SyncScenePayload, transfer: SyncTransferPackage): { applied: boolean; merged: boolean; conflict: boolean } {
    const localNode = this.database.getNode(remote.node.id)
    if (!localNode) { this.insertScene(remote); return { applied: true, merged: false, conflict: false } }
    const localDocument = this.database.getScene(remote.node.id)!
    const localState = this.reconcileSceneState(projectId, remote.node.id, localDocument.plainText)
    const localVersion = this.objectVersion(projectId, 'scene', remote.node.id) ?? { vector: {}, contentHash: localDocument.contentHash, deleted: Boolean(localNode.deletedAt) }
    const relation = compareVectors(localVersion.vector, remote.vector)
    if (relation === 'equal' || relation === 'local_dominates') return { applied: false, merged: false, conflict: false }
    if (relation === 'concurrent' && localVersion.deleted !== remote.deleted) {
      this.createConflict(projectId, 'scene', remote.node.id, 'delete_edit', localVersion, remote, { title: localNode.title, contentHash: localVersion.contentHash, deleted: localVersion.deleted }, { title: remote.node.title, contentHash: remote.contentHash, deleted: remote.deleted, senderDeviceName: transfer.senderDeviceName }, remote)
      return { applied: false, merged: false, conflict: true }
    }
    const merged = mergeYStates(localState.stateBase64, remote.yState)
    this.writeSceneState(projectId, remote, merged.stateBase64, relation === 'concurrent')
    const vector = maxVector(localVersion.vector, remote.vector)
    this.upsertObjectVersion(projectId, 'scene', remote.node.id, vector, sha256(JSON.stringify({ title: relation === 'remote_dominates' ? remote.node.title : localNode.title, plainText: merged.text, deleted: remote.deleted })), remote.deleted)
    return { applied: true, merged: relation === 'concurrent', conflict: false }
  }

  private applyEntity(projectId: string, remote: SyncEntityPayload, transfer: SyncTransferPackage): { applied: boolean; conflict: boolean } {
    const local = this.database.getEntity(remote.entity.id)
    if (!local) { this.writeEntity(remote); this.upsertObjectVersion(projectId, 'entity', remote.entity.id, remote.vector, remote.contentHash, remote.deleted); return { applied: true, conflict: false } }
    const localVersion = this.objectVersion(projectId, 'entity', remote.entity.id) ?? { vector: {}, contentHash: this.captureEntityContent(projectId, local), deleted: Boolean(local.deletedAt) }
    const relation = compareVectors(localVersion.vector, remote.vector)
    if (relation === 'equal' || relation === 'local_dominates' || localVersion.contentHash === remote.contentHash) return { applied: false, conflict: false }
    if (relation === 'concurrent') {
      const kind = localVersion.deleted !== remote.deleted ? 'delete_edit' : 'structured_concurrent_edit'
      this.createConflict(projectId, 'entity', remote.entity.id, kind, localVersion, remote, { name: local.canonicalName, contentHash: localVersion.contentHash, deleted: localVersion.deleted }, { name: remote.entity.canonicalName, contentHash: remote.contentHash, deleted: remote.deleted, senderDeviceName: transfer.senderDeviceName }, remote)
      return { applied: false, conflict: true }
    }
    this.writeEntity(remote); this.upsertObjectVersion(projectId, 'entity', remote.entity.id, remote.vector, remote.contentHash, remote.deleted)
    return { applied: true, conflict: false }
  }

  private writeSceneState(projectId: string, remote: SyncScenePayload, stateBase64: string, merged: boolean) {
    const doc = new Y.Doc(); Y.applyUpdate(doc, fromBase64(stateBase64)); const text = doc.getText('body').toString()
    this.database.db.prepare('UPDATE manuscript_nodes SET title=?,status=?,story_time=?,story_time_json=?,deleted_at=? WHERE id=?').run(remote.node.title, remote.node.status, remote.node.storyTime, JSON.stringify(remote.node.storyTimeSpec ?? null), remote.deleted ? remote.node.deletedAt ?? nowIso() : null, remote.node.id)
    this.database.saveScene(remote.node.id, merged ? plainTextDoc(text) : remote.document.contentJson, text, 'merge', null, true)
    const stateVectorBase64 = toBase64(Y.encodeStateVector(doc)); const updatedAt = nowIso()
    this.database.db.prepare(`INSERT INTO sync_scene_states(node_id,project_id,state_base64,state_vector_base64,plain_hash,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET state_base64=excluded.state_base64,state_vector_base64=excluded.state_vector_base64,plain_hash=excluded.plain_hash,updated_at=excluded.updated_at`).run(remote.node.id, projectId, stateBase64, stateVectorBase64, sha256(text), updatedAt)
  }

  private captureEntityContent(projectId: string, entity: Entity) {
    return sha256(JSON.stringify({ entity, states: this.database.listStates(entity.id), profileFields: this.database.listProfileFields(entity.id), relationships: this.database.listRelationships(projectId, entity.id, null, true).filter((item) => item.sourceEntityId === entity.id) }))
  }

  private writeEntity(remote: SyncEntityPayload, includeExtensions = true) {
    const entity = remote.entity
    this.database.db.prepare(`INSERT INTO entities(id,project_id,type,canonical_name,normalized_name,aliases_json,summary,privacy_level,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,canonical_name=excluded.canonical_name,normalized_name=excluded.normalized_name,aliases_json=excluded.aliases_json,summary=excluded.summary,privacy_level=excluded.privacy_level,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at`).run(
      entity.id, entity.projectId, entity.type, entity.canonicalName, normalizeName(entity.canonicalName), JSON.stringify(entity.aliases), entity.summary, entity.privacyLevel, entity.createdAt, entity.updatedAt, entity.deletedAt,
    )
    this.database.db.prepare('DELETE FROM entity_states WHERE entity_id=?').run(entity.id)
    for (const state of remote.states) this.database.db.prepare(`INSERT INTO entity_states(id,entity_id,attribute_key,value_json,valid_from_node_id,valid_to_node_id,world_time_from,world_time_to,source_mention_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      state.id, state.entityId, state.attributeKey, JSON.stringify(state.value), state.validFromNodeId, state.validToNodeId, state.worldTimeFrom, state.worldTimeTo, state.sourceMentionId, state.createdAt,
    )
    if (!includeExtensions) return
    this.database.db.prepare('DELETE FROM entity_profile_fields WHERE entity_id=?').run(entity.id)
    for (const field of remote.profileFields ?? []) this.database.db.prepare('INSERT INTO entity_profile_fields(id,entity_id,category,label,value,sort_key,privacy_level,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(field.id, entity.id, field.category, field.label, field.value, field.sortKey, field.privacyLevel, field.createdAt, field.updatedAt)
    const relationshipIds = (this.database.db.prepare('SELECT id FROM entity_relationships WHERE source_entity_id=?').all(entity.id) as Row[]).map((row) => String(row.id))
    for (const relationshipId of relationshipIds) this.database.db.prepare('DELETE FROM relationship_states WHERE relationship_id=?').run(relationshipId)
    this.database.db.prepare('DELETE FROM entity_relationships WHERE source_entity_id=?').run(entity.id)
    for (const relationship of remote.relationships ?? []) {
      this.database.db.prepare('INSERT INTO entity_relationships(id,project_id,source_entity_id,target_entity_id,relation_type,direction,label,summary,privacy_level,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(relationship.id, entity.projectId, relationship.sourceEntityId, relationship.targetEntityId, relationship.relationType, relationship.direction, relationship.label, relationship.summary, relationship.privacyLevel, relationship.createdAt, relationship.updatedAt, relationship.deletedAt)
      for (const state of relationship.states) this.database.db.prepare('INSERT INTO relationship_states(id,relationship_id,status_label,note,valid_from_node_id,valid_to_node_id,world_time_from,world_time_to,source_node_id,evidence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(state.id, relationship.id, state.statusLabel, state.note, state.validFromNodeId, state.validToNodeId, state.worldTimeFrom, state.worldTimeTo, state.sourceNodeId, state.evidence, state.createdAt)
    }
  }

  private bootstrap(payload: SyncPayload, transfer: SyncTransferPackage, recoveryPhrase: string, deviceName: string): SyncApplyResult {
    const key = deriveSyncKey(recoveryPhrase, transfer.keySalt)
    if (!safeEqual(keyVerifier(key), transfer.keyVerifier)) throw new Error('恢复短语不正确或接力包已损坏')
    this.database.transaction(() => {
      const project = payload.project
      this.database.db.prepare('INSERT INTO projects(id,title,description,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?)').run(project.id, project.title, project.description, project.createdAt, project.updatedAt, project.deletedAt)
      this.database.db.prepare('INSERT INTO story_blueprints(project_id,created_at,updated_at) VALUES(?,?,?)').run(project.id, project.createdAt, payload.storyPlan ? '' : project.updatedAt)
      this.ensureMissingNodes(payload)
      if (payload.storyPlan) this.database.syncStoryPlan(project.id, payload.storyPlan)
      for (const scene of payload.scenes) this.insertScene(scene)
      for (const entity of payload.entities) this.writeEntity(entity, false)
      for (const entity of payload.entities) { this.writeEntity(entity); this.upsertObjectVersion(project.id, 'entity', entity.entity.id, entity.vector, entity.contentHash, entity.deleted) }
      this.writeAttachments(project.id, payload.attachments)
      this.writeMobileInbox(project.id, payload.mobileInbox ?? [])
      this.appendProvenance(project.id, payload.provenance)
      const createdAt = nowIso(); const receiverId = newId()
      this.database.db.prepare('INSERT INTO sync_project_configs(project_id,device_id,device_name,key_salt,key_verifier,sequence,vector_json,created_at,updated_at,last_imported_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(project.id, receiverId, cleanDeviceName(deviceName), transfer.keySalt, transfer.keyVerifier, 0, JSON.stringify(transfer.vector), createdAt, createdAt, createdAt)
      this.database.db.prepare(`INSERT INTO sync_updates(id,project_id,sender_device_id,sequence,vector_json,envelope_json,payload_hash,direction,status,created_at,applied_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(newId(), project.id, transfer.senderDeviceId, transfer.sequence, JSON.stringify(transfer.vector), JSON.stringify(transfer), transfer.ciphertextHash, 'incoming', 'applied', transfer.createdAt, createdAt)
    })
    return { project: this.database.getProject(payload.project.id)!, bootstrapped: true, duplicate: false, appliedScenes: payload.scenes.length, mergedScenes: 0, appliedEntities: payload.entities.length, conflictsCreated: 0, provenance: payload.provenance.length ? 'extended' : 'unchanged' }
  }

  private ensureMissingNodes(payload: SyncPayload) {
    const pending = payload.nodes.filter((node) => !this.database.getNode(node.id))
    while (pending.length) {
      const index = pending.findIndex((node) => !node.parentId || this.database.getNode(node.parentId))
      if (index < 0) throw new Error('接力包中的书稿树引用断裂')
      const node = pending.splice(index, 1)[0]
      this.database.db.prepare('INSERT INTO manuscript_nodes(id,project_id,parent_id,type,title,sort_key,status,pov_entity_id,story_time,story_time_json,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(node.id, payload.project.id, node.parentId, node.type, node.title, node.sortKey, node.status, null, node.storyTime, JSON.stringify(node.storyTimeSpec ?? null), node.deletedAt)
    }
  }

  private insertScene(scene: SyncScenePayload) {
    for (const revision of scene.revisions) this.database.db.prepare(`INSERT OR IGNORE INTO revisions(id,node_id,parent_revision_id,content_json,plain_text,content_hash,source_type,provenance_label,source_task_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      revision.id, revision.nodeId, revision.parentRevisionId, JSON.stringify(revision.contentJson), revision.plainText, revision.contentHash, revision.sourceType, revision.provenanceLabel, revision.sourceTaskId, revision.createdAt,
    )
    const document = scene.document
    this.database.db.prepare(`INSERT INTO scene_documents(node_id,content_json,plain_text,content_hash,current_revision_id,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET content_json=excluded.content_json,plain_text=excluded.plain_text,content_hash=excluded.content_hash,current_revision_id=excluded.current_revision_id,updated_at=excluded.updated_at`).run(document.nodeId, JSON.stringify(document.contentJson), document.plainText, document.contentHash, document.currentRevisionId, document.updatedAt)
    this.database.db.prepare('DELETE FROM scene_search WHERE node_id=?').run(document.nodeId)
    this.database.db.prepare('INSERT INTO scene_search(node_id,title,plain_text) VALUES(?,?,?)').run(document.nodeId, scene.node.title, document.plainText)
    this.database.db.prepare(`INSERT INTO sync_scene_states(node_id,project_id,state_base64,state_vector_base64,plain_hash,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET state_base64=excluded.state_base64,state_vector_base64=excluded.state_vector_base64,plain_hash=excluded.plain_hash,updated_at=excluded.updated_at`).run(document.nodeId, scene.node.projectId, scene.yState, scene.yStateVector, sha256(document.plainText), nowIso())
    this.upsertObjectVersion(scene.node.projectId, 'scene', scene.node.id, scene.vector, scene.contentHash, scene.deleted)
  }

  private appendProvenance(projectId: string, remote: ProvenanceEvent[]) {
    validateEventChain(remote)
    const existing = new Set(this.database.listProvenanceEvents(projectId).map((event) => event.eventHash))
    for (const event of remote.filter((item) => !existing.has(item.eventHash))) this.database.db.prepare(`INSERT INTO provenance_events(id,project_id,node_id,revision_id,event_type,actor_type,source_task_id,source_revision_id,content_hash,metadata_json,previous_hash,event_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      this.database.db.prepare('SELECT 1 FROM provenance_events WHERE id=?').get(event.id) ? newId() : event.id, projectId,
      event.nodeId && this.database.getNode(event.nodeId) ? event.nodeId : null,
      event.revisionId && this.database.db.prepare('SELECT 1 FROM revisions WHERE id=?').get(event.revisionId) ? event.revisionId : null,
      event.eventType, event.actorType, event.sourceTaskId, event.sourceRevisionId && this.database.db.prepare('SELECT 1 FROM revisions WHERE id=?').get(event.sourceRevisionId) ? event.sourceRevisionId : null,
      event.contentHash, JSON.stringify(event.metadata), event.previousHash, event.eventHash, event.createdAt,
    )
  }

  private createProvenanceConflict(projectId: string, remote: ProvenanceEvent[], transfer: SyncTransferPackage) {
    validateEventChain(remote)
    const local = this.database.listProvenanceEvents(projectId); const remoteHead = remote.at(-1)?.eventHash ?? ''; const localHead = local.at(-1)?.eventHash ?? ''
    if (this.database.db.prepare("SELECT 1 FROM sync_conflicts WHERE project_id=? AND object_type='provenance' AND object_id=? AND status='pending'").get(projectId, remoteHead)) return
    this.createConflict(projectId, 'provenance', remoteHead, 'provenance_fork', { vector: this.requireConfig(projectId).vector, contentHash: localHead, deleted: false }, null, { chainHead: localHead, eventCount: local.length, contentHash: localHead }, { chainHead: remoteHead, eventCount: remote.length, senderDeviceName: transfer.senderDeviceName, contentHash: remoteHead }, null, transfer.vector)
    this.database.recordProvenanceEvent({ projectId, eventType: 'sync_conflict', actorType: 'system', contentHash: remoteHead, metadata: { kind: 'provenance_fork', localHead, remoteHead, senderDeviceName: transfer.senderDeviceName } })
  }

  private createConflict(projectId: string, objectType: SyncConflict['objectType'], objectId: string, kind: SyncConflict['kind'], localVersion: { vector: SyncVector; contentHash: string; deleted: boolean }, _remoteVersion: unknown, localSummary: Record<string, unknown>, remoteSummary: Record<string, unknown>, remoteValue: unknown, remoteVector?: SyncVector) {
    const id = newId(); const createdAt = nowIso(); const nextRemoteVector = remoteVector ?? (remoteValue as { vector?: SyncVector } | null)?.vector ?? {}
    this.database.db.prepare(`INSERT INTO sync_conflicts(id,project_id,object_type,object_id,kind,local_vector_json,remote_vector_json,local_summary_json,remote_summary_json,local_value_json,remote_value_json,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, projectId, objectType, objectId, kind, JSON.stringify(localVersion.vector), JSON.stringify(nextRemoteVector), JSON.stringify(localSummary), JSON.stringify(remoteSummary), null, remoteValue === null ? null : JSON.stringify(remoteValue), 'pending', createdAt,
    )
  }

  private objectVersion(projectId: string, objectType: string, objectId: string): { vector: SyncVector; contentHash: string; deleted: boolean } | null {
    const row = this.database.db.prepare('SELECT * FROM sync_object_versions WHERE project_id=? AND object_type=? AND object_id=?').get(projectId, objectType, objectId) as Row | undefined
    return row ? { vector: jsonParse(String(row.vector_json), {}), contentHash: String(row.content_hash), deleted: Boolean(row.deleted) } : null
  }

  private upsertObjectVersion(projectId: string, objectType: string, objectId: string, vector: SyncVector, contentHash: string, deleted: boolean) {
    this.database.db.prepare(`INSERT INTO sync_object_versions(project_id,object_type,object_id,vector_json,content_hash,deleted,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id,object_type,object_id) DO UPDATE SET vector_json=excluded.vector_json,content_hash=excluded.content_hash,deleted=excluded.deleted,updated_at=excluded.updated_at`).run(projectId, objectType, objectId, JSON.stringify(vector), contentHash, deleted ? 1 : 0, nowIso())
  }

  private config(projectId: string): SyncConfigRow | null {
    const row = this.database.db.prepare('SELECT * FROM sync_project_configs WHERE project_id=?').get(projectId) as Row | undefined
    return row ? mapConfig(row) : null
  }

  private requireConfig(projectId: string) { const config = this.config(projectId); if (!config) throw new Error('请先初始化同步实验'); return config }
  private requireKey(config: SyncConfigRow, phrase: string) { const key = deriveSyncKey(phrase, config.keySalt); if (!safeEqual(keyVerifier(key), config.keyVerifier)) throw new Error('恢复短语不正确'); return key }
}

export function generateRecoveryPhrase(): string { return randomBytes(24).toString('hex').match(/.{1,4}/g)!.join('-') }

export function deriveSyncKey(recoveryPhrase: string, saltBase64: string): Buffer {
  const normalized = recoveryPhrase.toLowerCase().replace(/[^a-f0-9]/g, '')
  if (!/^[a-f0-9]{48}$/.test(normalized)) throw new Error('恢复短语格式不正确')
  return scryptSync(normalized, Buffer.from(saltBase64, 'base64'), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
}

export function compareVectors(local: SyncVector, remote: SyncVector): 'equal' | 'local_dominates' | 'remote_dominates' | 'concurrent' {
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)])
  let localGreater = false; let remoteGreater = false
  for (const key of keys) { const a = local[key] ?? 0; const b = remote[key] ?? 0; if (a > b) localGreater = true; if (b > a) remoteGreater = true }
  if (!localGreater && !remoteGreater) return 'equal'
  if (localGreater && !remoteGreater) return 'local_dominates'
  if (!localGreater && remoteGreater) return 'remote_dominates'
  return 'concurrent'
}

export function maxVector(a: SyncVector, b: SyncVector): SyncVector { const result: SyncVector = { ...a }; for (const [key, value] of Object.entries(b)) result[key] = Math.max(result[key] ?? 0, value); return result }

function encryptPayload(payload: SyncPayload, header: { projectFingerprint: string; senderDeviceId: string; senderDeviceName: string; sequence: number; vector: SyncVector; keySalt: string; keyVerifier: string }, key: Buffer): SyncTransferPackage {
  const packageId = newId(); const createdAt = nowIso(); const nonce = randomBytes(12)
  const aadObject = { format: 'bbd-sync-v1', protocolVersion: 1, packageId, ...header, createdAt }
  const aad = Buffer.from(JSON.stringify(aadObject)); const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]); const authTag = cipher.getAuthTag(); const chunkSize = 64 * 1024
  const chunks = Array.from({ length: Math.ceil(ciphertext.length / chunkSize) }, (_, index) => { const bytes = ciphertext.subarray(index * chunkSize, (index + 1) * chunkSize); return { index, hash: hashBytes(bytes), data: bytes.toString('base64') } })
  return { format: 'bbd-sync-v1', protocolVersion: 1, packageId, ...header, nonce: nonce.toString('base64'), authTag: authTag.toString('base64'), aadHash: hashBytes(aad), ciphertextHash: hashBytes(ciphertext), chunkSize, chunkCount: chunks.length, chunks, createdAt }
}

function decryptPayload(transfer: SyncTransferPackage, recoveryPhrase: string): SyncPayload {
  const key = deriveSyncKey(recoveryPhrase, transfer.keySalt)
  if (!safeEqual(keyVerifier(key), transfer.keyVerifier)) throw new Error('恢复短语不正确或接力包已损坏')
  if (transfer.chunks.length !== transfer.chunkCount || transfer.chunks.some((chunk, index) => chunk.index !== index || hashBytes(Buffer.from(chunk.data, 'base64')) !== chunk.hash)) throw new Error('接力包缺少数据块或分块已损坏')
  const ciphertext = Buffer.concat(transfer.chunks.map((chunk) => Buffer.from(chunk.data, 'base64')))
  if (hashBytes(ciphertext) !== transfer.ciphertextHash) throw new Error('接力包密文校验失败')
  const aadObject = { format: transfer.format, protocolVersion: transfer.protocolVersion, packageId: transfer.packageId, projectFingerprint: transfer.projectFingerprint, senderDeviceId: transfer.senderDeviceId, senderDeviceName: transfer.senderDeviceName, sequence: transfer.sequence, vector: transfer.vector, keySalt: transfer.keySalt, keyVerifier: transfer.keyVerifier, createdAt: transfer.createdAt }
  const aad = Buffer.from(JSON.stringify(aadObject)); if (hashBytes(aad) !== transfer.aadHash) throw new Error('接力包头部已被修改')
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(transfer.nonce, 'base64')); decipher.setAAD(aad); decipher.setAuthTag(Buffer.from(transfer.authTag, 'base64'))
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as SyncPayload
  } catch { throw new Error('恢复短语不正确或接力包已损坏') }
}

function parseTransfer(value: unknown): SyncTransferPackage {
  if (!value || typeof value !== 'object') throw new Error('接力包不是有效对象')
  const item = value as Partial<SyncTransferPackage>
  if (item.format !== 'bbd-sync-v1' || item.protocolVersion !== 1 || !item.packageId || !item.projectFingerprint || !item.keySalt || !item.keyVerifier || !item.nonce || !item.authTag || !item.aadHash || !item.ciphertextHash || !Array.isArray(item.chunks) || typeof item.chunkCount !== 'number') throw new Error('不支持的接力包格式')
  return item as SyncTransferPackage
}

function validatePayload(payload: SyncPayload) {
  if (payload.version !== 1 || !payload.project?.id || !Array.isArray(payload.nodes) || !Array.isArray(payload.scenes) || !Array.isArray(payload.entities) || !Array.isArray(payload.attachments) || !Array.isArray(payload.provenance)) throw new Error('接力包载荷格式不正确')
  if (payload.mobileInbox !== undefined && !Array.isArray(payload.mobileInbox)) throw new Error('接力包中的移动收集项格式不正确')
  if (payload.storyPlan !== undefined && (!payload.storyPlan?.blueprint || !Array.isArray(payload.storyPlan.beats) || payload.storyPlan.blueprint.projectId !== payload.project.id)) throw new Error('接力包中的故事蓝图格式不正确')
  for (const item of payload.mobileInbox ?? []) {
    if (!item || typeof item.id !== 'string' || item.id.length < 8 || (item.projectId !== null && item.projectId !== payload.project.id) || !['inspiration', 'scene_idea', 'review_note'].includes(item.kind) || typeof item.content !== 'string' || !item.content.trim() || !Array.isArray(item.actions) || Number.isNaN(Date.parse(item.createdAt))) throw new Error('接力包中的移动收集项格式不正确')
    for (const action of item.actions) if (!action || typeof action.id !== 'string' || action.itemId !== item.id || !['filed', 'dismissed', 'revisit', 'approved'].includes(action.action) || typeof action.note !== 'string' || Number.isNaN(Date.parse(action.createdAt))) throw new Error('接力包中的移动收集动作格式不正确')
  }
  for (const attachment of payload.attachments) { const bytes = Buffer.from(attachment.contentBase64, 'base64'); if (attachment.projectId !== payload.project.id || attachment.address !== `sha256:${attachment.contentHash}` || bytes.length !== attachment.byteSize || sha256(bytes) !== attachment.contentHash) throw new Error('接力包中的附件内容寻址校验失败') }
  validateEventChain(payload.provenance)
}

function reconcileYText(existingStateBase64: string | null, targetText: string) {
  const doc = new Y.Doc(); if (existingStateBase64) Y.applyUpdate(doc, fromBase64(existingStateBase64)); const text = doc.getText('body'); const current = text.toString()
  if (!existingStateBase64) text.insert(0, targetText)
  else if (current !== targetText) { let index = 0; for (const part of diffChars(current, targetText)) { if (part.added) { text.insert(index, part.value); index += part.value.length } else if (part.removed) text.delete(index, part.value.length); else index += part.value.length } }
  return { stateBase64: toBase64(Y.encodeStateAsUpdate(doc)), stateVectorBase64: toBase64(Y.encodeStateVector(doc)), text: text.toString() }
}

function mergeYStates(a: string, b: string) { const state = Y.mergeUpdates([fromBase64(a), fromBase64(b)]); const doc = new Y.Doc(); Y.applyUpdate(doc, state); return { stateBase64: toBase64(state), stateVectorBase64: toBase64(Y.encodeStateVector(doc)), text: doc.getText('body').toString() } }
function toBase64(value: Uint8Array) { return Buffer.from(value).toString('base64') }
function fromBase64(value: string) { return new Uint8Array(Buffer.from(value, 'base64')) }
function hashBytes(value: Buffer) { return createHash('sha256').update(value).digest('hex') }
function keyVerifier(key: Buffer) { return createHmac('sha256', key).update('bbd-sync-v1-key-verifier').digest('base64') }
function safeEqual(a: string, b: string) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right) }
function projectFingerprint(projectId: string, salt: string) { return sha256(`bbd-sync-project:${projectId}:${salt}`) }
function cleanDeviceName(value: string) { return value.trim().slice(0, 60) || '这台设备' }

function chainRelation(local: ProvenanceEvent[], remote: ProvenanceEvent[]): 'equal' | 'local_extends' | 'remote_extends' | 'fork' {
  validateEventChain(remote)
  const localHashes = local.map((event) => event.eventHash); const remoteHashes = remote.map((event) => event.eventHash); const length = Math.min(localHashes.length, remoteHashes.length)
  for (let index = 0; index < length; index += 1) if (localHashes[index] !== remoteHashes[index]) return 'fork'
  if (localHashes.length === remoteHashes.length) return 'equal'
  return localHashes.length > remoteHashes.length ? 'local_extends' : 'remote_extends'
}

function validateEventChain(events: ProvenanceEvent[]) {
  let previousHash: string | null = null
  for (const event of events) { const hash = provenanceEventHash({ eventType: event.eventType, actorType: event.actorType, contentHash: event.contentHash, metadata: event.metadata, previousHash: event.previousHash, createdAt: event.createdAt }); if (event.previousHash !== previousHash || event.eventHash !== hash) throw new Error('接力包中的来源链校验失败'); previousHash = event.eventHash }
}

function mapConfig(row: Row): SyncConfigRow { return { projectId: String(row.project_id), deviceId: String(row.device_id), deviceName: String(row.device_name), keySalt: String(row.key_salt), keyVerifier: String(row.key_verifier), sequence: Number(row.sequence), vector: jsonParse(String(row.vector_json), {}), createdAt: String(row.created_at), updatedAt: String(row.updated_at), lastExportedAt: row.last_exported_at ? String(row.last_exported_at) : null, lastImportedAt: row.last_imported_at ? String(row.last_imported_at) : null } }
function mapConflict(row: Row): SyncConflict { return { id: String(row.id), projectId: String(row.project_id), objectType: row.object_type as SyncConflict['objectType'], objectId: String(row.object_id), kind: row.kind as SyncConflict['kind'], localVector: jsonParse(String(row.local_vector_json), {}), remoteVector: jsonParse(String(row.remote_vector_json), {}), localSummary: jsonParse(String(row.local_summary_json), {}), remoteSummary: jsonParse(String(row.remote_summary_json), {}), status: row.status as SyncConflict['status'], resolution: row.resolution as SyncConflict['resolution'], createdAt: String(row.created_at), resolvedAt: row.resolved_at ? String(row.resolved_at) : null } }
function plainTextDoc(text: string): Record<string, unknown> { return { type: 'doc', content: text.split(/\n/).map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : undefined })) } }
