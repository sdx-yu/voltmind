import { z } from 'zod'
import type { SprintBoard, SprintPackage, SprintPackageInspection, SprintResultCard, SprintSession, SprintSnapshotScene } from '../shared/types.js'
import { AppDatabase, sprintEventHash } from './db.js'
import { newId, sha256 } from './utils.js'

const eventMetadataSchema = z.object({ reason: z.string().max(80).optional(), gapMs: z.number().int().nonnegative().max(31_536_000_000).optional() }).strict()
const shareEventSchema = z.object({
  id: z.string().uuid(), type: z.enum(['started', 'paused', 'resumed', 'sleep_detected', 'clock_anomaly', 'completed', 'cancelled']), occurredAt: z.string().datetime(),
  activeElapsedMs: z.number().int().nonnegative(), metadata: eventMetadataSchema, previousHash: z.string().length(64).nullable(), eventHash: z.string().length(64),
}).strict()
const shareCardSchema = z.object({
  id: z.string().uuid(), participantLabel: z.string().trim().min(1).max(40), scope: z.enum(['scene', 'project']), projectFingerprint: z.string().length(64), scopeFingerprint: z.string().length(64),
  startedAt: z.string().datetime(), endedAt: z.string().datetime(), activeDurationMs: z.number().int().nonnegative(), goalWords: z.number().int().min(1).max(50_000), netWords: z.number().int().min(-10_000_000).max(10_000_000),
  eventChainHead: z.string().length(64), eventCount: z.number().int().positive().max(10_000), createdAt: z.string().datetime(),
}).strict()
const sprintPackageSchema = z.object({ format: z.literal('bbd-sprint-v1'), protocolVersion: z.literal(1), card: shareCardSchema, events: z.array(shareEventSchema).min(2).max(10_000), cardHash: z.string().length(64) }).strict()

export class SprintService {
  constructor(private readonly database: AppDatabase, private readonly clock: () => Date = () => new Date()) {}

  start(projectId: string, input: { scope: 'scene' | 'project'; sceneId?: string | null; durationMinutes: number; goalWords: number }): SprintSession {
    if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 10 || input.durationMinutes > 120) throw new Error('Sprint duration must be 10–120 minutes')
    if (!Number.isInteger(input.goalWords) || input.goalWords < 1 || input.goalWords > 50_000) throw new Error('Sprint goal must be 1–50,000 words')
    if (this.database.listSprintSessions(projectId).some((session) => session.status === 'running' || session.status === 'paused')) throw new Error('This project already has an active sprint')
    const sceneId = input.scope === 'scene' ? input.sceneId ?? null : null
    const baseline = this.database.captureSprintSnapshot(projectId, input.scope, sceneId)
    const started = this.clock(); const startedAt = started.toISOString(); const id = newId()
    const session = this.database.transaction(() => {
      this.database.createSprintSession({ id, projectId, scope: input.scope, sceneId, durationMinutes: input.durationMinutes, goalWords: input.goalWords, baseline, startedAt, plannedEndAt: new Date(started.getTime() + input.durationMinutes * 60_000).toISOString() })
      this.database.addSprintSample(sample(id, 'start', startedAt, 0, baseline, baseline))
      this.database.appendSprintEvent({ sessionId: id, type: 'started', occurredAt: startedAt, activeElapsedMs: 0, metadata: {} })
      return this.database.getSprintSession(id)!
    })
    return session
  }

  list(projectId: string) { return this.database.listSprintSessions(projectId) }

  pause(id: string, reason = 'manual'): SprintSession {
    const session = this.requireActive(id, 'running'); const now = this.clock(); const nowAt = now.toISOString(); const elapsed = activeElapsedAt(session, now)
    return this.database.transaction(() => {
      this.database.updateSprintSession(id, { status: 'paused', pausedAt: nowAt, lastReconciledAt: nowAt })
      this.database.appendSprintEvent({ sessionId: id, type: 'paused', occurredAt: nowAt, activeElapsedMs: elapsed, metadata: { reason: safeReason(reason) } })
      this.checkpoint(id, nowAt, elapsed)
      return this.database.getSprintSession(id)!
    })
  }

  resume(id: string): SprintSession {
    const session = this.requireActive(id, 'paused'); const now = this.clock(); const nowAt = now.toISOString(); const pausedAt = Date.parse(session.pausedAt ?? nowAt)
    if (now.getTime() + 2_000 < pausedAt) return this.pauseForClockAnomaly(session, now)
    const totalPausedMs = session.totalPausedMs + Math.max(0, now.getTime() - pausedAt)
    return this.database.transaction(() => {
      this.database.updateSprintSession(id, { status: 'running', pausedAt: null, totalPausedMs, lastReconciledAt: nowAt })
      this.database.appendSprintEvent({ sessionId: id, type: 'resumed', occurredAt: nowAt, activeElapsedMs: activeElapsedAt(session, new Date(pausedAt)), metadata: {} })
      return this.database.getSprintSession(id)!
    })
  }

  reconcile(id: string, input: { sleepDetected?: boolean; lastObservedAt?: string; reason?: string } = {}): SprintSession {
    const session = this.database.getSprintSession(id)
    if (!session || !['running', 'paused'].includes(session.status)) throw new Error('Sprint session is not active')
    const now = this.clock(); const nowAt = now.toISOString(); const lastReconciled = Date.parse(session.lastReconciledAt)
    if (now.getTime() + 2_000 < lastReconciled) return this.pauseForClockAnomaly(session, now)
    if (session.status === 'running' && input.sleepDetected) {
      const observed = input.lastObservedAt ? Date.parse(input.lastObservedAt) : lastReconciled
      const pauseAtMs = Number.isFinite(observed) ? Math.max(lastReconciled, Math.min(now.getTime(), observed)) : lastReconciled
      const pauseAt = new Date(pauseAtMs).toISOString(); const elapsed = activeElapsedAt(session, new Date(pauseAtMs)); const gapMs = Math.max(0, now.getTime() - pauseAtMs)
      return this.database.transaction(() => {
        this.database.updateSprintSession(id, { status: 'paused', pausedAt: pauseAt, clockStatus: 'sleep_reconciled', lastReconciledAt: nowAt })
        this.database.appendSprintEvent({ sessionId: id, type: 'sleep_detected', occurredAt: nowAt, activeElapsedMs: elapsed, metadata: { reason: safeReason(input.reason ?? 'visibility_gap'), gapMs } })
        this.checkpoint(id, nowAt, elapsed)
        return this.database.getSprintSession(id)!
      })
    }
    const elapsed = activeElapsedAt(session, now)
    this.database.updateSprintSession(id, { lastReconciledAt: nowAt })
    this.checkpoint(id, nowAt, elapsed)
    return this.database.getSprintSession(id)!
  }

  complete(id: string, participantLabel = '匿名作者'): SprintSession {
    const session = this.database.getSprintSession(id)
    if (!session || !['running', 'paused'].includes(session.status)) throw new Error('Sprint session is not active')
    const now = this.clock(); const endedAt = now.toISOString(); const activeDurationMs = activeElapsedAt(session, now)
    const baseline = this.database.getSprintBaseline(id); const current = this.database.captureSprintSnapshot(session.projectId, session.scope, session.sceneId)
    const netWords = totalWords(current) - totalWords(baseline)
    return this.database.transaction(() => {
      this.database.updateSprintSession(id, { status: 'completed', pausedAt: null, endedAt, lastReconciledAt: endedAt })
      this.database.addSprintSample(sample(id, 'end', endedAt, activeDurationMs, baseline, current))
      const completed = this.database.appendSprintEvent({ sessionId: id, type: 'completed', occurredAt: endedAt, activeElapsedMs: activeDurationMs, metadata: {} })
      const eventCount = this.database.getSprintSession(id)!.events.length
      const card: SprintResultCard = {
        id: newId(), sessionId: id, projectId: session.projectId, participantLabel: normalizeLabel(participantLabel), scope: session.scope,
        projectFingerprint: sha256(`bbd-sprint-v1:project:${session.projectId}`), scopeFingerprint: sha256(`bbd-sprint-v1:scope:${session.projectId}:${session.scope}:${session.sceneId ?? 'all'}`),
        startedAt: session.startedAt, endedAt, activeDurationMs, goalWords: session.goalWords, netWords, eventChainHead: completed.eventHash, eventCount, createdAt: endedAt,
      }
      this.database.createSprintResultCard(card)
      return this.database.getSprintSession(id)!
    })
  }

  cancel(id: string): SprintSession {
    const session = this.database.getSprintSession(id)
    if (!session || !['running', 'paused'].includes(session.status)) throw new Error('Sprint session is not active')
    const now = this.clock(); const endedAt = now.toISOString(); const elapsed = activeElapsedAt(session, now)
    return this.database.transaction(() => {
      this.database.updateSprintSession(id, { status: 'cancelled', pausedAt: null, endedAt, lastReconciledAt: endedAt })
      this.database.appendSprintEvent({ sessionId: id, type: 'cancelled', occurredAt: endedAt, activeElapsedMs: elapsed, metadata: {} })
      return this.database.getSprintSession(id)!
    })
  }

  exportCard(cardId: string): SprintPackage {
    const result = this.database.getSprintResultCard(cardId)
    if (!result) throw new Error('Sprint result card not found')
    const session = this.database.getSprintSession(result.sessionId)
    if (!session || session.status !== 'completed') throw new Error('Sprint result is not complete')
    const { sessionId: _sessionId, projectId: _projectId, ...card } = result
    const events = session.events.map(({ sessionId: _ignored, ...event }) => event)
    const cardHash = sha256(JSON.stringify({ card, events }))
    return { format: 'bbd-sprint-v1', protocolVersion: 1, card, events, cardHash }
  }

  inspect(value: unknown): SprintPackageInspection {
    const sprintPackage = verifySprintPackage(value)
    const { card } = sprintPackage
    return { valid: true, cardId: card.id, participantLabel: card.participantLabel, scope: card.scope, startedAt: card.startedAt, endedAt: card.endedAt, activeDurationMs: card.activeDurationMs, goalWords: card.goalWords, netWords: card.netWords, eventCount: card.eventCount }
  }

  createBoard(projectId: string, input: { name: string; period: 'day' | 'week'; targetWords: number; periodStartedAt: string }): SprintBoard {
    if (!input.name.trim() || input.name.trim().length > 80) throw new Error('Sprint board name must be 1–80 characters')
    if (!Number.isInteger(input.targetWords) || input.targetWords < 1 || input.targetWords > 10_000_000) throw new Error('Sprint board goal is invalid')
    const start = new Date(input.periodStartedAt)
    if (!Number.isFinite(start.getTime())) throw new Error('Sprint board period is invalid')
    return this.database.createSprintBoard({ projectId, name: input.name, period: input.period, targetWords: input.targetWords, periodStartedAt: start.toISOString() })
  }

  listBoards(projectId: string) { return this.database.listSprintBoards(projectId) }

  importToBoard(boardId: string, value: unknown) {
    const sprintPackage = verifySprintPackage(value); const board = this.database.getSprintBoard(boardId)
    if (!board) throw new Error('Sprint board not found')
    const ended = Date.parse(sprintPackage.card.endedAt); const start = Date.parse(board.periodStartedAt); const end = start + (board.period === 'day' ? 86_400_000 : 604_800_000)
    if (ended < start || ended >= end) throw new Error('Sprint card is outside this board period')
    return this.database.addSprintBoardCard(boardId, sprintPackage, this.clock().toISOString())
  }

  addLocalCard(boardId: string, cardId: string) { return this.importToBoard(boardId, this.exportCard(cardId)) }

  private requireActive(id: string, status: 'running' | 'paused') {
    const session = this.database.getSprintSession(id)
    if (!session || session.status !== status) throw new Error(`Sprint session is not ${status}`)
    return session
  }

  private pauseForClockAnomaly(session: SprintSession, now: Date): SprintSession {
    const occurredAt = now.toISOString(); const elapsed = Math.max(0, session.activeElapsedMs)
    return this.database.transaction(() => {
      this.database.updateSprintSession(session.id, { status: 'paused', pausedAt: occurredAt, clockStatus: 'clock_anomaly', lastReconciledAt: occurredAt })
      this.database.appendSprintEvent({ sessionId: session.id, type: 'clock_anomaly', occurredAt, activeElapsedMs: elapsed, metadata: { reason: 'server_clock_moved_back' } })
      return this.database.getSprintSession(session.id)!
    })
  }

  private checkpoint(id: string, capturedAt: string, activeElapsedMs: number) {
    const session = this.database.getSprintSession(id)!
    const baseline = this.database.getSprintBaseline(id); const current = this.database.captureSprintSnapshot(session.projectId, session.scope, session.sceneId)
    this.database.addSprintSample(sample(id, 'checkpoint', capturedAt, activeElapsedMs, baseline, current))
  }
}

export function verifySprintPackage(value: unknown): SprintPackage {
  const sprintPackage = sprintPackageSchema.parse(value) as SprintPackage
  let previousHash: string | null = null
  for (const event of sprintPackage.events) {
    if (event.previousHash !== previousHash || sprintEventHash(event) !== event.eventHash) throw new Error('Sprint event chain is invalid')
    previousHash = event.eventHash
  }
  if (sprintPackage.card.eventCount !== sprintPackage.events.length || sprintPackage.card.eventChainHead !== previousHash) throw new Error('Sprint event summary does not match the chain')
  if (Date.parse(sprintPackage.card.endedAt) < Date.parse(sprintPackage.card.startedAt)) throw new Error('Sprint result time range is invalid')
  if (sha256(JSON.stringify({ card: sprintPackage.card, events: sprintPackage.events })) !== sprintPackage.cardHash) throw new Error('Sprint result card was tampered with')
  return sprintPackage
}

function sample(sessionId: string, kind: 'start' | 'checkpoint' | 'end', capturedAt: string, activeElapsedMs: number, baseline: SprintSnapshotScene[], scenes: SprintSnapshotScene[]) {
  const words = totalWords(scenes)
  return { sessionId, kind, capturedAt, activeElapsedMs: Math.max(0, Math.round(activeElapsedMs)), totalWords: words, netWords: words - totalWords(baseline), scenes }
}

function totalWords(scenes: SprintSnapshotScene[]) { return scenes.reduce((sum, scene) => sum + scene.wordCount, 0) }

function activeElapsedAt(session: SprintSession, at: Date) {
  const end = at.getTime(); const start = Date.parse(session.startedAt); const pausedAt = session.pausedAt ? Date.parse(session.pausedAt) : null
  const openPause = session.status === 'paused' && pausedAt !== null ? Math.max(0, end - pausedAt) : 0
  return Math.max(0, end - start - session.totalPausedMs - openPause)
}

function normalizeLabel(value: string) { return value.trim().slice(0, 40) || '匿名作者' }
function safeReason(value: string) { return value.trim().slice(0, 80) || 'manual' }
