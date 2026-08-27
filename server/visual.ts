import type {
  Storyboard,
  StoryboardCard,
  VisualAnchor,
  VisualAsset,
  VisualCandidate,
  VisualCanonSnapshot,
  VisualSelectedField,
} from '../shared/types.js'
import { AppDatabase } from './db.js'
import { jsonParse, newId, nowIso, sha256 } from './utils.js'

type Row = Record<string, unknown>

export type VisualBackupBundle = {
  assets: Array<Omit<VisualAsset, 'url'> & { contentBase64: string }>
  anchors: Array<Omit<VisualAnchor, 'acceptedAsset' | 'candidates' | 'currentCanonHash' | 'bindingStatus' | 'entityName' | 'entityType'>>
  candidates: Array<Omit<VisualCandidate, 'asset'> & { assetHash: string }>
  storyboards: Storyboard[]
  events: Row[]
}

export class VisualService {
  constructor(private readonly database: AppDatabase) {}

  listAnchors(projectId: string): VisualAnchor[] {
    if (!this.database.getProject(projectId)) throw new Error('Project not found')
    return (this.database.db.prepare('SELECT * FROM visual_anchors WHERE project_id=? AND deleted_at IS NULL ORDER BY updated_at DESC,rowid DESC').all(projectId) as Row[]).map((row) => this.mapAnchor(row))
  }

  getAnchor(id: string): VisualAnchor | null {
    const row = this.database.db.prepare('SELECT * FROM visual_anchors WHERE id=? AND deleted_at IS NULL').get(id) as Row | undefined
    return row ? this.mapAnchor(row) : null
  }

  createAnchor(projectId: string, entityId: string, selectedFields: VisualSelectedField[], styleNote = ''): VisualAnchor {
    if (!this.database.getProject(projectId)) throw new Error('Project not found')
    if (this.database.db.prepare('SELECT 1 FROM visual_anchors WHERE project_id=? AND entity_id=? AND deleted_at IS NULL').get(projectId, entityId)) throw new Error('Visual anchor already exists for this canon entity')
    const prepared = this.prepareCanon(projectId, entityId, selectedFields, styleNote)
    const id = newId(); const createdAt = nowIso()
    this.database.transaction(() => {
      this.database.db.prepare(`INSERT INTO visual_anchors(id,project_id,entity_id,selected_fields_json,style_note,visual_description,canon_snapshot_json,canon_hash,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, projectId, entityId, JSON.stringify(prepared.snapshot.selectedFields), styleNote.trim(), prepared.description, JSON.stringify(prepared.snapshot), prepared.canonHash, createdAt, createdAt)
      this.recordEvent(projectId, 'anchor_created', { anchorId: id, canonHash: prepared.canonHash, selectedFields: prepared.snapshot.selectedFields }, { anchorId: id }, createdAt)
      this.database.recordProvenanceEvent({ projectId, eventType: 'visual_anchor_created', actorType: 'human', contentHash: prepared.canonHash, metadata: { anchorId: id, entityId, selectedFields: prepared.snapshot.selectedFields }, createdAt })
    })
    return this.getAnchor(id)!
  }

  refreshAnchor(id: string, selectedFields?: VisualSelectedField[], styleNote?: string): VisualAnchor {
    const current = this.requireAnchor(id)
    const fields = selectedFields ?? current.selectedFields
    const note = styleNote ?? current.styleNote
    const prepared = this.prepareCanon(current.projectId, current.entityId, fields, note)
    const updatedAt = nowIso()
    this.database.transaction(() => {
      this.database.db.prepare(`UPDATE visual_anchors SET selected_fields_json=?,style_note=?,visual_description=?,canon_snapshot_json=?,canon_hash=?,updated_at=? WHERE id=?`).run(
        JSON.stringify(prepared.snapshot.selectedFields), note.trim(), prepared.description, JSON.stringify(prepared.snapshot), prepared.canonHash, updatedAt, id,
      )
      this.recordEvent(current.projectId, 'anchor_refreshed', { anchorId: id, previousCanonHash: current.canonHash, canonHash: prepared.canonHash }, { anchorId: id }, updatedAt)
      this.database.recordProvenanceEvent({ projectId: current.projectId, eventType: 'visual_anchor_refreshed', actorType: 'human', contentHash: prepared.canonHash, metadata: { anchorId: id, previousCanonHash: current.canonHash }, createdAt: updatedAt })
    })
    return this.getAnchor(id)!
  }

  importCandidate(anchorId: string, input: { fileName: string; mimeType: string; contentBase64: string; sourceLabel?: string }): VisualCandidate {
    const anchor = this.requireAnchor(anchorId)
    const bytes = decodeImage(input.contentBase64)
    const image = inspectImage(bytes, input.mimeType)
    const contentHash = sha256(bytes)
    const existing = this.database.db.prepare('SELECT id FROM visual_candidates WHERE anchor_id=? AND asset_hash=? AND canon_hash=?').get(anchorId, contentHash, anchor.canonHash) as Row | undefined
    if (existing) return this.requireCandidate(String(existing.id))
    const id = newId(); const createdAt = nowIso(); const sourceLabel = (input.sourceLabel || '作者本地导入').trim().slice(0, 120)
    this.database.transaction(() => {
      const asset = this.database.db.prepare('SELECT mime_type,byte_size,width,height,content_blob FROM visual_assets WHERE content_hash=?').get(contentHash) as Row | undefined
      if (asset) {
        if (String(asset.mime_type) !== image.mimeType || Number(asset.byte_size) !== bytes.length || Number(asset.width) !== image.width || Number(asset.height) !== image.height || !Buffer.from(asset.content_blob as Uint8Array).equals(bytes)) throw new Error('Visual asset hash collision')
      } else {
        this.database.db.prepare('INSERT INTO visual_assets(content_hash,mime_type,byte_size,width,height,content_blob,created_at) VALUES(?,?,?,?,?,?,?)').run(contentHash, image.mimeType, bytes.length, image.width, image.height, bytes, createdAt)
      }
      this.database.db.prepare(`INSERT INTO visual_candidates(id,project_id,anchor_id,asset_hash,source_kind,source_label,file_name,description_snapshot,canon_hash,status,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,'pending',?)`).run(id, anchor.projectId, anchorId, contentHash, 'import', sourceLabel, safeFileName(input.fileName), anchor.visualDescription, anchor.canonHash, createdAt)
      this.recordEvent(anchor.projectId, 'candidate_imported', { anchorId, candidateId: id, contentHash, sourceKind: 'import' }, { anchorId, candidateId: id }, createdAt)
      this.database.recordProvenanceEvent({ projectId: anchor.projectId, eventType: 'visual_candidate_imported', actorType: 'human', contentHash, metadata: { anchorId, candidateId: id, sourceKind: 'import', canonHash: anchor.canonHash }, createdAt })
    })
    return this.requireCandidate(id)
  }

  resolveCandidate(id: string, decision: 'accepted' | 'rejected'): VisualCandidate {
    const candidate = this.requireCandidate(id)
    if (candidate.status !== 'pending') throw new Error('Visual candidate already resolved')
    const anchor = this.requireAnchor(candidate.anchorId)
    if (decision === 'accepted' && anchor.currentCanonHash !== candidate.canonHash) throw new Error('Canon changed; refresh the visual anchor before accepting this candidate')
    const resolvedAt = nowIso()
    this.database.transaction(() => {
      if (decision === 'accepted') {
        this.database.db.prepare("UPDATE visual_candidates SET status='superseded',resolved_at=? WHERE anchor_id=? AND status='accepted'").run(resolvedAt, anchor.id)
        this.database.db.prepare("UPDATE visual_candidates SET status='accepted',resolved_at=? WHERE id=?").run(resolvedAt, id)
        this.database.db.prepare('UPDATE visual_anchors SET accepted_candidate_id=?,accepted_asset_hash=?,updated_at=? WHERE id=?').run(id, candidate.asset.contentHash, resolvedAt, anchor.id)
      } else this.database.db.prepare("UPDATE visual_candidates SET status='rejected',resolved_at=? WHERE id=?").run(resolvedAt, id)
      const eventType = decision === 'accepted' ? 'candidate_accepted' : 'candidate_rejected'
      this.recordEvent(anchor.projectId, eventType, { anchorId: anchor.id, candidateId: id, contentHash: candidate.asset.contentHash, canonHash: candidate.canonHash }, { anchorId: anchor.id, candidateId: id }, resolvedAt)
      this.database.recordProvenanceEvent({ projectId: anchor.projectId, eventType: decision === 'accepted' ? 'visual_candidate_accepted' : 'visual_candidate_rejected', actorType: 'human', contentHash: candidate.asset.contentHash, metadata: { anchorId: anchor.id, candidateId: id, canonHash: candidate.canonHash }, createdAt: resolvedAt })
    })
    return this.requireCandidate(id)
  }

  getAsset(contentHash: string): { asset: VisualAsset; bytes: Buffer } | null {
    const row = this.database.db.prepare('SELECT * FROM visual_assets WHERE content_hash=?').get(contentHash) as Row | undefined
    return row ? { asset: mapAsset(row), bytes: Buffer.from(row.content_blob as Uint8Array) } : null
  }

  listStoryboards(projectId: string): Storyboard[] {
    if (!this.database.getProject(projectId)) throw new Error('Project not found')
    return (this.database.db.prepare('SELECT * FROM storyboards WHERE project_id=? ORDER BY updated_at DESC,rowid DESC').all(projectId) as Row[]).map((row) => this.mapStoryboard(row))
  }

  getOrCreateStoryboard(projectId: string, sceneId: string, title?: string): Storyboard {
    const project = this.database.getProject(projectId); const scene = this.database.getNode(sceneId)
    if (!project) throw new Error('Project not found')
    if (!scene || scene.projectId !== projectId || scene.type !== 'scene' || scene.deletedAt) throw new Error('Storyboard scene not found')
    const existing = this.database.db.prepare('SELECT * FROM storyboards WHERE project_id=? AND scene_id=?').get(projectId, sceneId) as Row | undefined
    if (existing) return this.mapStoryboard(existing)
    const id = newId(); const createdAt = nowIso(); const boardTitle = (title?.trim() || `${scene.title} · 故事板`).slice(0, 160)
    this.database.transaction(() => {
      this.database.db.prepare('INSERT INTO storyboards(id,project_id,scene_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, projectId, sceneId, boardTitle, createdAt, createdAt)
      this.recordEvent(projectId, 'storyboard_created', { storyboardId: id, sceneId }, { storyboardId: id }, createdAt)
      this.database.recordProvenanceEvent({ projectId, nodeId: sceneId, eventType: 'storyboard_updated', actorType: 'human', contentHash: sha256(stableStringify({ title: boardTitle, cards: [] })), metadata: { storyboardId: id, action: 'created', excludesSceneText: true }, createdAt })
    })
    return this.listStoryboards(projectId).find((board) => board.id === id)!
  }

  addStoryboardCard(storyboardId: string, input: { purpose: string; note?: string; anchorIds?: string[]; assetHash?: string | null; visualDescription?: string }): StoryboardCard {
    const board = this.requireStoryboard(storyboardId)
    const anchors = unique(input.anchorIds ?? []).map((id) => this.requireAnchor(id))
    if (anchors.some((anchor) => anchor.projectId !== board.projectId)) throw new Error('Storyboard anchor belongs to another project')
    const acceptedHashes = new Set(anchors.map((anchor) => anchor.acceptedAsset?.contentHash).filter((hash): hash is string => Boolean(hash)))
    const assetHash = input.assetHash ?? anchors.find((anchor) => anchor.acceptedAsset)?.acceptedAsset?.contentHash ?? null
    if (assetHash && !acceptedHashes.has(assetHash)) throw new Error('Storyboard assets must be accepted by one of the selected visual anchors')
    const purpose = input.purpose.trim(); if (!purpose || purpose.length > 160) throw new Error('Storyboard purpose must be 1–160 characters')
    const description = (input.visualDescription?.trim() || anchors.map((anchor) => anchor.visualDescription).join('\n')).slice(0, 4000)
    const id = newId(); const createdAt = nowIso()
    const position = Number((this.database.db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS position FROM storyboard_cards WHERE storyboard_id=?').get(storyboardId) as Row).position)
    const bindings = anchors.map((anchor) => ({ anchorId: anchor.id, canonHash: anchor.canonHash }))
    this.database.transaction(() => {
      this.database.db.prepare(`INSERT INTO storyboard_cards(id,storyboard_id,position,purpose,note,anchor_ids_json,asset_hash,visual_description,canon_bindings_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, storyboardId, position, purpose, (input.note ?? '').trim().slice(0, 2000), JSON.stringify(anchors.map((anchor) => anchor.id)), assetHash, description, JSON.stringify(bindings), createdAt, createdAt)
      this.touchStoryboard(board, 'card_added', id, createdAt)
    })
    return this.getCard(id)!
  }

  moveStoryboardCard(id: string, direction: 'up' | 'down'): StoryboardCard {
    const card = this.getCard(id); if (!card) throw new Error('Storyboard card not found')
    const board = this.requireStoryboard(card.storyboardId)
    const cards = board.cards
    const index = cards.findIndex((item) => item.id === id); const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= cards.length) return card
    const updatedAt = nowIso()
    this.database.transaction(() => {
      this.database.db.prepare('UPDATE storyboard_cards SET position=?,updated_at=? WHERE id=?').run(cards[target].position, updatedAt, card.id)
      this.database.db.prepare('UPDATE storyboard_cards SET position=?,updated_at=? WHERE id=?').run(card.position, updatedAt, cards[target].id)
      this.touchStoryboard(board, 'card_moved', id, updatedAt)
    })
    return this.getCard(id)!
  }

  deleteStoryboardCard(id: string): Storyboard {
    const card = this.getCard(id); if (!card) throw new Error('Storyboard card not found')
    const board = this.requireStoryboard(card.storyboardId); const createdAt = nowIso()
    this.database.transaction(() => {
      this.database.db.prepare('DELETE FROM storyboard_cards WHERE id=?').run(id)
      const remaining = this.database.db.prepare('SELECT id FROM storyboard_cards WHERE storyboard_id=? ORDER BY position,created_at,rowid').all(board.id) as Row[]
      remaining.forEach((row, position) => this.database.db.prepare('UPDATE storyboard_cards SET position=?,updated_at=? WHERE id=?').run(position, createdAt, String(row.id)))
      this.touchStoryboard(board, 'card_deleted', id, createdAt)
    })
    return this.requireStoryboard(board.id)
  }

  exportProjectBundle(projectId: string): VisualBackupBundle {
    const anchors = this.listAnchors(projectId)
    const storyboards = this.listStoryboards(projectId)
    const assetHashes = unique([
      ...anchors.flatMap((anchor) => anchor.candidates.map((candidate) => candidate.asset.contentHash)),
      ...storyboards.flatMap((board) => board.cards.map((card) => card.asset?.contentHash).filter(Boolean) as string[]),
    ])
    const assets = assetHashes.map((hash) => {
      const result = this.getAsset(hash)!; const { url: _url, ...asset } = result.asset
      return { ...asset, contentBase64: result.bytes.toString('base64') }
    })
    return {
      assets,
      anchors: anchors.map(({ acceptedAsset: _asset, candidates: _candidates, currentCanonHash: _current, bindingStatus: _status, entityName: _name, entityType: _type, ...anchor }) => anchor),
      candidates: anchors.flatMap((anchor) => anchor.candidates.map(({ asset, ...candidate }) => ({ ...candidate, assetHash: asset.contentHash }))),
      storyboards,
      events: this.database.db.prepare('SELECT * FROM visual_events WHERE project_id=? ORDER BY created_at,rowid').all(projectId) as Row[],
    }
  }

  importProjectBundle(projectId: string, input: VisualBackupBundle, maps: { entities: Map<string, string>; nodes: Map<string, string> }) {
    const anchorMap = new Map<string, string>(); const candidateMap = new Map<string, string>(); const storyboardMap = new Map<string, string>()
    this.database.transaction(() => {
      for (const asset of input.assets ?? []) {
        const bytes = decodeImage(asset.contentBase64); const inspected = inspectImage(bytes, asset.mimeType); const hash = sha256(bytes)
        if (hash !== asset.contentHash || bytes.length !== asset.byteSize || inspected.width !== asset.width || inspected.height !== asset.height) throw new Error('Backup visual asset integrity check failed')
        const existing = this.getAsset(hash)
        if (existing && !existing.bytes.equals(bytes)) throw new Error('Visual asset hash collision')
        if (!existing) this.database.db.prepare('INSERT INTO visual_assets(content_hash,mime_type,byte_size,width,height,content_blob,created_at) VALUES(?,?,?,?,?,?,?)').run(hash, inspected.mimeType, bytes.length, inspected.width, inspected.height, bytes, asset.createdAt)
      }
      for (const source of input.anchors ?? []) {
        const entityId = maps.entities.get(source.entityId); if (!entityId) throw new Error('Backup visual anchor entity is missing')
        const prepared = this.prepareCanon(projectId, entityId, source.selectedFields, source.styleNote)
        if (prepared.canonHash !== source.canonHash) throw new Error('Backup visual anchor no longer matches restored canon')
        const id = newId(); anchorMap.set(source.id, id)
        const snapshot = { ...source.canonSnapshot, entityId, entityUpdatedAt: this.database.getEntity(entityId)!.updatedAt }
        this.database.db.prepare(`INSERT INTO visual_anchors(id,project_id,entity_id,selected_fields_json,style_note,visual_description,canon_snapshot_json,canon_hash,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, projectId, entityId, JSON.stringify(source.selectedFields), source.styleNote, source.visualDescription, JSON.stringify(snapshot), source.canonHash, source.createdAt, source.updatedAt)
      }
      for (const source of input.candidates ?? []) {
        const anchorId = anchorMap.get(source.anchorId); if (!anchorId || !this.getAsset(source.assetHash)) throw new Error('Backup visual candidate reference is missing')
        const id = newId(); candidateMap.set(source.id, id)
        this.database.db.prepare(`INSERT INTO visual_candidates(id,project_id,anchor_id,asset_hash,source_kind,source_label,file_name,description_snapshot,canon_hash,status,created_at,resolved_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, projectId, anchorId, source.assetHash, source.sourceKind, source.sourceLabel, source.fileName, source.descriptionSnapshot, source.canonHash, source.status, source.createdAt, source.resolvedAt)
      }
      for (const source of input.anchors ?? []) {
        const id = anchorMap.get(source.id)!; const acceptedCandidateId = source.acceptedCandidateId ? candidateMap.get(source.acceptedCandidateId) ?? null : null
        this.database.db.prepare('UPDATE visual_anchors SET accepted_candidate_id=?,accepted_asset_hash=? WHERE id=?').run(acceptedCandidateId, source.acceptedCandidateId ? input.candidates.find((candidate) => candidate.id === source.acceptedCandidateId)?.assetHash ?? null : null, id)
      }
      for (const source of input.storyboards ?? []) {
        const sceneId = maps.nodes.get(source.sceneId); if (!sceneId) continue
        const id = newId(); storyboardMap.set(source.id, id)
        this.database.db.prepare('INSERT INTO storyboards(id,project_id,scene_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, projectId, sceneId, source.title, source.createdAt, source.updatedAt)
        for (const card of source.cards ?? []) {
          const anchorIds = card.anchorIds.map((anchorId) => anchorMap.get(anchorId)).filter(Boolean) as string[]
          const bindings = card.canonBindings.map((binding) => ({ anchorId: anchorMap.get(binding.anchorId), canonHash: binding.canonHash })).filter((binding) => binding.anchorId)
          this.database.db.prepare(`INSERT INTO storyboard_cards(id,storyboard_id,position,purpose,note,anchor_ids_json,asset_hash,visual_description,canon_bindings_json,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(newId(), id, card.position, card.purpose, card.note, JSON.stringify(anchorIds), card.asset?.contentHash ?? null, card.visualDescription, JSON.stringify(bindings), card.createdAt, card.updatedAt)
        }
      }
      for (const event of input.events ?? []) this.database.db.prepare('INSERT INTO visual_events(id,project_id,anchor_id,candidate_id,storyboard_id,event_type,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(
        newId(), projectId, event.anchor_id ? anchorMap.get(String(event.anchor_id)) ?? null : null, event.candidate_id ? candidateMap.get(String(event.candidate_id)) ?? null : null, event.storyboard_id ? storyboardMap.get(String(event.storyboard_id)) ?? null : null, String(event.event_type), String(event.metadata_json), String(event.created_at),
      )
    })
  }

  cleanupOrphanAssets() {
    this.database.db.exec(`DELETE FROM visual_assets WHERE content_hash NOT IN (SELECT asset_hash FROM visual_candidates) AND content_hash NOT IN (SELECT asset_hash FROM storyboard_cards WHERE asset_hash IS NOT NULL)`)
  }

  private prepareCanon(projectId: string, entityId: string, selectedFields: VisualSelectedField[], styleNote: string) {
    const entity = this.database.getEntity(entityId)
    if (!entity || entity.projectId !== projectId || entity.deletedAt) throw new Error('Canon entity not found')
    if (!['character', 'location', 'item'].includes(entity.type)) throw new Error('Visual anchors support characters, locations and items')
    if (entity.privacyLevel === 'local_private') throw new Error('local_private canon cannot be read by visual anchors')
    const fields = unique(selectedFields)
    if (!fields.includes('canonicalName')) throw new Error('Visual anchors must explicitly include canonicalName')
    if (fields.length > 20) throw new Error('Too many selected canon fields')
    const values: Record<string, unknown> = {}
    for (const field of fields) {
      if (field === 'canonicalName') values[field] = entity.canonicalName
      else if (field === 'summary') values[field] = entity.summary
      else if (field === 'aliases') values[field] = entity.aliases
      else if (field.startsWith('state:')) {
        const stateId = field.slice(6); const state = this.database.getState(stateId)
        if (!state || state.entityId !== entityId) throw new Error(`Selected canon state is invalid: ${stateId}`)
        values[field] = { attributeKey: state.attributeKey, value: state.value, worldTimeFrom: state.worldTimeFrom, worldTimeTo: state.worldTimeTo }
      } else throw new Error(`Unsupported visual canon field: ${field}`)
    }
    const snapshot: VisualCanonSnapshot = { entityId, entityType: entity.type as VisualCanonSnapshot['entityType'], entityUpdatedAt: entity.updatedAt, selectedFields: fields, values }
    const canonHash = canonHashFor(snapshot)
    return { snapshot, canonHash, description: buildDescription(snapshot, styleNote) }
  }

  private mapAnchor(row: Row): VisualAnchor {
    const entity = this.database.getEntity(String(row.entity_id))
    if (!entity) throw new Error('Visual anchor canon entity is missing')
    const selectedFields = jsonParse<VisualSelectedField[]>(String(row.selected_fields_json), [])
    const snapshot = jsonParse<VisualCanonSnapshot>(String(row.canon_snapshot_json), {} as VisualCanonSnapshot)
    let currentCanonHash = ''
    try { currentCanonHash = this.prepareCanon(String(row.project_id), String(row.entity_id), selectedFields, String(row.style_note)).canonHash } catch { currentCanonHash = 'unavailable' }
    const acceptedAsset = row.accepted_asset_hash ? this.getAsset(String(row.accepted_asset_hash))?.asset ?? null : null
    const candidates = (this.database.db.prepare('SELECT * FROM visual_candidates WHERE anchor_id=? ORDER BY created_at DESC,rowid DESC').all(String(row.id)) as Row[]).map((candidate) => this.mapCandidate(candidate))
    const acceptedCandidate = candidates.find((candidate) => candidate.id === (row.accepted_candidate_id ? String(row.accepted_candidate_id) : ''))
    const bindingStatus = !acceptedAsset ? 'unbound' : acceptedCandidate?.canonHash === currentCanonHash ? 'current' : 'stale'
    return { id: String(row.id), projectId: String(row.project_id), entityId: String(row.entity_id), entityName: entity.canonicalName, entityType: entity.type as VisualAnchor['entityType'], selectedFields, styleNote: String(row.style_note), visualDescription: String(row.visual_description), canonSnapshot: snapshot, canonHash: String(row.canon_hash), currentCanonHash, bindingStatus, acceptedCandidateId: row.accepted_candidate_id ? String(row.accepted_candidate_id) : null, acceptedAsset, candidates, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
  }

  private mapCandidate(row: Row): VisualCandidate {
    const asset = this.getAsset(String(row.asset_hash))?.asset
    if (!asset) throw new Error('Visual candidate asset is missing')
    return { id: String(row.id), projectId: String(row.project_id), anchorId: String(row.anchor_id), asset, sourceKind: 'import', sourceLabel: String(row.source_label), fileName: String(row.file_name), descriptionSnapshot: String(row.description_snapshot), canonHash: String(row.canon_hash), status: row.status as VisualCandidate['status'], createdAt: String(row.created_at), resolvedAt: row.resolved_at ? String(row.resolved_at) : null }
  }

  private mapStoryboard(row: Row): Storyboard {
    const scene = this.database.getNode(String(row.scene_id))
    const cards = (this.database.db.prepare('SELECT * FROM storyboard_cards WHERE storyboard_id=? ORDER BY position,created_at,rowid').all(String(row.id)) as Row[]).map((card) => mapCard(card, this.getAsset(card.asset_hash ? String(card.asset_hash) : '')?.asset ?? null))
    return { id: String(row.id), projectId: String(row.project_id), sceneId: String(row.scene_id), sceneTitle: scene?.title ?? '已删除场景', title: String(row.title), cards, createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
  }

  private getCard(id: string): StoryboardCard | null {
    const row = this.database.db.prepare('SELECT * FROM storyboard_cards WHERE id=?').get(id) as Row | undefined
    return row ? mapCard(row, this.getAsset(row.asset_hash ? String(row.asset_hash) : '')?.asset ?? null) : null
  }

  private requireAnchor(id: string) { const value = this.getAnchor(id); if (!value) throw new Error('Visual anchor not found'); return value }
  private requireCandidate(id: string) { const row = this.database.db.prepare('SELECT * FROM visual_candidates WHERE id=?').get(id) as Row | undefined; if (!row) throw new Error('Visual candidate not found'); return this.mapCandidate(row) }
  private requireStoryboard(id: string) { const row = this.database.db.prepare('SELECT * FROM storyboards WHERE id=?').get(id) as Row | undefined; if (!row) throw new Error('Storyboard not found'); return this.mapStoryboard(row) }

  private touchStoryboard(board: Storyboard, action: string, cardId: string, createdAt: string) {
    this.database.db.prepare('UPDATE storyboards SET updated_at=? WHERE id=?').run(createdAt, board.id)
    const contentHash = sha256(stableStringify({ storyboardId: board.id, action, cardId, createdAt }))
    this.recordEvent(board.projectId, 'storyboard_updated', { storyboardId: board.id, sceneId: board.sceneId, action, cardId }, { storyboardId: board.id }, createdAt)
    this.database.recordProvenanceEvent({ projectId: board.projectId, nodeId: board.sceneId, eventType: 'storyboard_updated', actorType: 'human', contentHash, metadata: { storyboardId: board.id, action, cardId, excludesSceneText: true }, createdAt })
  }

  private recordEvent(projectId: string, eventType: string, metadata: Record<string, unknown>, refs: { anchorId?: string; candidateId?: string; storyboardId?: string }, createdAt: string) {
    this.database.db.prepare('INSERT INTO visual_events(id,project_id,anchor_id,candidate_id,storyboard_id,event_type,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(newId(), projectId, refs.anchorId ?? null, refs.candidateId ?? null, refs.storyboardId ?? null, eventType, JSON.stringify(metadata), createdAt)
  }
}

function mapAsset(row: Row): VisualAsset {
  const contentHash = String(row.content_hash)
  return { contentHash, mimeType: row.mime_type as VisualAsset['mimeType'], byteSize: Number(row.byte_size), width: Number(row.width), height: Number(row.height), createdAt: String(row.created_at), url: `/api/visual-assets/${contentHash}/content` }
}

function mapCard(row: Row, asset: VisualAsset | null): StoryboardCard {
  return { id: String(row.id), storyboardId: String(row.storyboard_id), position: Number(row.position), purpose: String(row.purpose), note: String(row.note), anchorIds: jsonParse(String(row.anchor_ids_json), []), asset, visualDescription: String(row.visual_description), canonBindings: jsonParse(String(row.canon_bindings_json), []), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
}

function canonHashFor(snapshot: VisualCanonSnapshot) {
  return sha256(stableStringify({ entityType: snapshot.entityType, selectedFields: snapshot.selectedFields, values: snapshot.values }))
}

function buildDescription(snapshot: VisualCanonSnapshot, styleNote: string) {
  const kind = ({ character: '人物', location: '地点', item: '物品' } as const)[snapshot.entityType]
  const parts = [`${kind}：${cleanSegment(snapshot.values.canonicalName)}`]
  if ('summary' in snapshot.values && snapshot.values.summary) parts.push(`已确认简介：${cleanSegment(snapshot.values.summary)}`)
  if (Array.isArray(snapshot.values.aliases) && snapshot.values.aliases.length) parts.push(`别名参考：${snapshot.values.aliases.join('、')}`)
  for (const field of snapshot.selectedFields.filter((value) => value.startsWith('state:'))) {
    const state = snapshot.values[field] as { attributeKey?: string; value?: unknown } | undefined
    if (state) parts.push(`${state.attributeKey ?? '状态'}：${typeof state.value === 'string' ? state.value : stableStringify(state.value)}`)
  }
  if (styleNote.trim()) parts.push(`作者视觉要求：${cleanSegment(styleNote)}`)
  return parts.join('。').slice(0, 4000)
}

function decodeImage(contentBase64: string) {
  if (!contentBase64 || contentBase64.length > 14_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) throw new Error('Invalid image payload')
  const bytes = Buffer.from(contentBase64, 'base64')
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('Image must be 1 byte–10 MiB')
  if (bytes.toString('base64').replace(/=+$/, '') !== contentBase64.replace(/=+$/, '')) throw new Error('Invalid image base64')
  return bytes
}

function inspectImage(bytes: Buffer, declaredMime: string): { mimeType: VisualAsset['mimeType']; width: number; height: number } {
  let mimeType: VisualAsset['mimeType']; let width = 0; let height = 0
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    mimeType = 'image/png'; width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20)
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    mimeType = 'image/jpeg'; ({ width, height } = jpegDimensions(bytes))
  } else throw new Error('Only real PNG and JPEG images are accepted')
  if (declaredMime !== mimeType) throw new Error('Declared image type does not match file content')
  if (!width || !height || width > 20000 || height > 20000 || width * height > 100_000_000) throw new Error('Image dimensions are invalid or too large')
  return { mimeType, width, height }
}

function jpegDimensions(bytes: Buffer) {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue }
    const marker = bytes[offset + 1]; offset += 2
    if (marker === 0xd8 || marker === 0xd9) continue
    if (offset + 2 > bytes.length) break
    const size = bytes.readUInt16BE(offset)
    if (size < 2 || offset + size > bytes.length) break
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) }
    offset += size
  }
  throw new Error('JPEG dimensions could not be read')
}

function safeFileName(value: string) {
  const name = value.replace(/[\\/\0-\x1f]/g, '_').trim().slice(0, 240)
  if (!name) throw new Error('Image file name is required')
  return name
}

function cleanSegment(value: unknown) { return String(value ?? '').trim().replace(/[。！？；，,\s]+$/u, '') }

function unique<T>(values: T[]): T[] { return [...new Set(values)] }

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  return JSON.stringify(value)
}
