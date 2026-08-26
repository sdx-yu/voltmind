export type NodeType = 'book' | 'volume' | 'chapter' | 'scene'
export type SceneStatus = 'idea' | 'planned' | 'draft' | 'revising' | 'complete' | 'published'
export type EntityType = 'character' | 'location' | 'item' | 'event'
export type CandidateStatus = 'pending' | 'accepted' | 'accepted_modified' | 'ignored' | 'exception'
export type PrivacyLevel = 'normal' | 'author_only' | 'local_private'
export type ForeshadowStatus = 'planted' | 'reinforced' | 'misdirected' | 'resolved'
export type ForeshadowImportance = 'low' | 'medium' | 'high'

export interface Project {
  id: string
  title: string
  description: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface SeriesMember {
  projectId: string
  title: string
  addedAt: string
}

export interface Series {
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  members: SeriesMember[]
}

export interface SeriesCanonOverride {
  id: string
  entryId: string
  projectId: string
  canonicalName: string
  aliases: string[]
  summary: string
  privacyLevel: PrivacyLevel
  createdAt: string
  updatedAt: string
}

export interface SeriesCanonEntry {
  id: string
  seriesId: string
  type: EntityType
  canonicalName: string
  aliases: string[]
  summary: string
  privacyLevel: PrivacyLevel
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  override: SeriesCanonOverride | null
}

export interface StyleSample {
  id: string
  scope: 'project' | 'series'
  projectId: string | null
  seriesId: string | null
  title: string
  content: string
  guidance: string
  privacyLevel: PrivacyLevel
  enabled: boolean
  effectiveEnabled: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface ReadAloudPreferences {
  projectId: string
  voiceUri: string
  rate: number
  pitch: number
  updatedAt: string
}

export type DeliveryRuleKind = 'empty_scene' | 'duplicate_title' | 'unbroken_paragraph' | 'duplicate_scene' | 'min_project_words' | 'manual'

export interface DeliveryRule {
  id: string
  templateId: string
  code: string
  title: string
  description: string
  kind: DeliveryRuleKind
  config: Record<string, unknown>
  severity: 'risk' | 'review' | 'info'
  enabled: boolean
  effectiveEnabled: boolean
  manual: boolean
}

export interface DeliveryTemplate {
  id: string
  channel: string
  name: string
  version: string
  verifiedAt: string
  sourceUrl: string
  sourceNote: string
  enabled: boolean
  builtIn: boolean
  staleAfterDays: number
  rules: DeliveryRule[]
}

export interface DeliveryCheckResult {
  id: string
  ruleId: string
  ruleCode: string
  ruleTitle: string
  severity: DeliveryRule['severity']
  nodeId: string | null
  quote: string
  startOffset: number
  endOffset: number
  message: string
}

export interface DeliveryCheckRun {
  id: string
  projectId: string
  templateId: string
  chapterIds: string[]
  results: DeliveryCheckResult[]
  createdAt: string
}

export interface ManuscriptNode {
  id: string
  projectId: string
  parentId: string | null
  type: NodeType
  title: string
  sortKey: number
  status: SceneStatus
  povEntityId: string | null
  storyTime: string | null
  deletedAt: string | null
  wordCount: number
  children?: ManuscriptNode[]
}

export interface SceneDocument {
  nodeId: string
  contentJson: Record<string, unknown>
  plainText: string
  contentHash: string
  currentRevisionId: string | null
  updatedAt: string
}

export interface Revision {
  id: string
  nodeId: string
  parentRevisionId: string | null
  contentJson: Record<string, unknown>
  plainText: string
  contentHash: string
  sourceType: 'human' | 'import' | 'ai_accepted' | 'restore' | 'merge'
  provenanceLabel: ProvenanceLabel
  sourceTaskId: string | null
  createdAt: string
}

export type ProvenanceLabel = 'human' | 'ai_accepted' | 'human_after_ai' | 'import' | 'restore' | 'merge'
export type ProvenanceEventType = 'human_edit' | 'ai_generated' | 'ai_failed' | 'ai_accepted' | 'ai_rejected' | 'ai_undone' | 'human_after_ai' | 'import' | 'restore' | 'merge' | 'replace' | 'replace_undone' | 'candidate_created' | 'candidate_accepted' | 'candidate_rejected' | 'sync_merge' | 'sync_conflict' | 'sync_conflict_resolved'

export interface ProvenanceEvent {
  id: string
  projectId: string
  nodeId: string | null
  revisionId: string | null
  eventType: ProvenanceEventType
  actorType: 'human' | 'ai' | 'system'
  sourceTaskId: string | null
  sourceRevisionId: string | null
  contentHash: string
  metadata: Record<string, unknown>
  previousHash: string | null
  eventHash: string
  createdAt: string
  nodeTitle?: string
  revision?: Pick<Revision, 'parentRevisionId' | 'provenanceLabel'> | null
}

export interface ProvenanceManifestEvent extends Omit<ProvenanceEvent, 'projectId' | 'revision' | 'nodeTitle'> {
  sequence: number
  nodeTitle: string
  parentRevisionId: string | null
  provenanceLabel: ProvenanceLabel | null
  textExcerpt?: string
}

export interface ProvenanceBundle {
  format: 'bbd-provenance-v1'
  manifest: {
    formatVersion: 1
    exportedAt: string
    project: { title: string; projectFingerprint: string }
    privacy: { includesTextExcerpts: boolean; excludesPromptsAndSecrets: true }
    events: ProvenanceManifestEvent[]
    chainHead: string | null
  }
  manifestHash: string
}

export interface ProvenanceVerification {
  ok: boolean
  manifestHashValid: boolean
  chainValid: boolean
  eventCount: number
  message: string
}

export interface ProvenanceExportRecord {
  id: string
  projectId: string
  formatVersion: string
  manifestHash: string
  eventCount: number
  includedText: boolean
  createdAt: string
}

export type SyncVector = Record<string, number>
export type SyncConflictKind = 'structured_concurrent_edit' | 'delete_edit' | 'provenance_fork'

export interface SyncProjectStatus {
  initialized: boolean
  protocolVersion: 'bbd-sync-v1'
  deviceId: string | null
  deviceName: string
  sequence: number
  vector: SyncVector
  pendingPackages: number
  unresolvedConflicts: number
  lastExportedAt: string | null
  lastImportedAt: string | null
  engineeringOnly: true
}

export interface SyncConflict {
  id: string
  projectId: string
  objectType: 'entity' | 'scene' | 'provenance'
  objectId: string
  kind: SyncConflictKind
  localVector: SyncVector
  remoteVector: SyncVector
  localSummary: Record<string, unknown>
  remoteSummary: Record<string, unknown>
  status: 'pending' | 'resolved'
  resolution: 'keep_local' | 'use_remote' | 'acknowledge_remote' | null
  createdAt: string
  resolvedAt: string | null
}

export interface SyncTransferChunk {
  index: number
  hash: string
  data: string
}

export interface SyncTransferPackage {
  format: 'bbd-sync-v1'
  protocolVersion: 1
  packageId: string
  projectFingerprint: string
  senderDeviceId: string
  senderDeviceName: string
  sequence: number
  vector: SyncVector
  keySalt: string
  keyVerifier: string
  nonce: string
  authTag: string
  aadHash: string
  ciphertextHash: string
  chunkSize: number
  chunkCount: number
  chunks: SyncTransferChunk[]
  createdAt: string
}

export interface SyncPackageInspection {
  valid: boolean
  projectFingerprint: string
  senderDeviceName: string
  sequence: number
  vector: SyncVector
  projectTitle: string
  sceneCount: number
  entityCount: number
  attachmentCount: number
  provenanceEventCount: number
  createdAt: string
}

export interface SyncApplyResult {
  project: Project
  bootstrapped: boolean
  duplicate: boolean
  appliedScenes: number
  mergedScenes: number
  appliedEntities: number
  conflictsCreated: number
  provenance: 'extended' | 'unchanged' | 'conflict'
}

export interface SyncDrillResult {
  ok: boolean
  checks: Array<{ code: string; label: string; passed: boolean; detail: string }>
}

export interface Entity {
  id: string
  projectId: string
  type: EntityType
  canonicalName: string
  aliases: string[]
  summary: string
  privacyLevel: PrivacyLevel
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface EntityState {
  id: string
  entityId: string
  attributeKey: string
  value: unknown
  validFromNodeId: string | null
  validToNodeId: string | null
  worldTimeFrom: string | null
  worldTimeTo: string | null
  sourceMentionId: string | null
  createdAt: string
}

export interface Mention {
  id: string
  entityId: string
  nodeId: string
  quote: string
  startOffset: number
  endOffset: number
  confirmed: boolean
  createdAt: string
}

export interface ForeshadowEvent {
  id: string
  foreshadowId: string
  nodeId: string | null
  action: ForeshadowStatus
  evidence: string
  note: string
  createdAt: string
}

export interface Foreshadow {
  id: string
  projectId: string
  title: string
  summary: string
  status: ForeshadowStatus
  importance: ForeshadowImportance
  plannedPayoff: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  events: ForeshadowEvent[]
}

export interface KnowledgeGrant {
  id: string
  knowledgeId: string
  entityId: string
  knownFromNodeId: string
  sourceNodeId: string | null
  evidence: string
  note: string
  createdAt: string
}

export interface KnowledgeFact {
  id: string
  projectId: string
  title: string
  detail: string
  keywords: string[]
  firstRevealedNodeId: string | null
  privacyLevel: PrivacyLevel
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  grants: KnowledgeGrant[]
}

export interface CandidateChange {
  id: string
  projectId: string
  nodeId: string | null
  targetType: string
  targetId: string | null
  operation: string
  before: unknown
  after: unknown
  evidence: { quote?: string; startOffset?: number; endOffset?: number; reason?: string }
  confidence: number
  sourceTaskId: string | null
  status: CandidateStatus
  createdAt: string
  resolvedAt: string | null
}

export interface ContinuityIssue {
  id: string
  rule: string
  severity: 'risk' | 'review' | 'style'
  message: string
  currentEvidence: { nodeId: string; quote: string }
  conflictingEvidence?: { nodeId: string; quote: string }
  confidence: number
  actions: Array<'update_canon' | 'edit_text' | 'ignore' | 'exception'>
}

export interface SearchResult {
  nodeId: string
  title: string
  snippet: string
  rank: number
}

export type ReplaceScope = 'body' | 'title' | 'canon'

export interface ReplaceMatch {
  objectType: 'scene' | 'node' | 'entity'
  objectId: string
  title: string
  field: string
  before: string
  after: string
  occurrences: number
  revisionId?: string | null
}

export interface ReplaceBatch {
  id: string
  projectId: string
  query: string
  replacement: string
  scopes: ReplaceScope[]
  changes: ReplaceMatch[]
  createdAt: string
  undoneAt: string | null
}

export interface WritingStats {
  totalWords: number
  todayNet: number
  dailyGoal: number
  projectGoal: number
}

export interface AiContextItem {
  id: string
  type: 'scene' | 'entity' | 'state' | 'history' | 'style' | 'foreshadow' | 'knowledge'
  title: string
  content: string
  reason: string
  privacyLevel: PrivacyLevel
  selected: boolean
  estimatedTokens: number
}

export interface AiTaskResult {
  taskId: string
  taskType: string
  output: string
  model: string
  inputTokens: number
  outputTokens: number
  estimatedCost: number | null
  candidateChanges?: CandidateChange[]
}
