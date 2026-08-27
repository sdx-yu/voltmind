import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { ReviewFeedback, ReviewPackage, ReviewPackageInspection, ReviewRole, ReviewSession, ReviewSessionScene } from '../shared/types.js'
import { AppDatabase, createReviewAnchor, resolveReviewAnchor } from './db.js'
import { newId, nowIso, sha256 } from './utils.js'

type AssignmentPayload = { version: 1; mode: 'assignment'; session: ReviewWireSession; scenes: ReviewSessionScene[]; createdAt: string }
type ResponsePayload = { version: 1; mode: 'response'; session: ReviewWireSession; feedback: Array<Omit<ReviewFeedback, 'decisions' | 'currentDecision' | 'anchorStatus' | 'resolvedStartOffset'>>; createdAt: string }
type ReviewPayload = AssignmentPayload | ResponsePayload
type ReviewWireSession = Pick<ReviewSession, 'id' | 'sourceProjectId' | 'projectTitle' | 'role' | 'reviewerName' | 'sceneIds' | 'includeProvenance' | 'expiresAt' | 'createdAt'>
type ReviewCrypto = { projectFingerprint: string; keySalt: string; keyVerifier: string }

export class ReviewService {
  constructor(private readonly database: AppDatabase) {}

  createAssignment(projectId: string, input: { reviewerName: string; role: ReviewRole; sceneIds: string[]; includeProvenance: boolean; expiresAt: string | null }) {
    const project = this.database.getProject(projectId); if (!project) throw new Error('Project not found')
    if (!input.reviewerName.trim() || input.reviewerName.trim().length > 120) throw new Error('请填写有效的审阅者名称')
    if (input.expiresAt && (!Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now())) throw new Error('审阅有效期必须晚于当前时间')
    const sceneIds = [...new Set(input.sceneIds)]; if (!sceneIds.length || sceneIds.length > 100) throw new Error('请选择 1–100 个审阅场景')
    const scenes = sceneIds.map((id) => {
      const node = this.database.getNode(id); const document = this.database.getScene(id)
      if (!node || node.projectId !== projectId || node.type !== 'scene' || node.deletedAt || !document) throw new Error('审阅范围包含无效场景')
      const revision = this.database.listRevisions(id)[0]
      return { id, title: node.title, plainText: document.plainText, contentHash: sha256(document.plainText), provenanceLabel: input.includeProvenance ? revision?.provenanceLabel ?? null : null }
    })
    if (Buffer.byteLength(JSON.stringify(scenes)) > 5 * 1024 * 1024) throw new Error('审阅正文超过 5 MiB 上限')
    const recoveryPhrase = generateReviewPhrase(); const keySalt = randomBytes(16).toString('base64'); const key = deriveReviewKey(recoveryPhrase, keySalt); const sessionId = newId(); const createdAt = nowIso()
    const session = this.database.createReviewSession({ id: sessionId, projectId, sourceProjectId: projectId, projectTitle: project.title, role: input.role, reviewerName: input.reviewerName, sceneIds, scenes, includeProvenance: input.includeProvenance, direction: 'authored', projectFingerprint: fingerprint(projectId, keySalt), keySalt, keyVerifier: verifier(key), expiresAt: input.expiresAt, createdAt })
    return { session, recoveryPhrase, package: this.encryptAssignment(session, key) }
  }

  exportAssignment(sessionId: string, phrase: string): ReviewPackage { const session = this.requireSession(sessionId, 'authored'); return this.encryptAssignment(session, this.requireKey(session, phrase)) }

  exportResponse(sessionId: string, phrase: string): ReviewPackage {
    const session = this.requireSession(sessionId, 'received'); const key = this.requireKey(session, phrase)
    const feedback = session.feedback.map(({ decisions: _decisions, currentDecision: _current, anchorStatus: _status, resolvedStartOffset: _offset, ...item }) => item)
    return encrypt({ version: 1, mode: 'response', session: wire(session), feedback, createdAt: nowIso() }, session, key, 'response', this.crypto(session.id))
  }

  inspectPackage(value: unknown, phrase: string): ReviewPackageInspection {
    const reviewPackage = parsePackage(value); const payload = decrypt(reviewPackage, phrase); validatePayload(payload, reviewPackage)
    return { valid: true, mode: payload.mode, sessionId: payload.session.id, projectTitle: payload.session.projectTitle, reviewerName: payload.session.reviewerName, role: payload.session.role, sceneCount: payload.session.sceneIds.length, feedbackCount: payload.mode === 'response' ? payload.feedback.length : 0, createdAt: reviewPackage.createdAt }
  }

  importPackage(value: unknown, phrase: string, targetProjectId?: string): { session: ReviewSession; duplicate: boolean } {
    const reviewPackage = parsePackage(value); const payload = decrypt(reviewPackage, phrase); validatePayload(payload, reviewPackage)
    if (payload.session.expiresAt && Date.parse(payload.session.expiresAt) < Date.now()) throw new Error('Review session has expired')
    if (payload.mode === 'assignment') {
      const existing = this.database.getReviewSession(payload.session.id)
      if (existing) { if (existing.direction !== 'received') throw new Error('不能把自己的任务包导入为审阅者副本'); return { session: existing, duplicate: true } }
      const session = this.database.createReviewSession({ ...payload.session, projectId: null, scenes: payload.scenes, direction: 'received', projectFingerprint: reviewPackage.projectFingerprint, keySalt: reviewPackage.keySalt, keyVerifier: reviewPackage.keyVerifier, status: 'open' })
      return { session, duplicate: false }
    }
    const session = this.database.getReviewSession(payload.session.id)
    if (!session || session.direction !== 'authored' || !session.projectId || session.projectId !== targetProjectId) throw new Error('回应包不属于当前作者项目')
    if (reviewPackage.projectFingerprint !== this.projectFingerprint(session)) throw new Error('回应包属于另一个审阅会话')
    if (payload.session.sourceProjectId !== session.sourceProjectId || payload.session.role !== session.role || payload.session.reviewerName !== session.reviewerName || JSON.stringify(payload.session.sceneIds) !== JSON.stringify(session.sceneIds)) throw new Error('回应包会话元数据不匹配')
    let inserted = 0
    this.database.transaction(() => { for (const feedback of payload.feedback) { const before = session.feedback.some((item) => item.id === feedback.id); this.database.createReviewFeedback(feedback); if (!before) inserted += 1 } })
    return { session: this.database.getReviewSession(session.id)!, duplicate: inserted === 0 }
  }

  addFeedback(sessionId: string, input: { id?: string; sceneId: string; kind: 'comment' | 'suggestion'; body: string; paragraphIndex: number; startOffset: number; endOffset: number; replacementText?: string }): ReviewFeedback {
    const session = this.requireSession(sessionId, 'received'); const scene = session.scenes.find((item) => item.id === input.sceneId); if (!scene) throw new Error('Feedback is outside the review scope')
    const body = input.body.trim(); if (!body || body.length > 5000) throw new Error('审阅意见需为 1–5000 个字符')
    const anchor = createReviewAnchor(scene.plainText, input.paragraphIndex, input.startOffset, input.endOffset)
    return this.database.createReviewFeedback({ id: input.id ?? newId(), sessionId, sceneId: scene.id, sceneTitle: scene.title, kind: input.kind, body, anchor, originalText: input.kind === 'suggestion' ? anchor.quote : '', replacementText: input.kind === 'suggestion' ? input.replacementText?.trim() ?? '' : '', createdAt: nowIso() })
  }

  decide(projectId: string, feedbackId: string, decision: 'accepted' | 'rejected' | 'deferred', note = ''): ReviewSession {
    const row = this.database.db.prepare('SELECT session_id FROM review_feedback WHERE id=?').get(feedbackId) as { session_id?: string } | undefined; if (!row?.session_id) throw new Error('Review feedback not found')
    const session = this.database.getReviewSession(row.session_id); const feedback = session?.feedback.find((item) => item.id === feedbackId)
    if (!session || session.projectId !== projectId || session.direction !== 'authored' || !feedback) throw new Error('Review feedback does not belong to this project')
    if (feedback.currentDecision === 'accepted' || feedback.currentDecision === 'rejected') throw new Error('Review feedback already has a final decision')
    this.database.transaction(() => {
      if (decision === 'accepted' && feedback.kind === 'suggestion') {
        const document = this.database.getScene(feedback.sceneId); if (!document) throw new Error('Review scene not found')
        const resolution = resolveReviewAnchor(document.plainText, feedback.anchor); if (resolution.status === 'lost' || resolution.offset === null) throw new Error('段落锚点已失效，请人工定位后处理')
        if (document.plainText.slice(resolution.offset, resolution.offset + feedback.originalText.length) !== feedback.originalText) throw new Error('原文已变化，不能自动接受建议')
        const text = document.plainText.slice(0, resolution.offset) + feedback.replacementText + document.plainText.slice(resolution.offset + feedback.originalText.length)
        this.database.saveScene(feedback.sceneId, plainTextDoc(text), text, 'human')
        this.database.recordProvenanceEvent({ projectId, nodeId: feedback.sceneId, eventType: 'review_suggestion_accepted', actorType: 'human', contentHash: sha256(text), metadata: { feedbackId, sessionId: session.id, reviewerRole: session.role, reviewerName: session.reviewerName, anchorStatus: resolution.status } })
      } else this.database.recordProvenanceEvent({ projectId, nodeId: feedback.sceneId, eventType: 'review_feedback_decided', actorType: 'human', contentHash: sha256(`${feedbackId}:${decision}`), metadata: { feedbackId, sessionId: session.id, decision, reviewerRole: session.role } })
      this.database.createReviewDecision({ id: newId(), feedbackId, decision, note: note.trim(), createdAt: nowIso() })
    })
    return this.database.getReviewSession(session.id)!
  }

  private encryptAssignment(session: ReviewSession, key: Buffer) { return encrypt({ version: 1, mode: 'assignment', session: wire(session), scenes: session.scenes, createdAt: nowIso() }, session, key, 'assignment', this.crypto(session.id)) }
  private requireSession(id: string, direction: ReviewSession['direction']) { const session = this.database.getReviewSession(id); if (!session || session.direction !== direction) throw new Error('Review session not found'); if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) throw new Error('Review session has expired'); return session }
  private requireKey(session: ReviewSession, phrase: string) { const row = this.database.db.prepare('SELECT key_salt,key_verifier FROM review_sessions WHERE id=?').get(session.id) as { key_salt: string; key_verifier: string }; const key = deriveReviewKey(phrase, row.key_salt); if (!safeEqual(verifier(key), row.key_verifier)) throw new Error('审阅恢复短语不正确'); return key }
  private projectFingerprint(session: ReviewSession) { return String((this.database.db.prepare('SELECT project_fingerprint FROM review_sessions WHERE id=?').get(session.id) as { project_fingerprint: string }).project_fingerprint) }
  private crypto(sessionId: string): ReviewCrypto { const row = this.database.db.prepare('SELECT project_fingerprint,key_salt,key_verifier FROM review_sessions WHERE id=?').get(sessionId) as { project_fingerprint: string; key_salt: string; key_verifier: string } | undefined; if (!row) throw new Error('Review session not found'); return { projectFingerprint: row.project_fingerprint, keySalt: row.key_salt, keyVerifier: row.key_verifier } }
}

function wire(session: ReviewSession): ReviewWireSession { return { id: session.id, sourceProjectId: session.sourceProjectId, projectTitle: session.projectTitle, role: session.role, reviewerName: session.reviewerName, sceneIds: session.sceneIds, includeProvenance: session.includeProvenance, expiresAt: session.expiresAt, createdAt: session.createdAt } }
function encrypt(payload: ReviewPayload, session: ReviewSession, key: Buffer, mode: ReviewPackage['mode'], crypto: ReviewCrypto): ReviewPackage { const packageId = newId(); const createdAt = nowIso(); const nonce = randomBytes(12); const header = { format: 'bbd-review-v1' as const, protocolVersion: 1 as const, mode, packageId, sessionId: session.id, projectFingerprint: crypto.projectFingerprint, createdAt }; const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from(JSON.stringify(header))); const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]); return { ...header, keySalt: crypto.keySalt, keyVerifier: crypto.keyVerifier, nonce: nonce.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), ciphertextHash: hash(ciphertext), ciphertext: ciphertext.toString('base64') } }

function parsePackage(value: unknown): ReviewPackage { if (!value || typeof value !== 'object') throw new Error('审阅包不是有效对象'); const item = value as Partial<ReviewPackage>; if (item.format !== 'bbd-review-v1' || item.protocolVersion !== 1 || !['assignment','response'].includes(String(item.mode)) || !item.packageId || !item.sessionId || !item.projectFingerprint || !item.keySalt || !item.keyVerifier || !item.nonce || !item.authTag || !item.ciphertextHash || !item.ciphertext || item.ciphertext.length > 10 * 1024 * 1024) throw new Error('不支持的审阅包格式'); return item as ReviewPackage }
function decrypt(reviewPackage: ReviewPackage, phrase: string): ReviewPayload { const key = deriveReviewKey(phrase, reviewPackage.keySalt); if (!safeEqual(verifier(key), reviewPackage.keyVerifier)) throw new Error('审阅恢复短语不正确或包已损坏'); const ciphertext = Buffer.from(reviewPackage.ciphertext, 'base64'); if (hash(ciphertext) !== reviewPackage.ciphertextHash) throw new Error('审阅包密文校验失败'); const header = { format: reviewPackage.format, protocolVersion: reviewPackage.protocolVersion, mode: reviewPackage.mode, packageId: reviewPackage.packageId, sessionId: reviewPackage.sessionId, projectFingerprint: reviewPackage.projectFingerprint, createdAt: reviewPackage.createdAt }; try { const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(reviewPackage.nonce, 'base64')); decipher.setAAD(Buffer.from(JSON.stringify(header))); decipher.setAuthTag(Buffer.from(reviewPackage.authTag, 'base64')); return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString()) as ReviewPayload } catch { throw new Error('审阅恢复短语不正确或包已损坏') } }
function validatePayload(payload: ReviewPayload, reviewPackage: ReviewPackage) {
  const session = payload?.session
  if (payload.version !== 1 || payload.mode !== reviewPackage.mode || session?.id !== reviewPackage.sessionId || !session.sourceProjectId || !session.projectTitle || !session.reviewerName || !['editor','beta_reader','co_writer'].includes(session.role) || !Array.isArray(session.sceneIds) || !session.sceneIds.length || session.sceneIds.length > 100 || new Set(session.sceneIds).size !== session.sceneIds.length || fingerprint(session.sourceProjectId, reviewPackage.keySalt) !== reviewPackage.projectFingerprint || (session.expiresAt !== null && !Number.isFinite(Date.parse(session.expiresAt)))) throw new Error('审阅包载荷格式不正确')
  if (payload.mode === 'assignment') {
    if (!Array.isArray(payload.scenes) || payload.scenes.length !== session.sceneIds.length || Buffer.byteLength(JSON.stringify(payload.scenes)) > 5 * 1024 * 1024 || payload.scenes.some((scene, index) => !scene || scene.id !== session.sceneIds[index] || !scene.title || typeof scene.plainText !== 'string' || scene.contentHash !== sha256(scene.plainText))) throw new Error('审阅任务范围无效')
    return
  }
  if (!Array.isArray(payload.feedback) || payload.feedback.length > 5000 || new Set(payload.feedback.map((item) => item?.id)).size !== payload.feedback.length || payload.feedback.some((item) => {
    const anchor = item?.anchor
    return !item || !item.id || item.sessionId !== session.id || !session.sceneIds.includes(item.sceneId) || !['comment','suggestion'].includes(item.kind) || typeof item.body !== 'string' || !item.body.trim() || item.body.length > 5000 || !anchor || !Number.isInteger(anchor.paragraphIndex) || !Number.isInteger(anchor.startOffset) || !Number.isInteger(anchor.endOffset) || anchor.startOffset < 0 || anchor.endOffset <= anchor.startOffset || typeof anchor.quote !== 'string' || !anchor.quote || typeof anchor.paragraphHash !== 'string' || typeof anchor.contextBefore !== 'string' || typeof anchor.contextAfter !== 'string' || (session.role === 'beta_reader' && item.kind === 'suggestion') || (item.kind === 'suggestion' && (item.originalText !== anchor.quote || !item.replacementText?.trim())) || (item.kind === 'comment' && (item.originalText !== '' || item.replacementText !== ''))
  })) throw new Error('审阅回应越权或格式不正确')
}
export function generateReviewPhrase() { return randomBytes(24).toString('hex').match(/.{1,4}/g)!.join('-') }
function deriveReviewKey(phrase: string, salt: string) { const normalized = phrase.toLowerCase().replace(/[^a-f0-9]/g, ''); if (!/^[a-f0-9]{48}$/.test(normalized)) throw new Error('审阅恢复短语格式不正确'); return scryptSync(normalized, Buffer.from(salt, 'base64'), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }) }
function verifier(key: Buffer) { return createHash('sha256').update(key).update('bbd-review-v1').digest('base64') }
function fingerprint(projectId: string, salt: string) { return sha256(`bbd-review-project:${projectId}:${salt}`) }
function hash(value: Buffer) { return createHash('sha256').update(value).digest('hex') }
function safeEqual(a: string, b: string) { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right) }
function plainTextDoc(text: string): Record<string, unknown> { return { type: 'doc', content: text.split(/\n/).map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : undefined })) } }
