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
export type ProvenanceEventType = 'human_edit' | 'ai_generated' | 'ai_failed' | 'ai_accepted' | 'ai_rejected' | 'ai_undone' | 'human_after_ai' | 'import' | 'restore' | 'merge' | 'replace' | 'replace_undone' | 'candidate_created' | 'candidate_accepted' | 'candidate_rejected' | 'sync_merge' | 'sync_conflict' | 'sync_conflict_resolved' | 'review_suggestion_accepted' | 'review_feedback_decided' | 'template_applied' | 'template_reverted' | 'visual_anchor_created' | 'visual_anchor_refreshed' | 'visual_candidate_imported' | 'visual_candidate_accepted' | 'visual_candidate_rejected' | 'storyboard_updated'

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
  mobileItemCount: number
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

export type MobileInboxKind = 'inspiration' | 'scene_idea' | 'review_note'
export type MobileInboxActionType = 'filed' | 'dismissed' | 'revisit' | 'approved'

export interface MobileInboxAction {
  id: string
  itemId: string
  action: MobileInboxActionType
  note: string
  createdAt: string
}

export interface MobileInboxItem {
  id: string
  projectId: string | null
  targetNodeId: string | null
  kind: MobileInboxKind
  content: string
  originDeviceId: string | null
  createdAt: string
  actions: MobileInboxAction[]
  currentAction: MobileInboxActionType | null
}

export interface MobileLibraryScene {
  id: string
  projectId: string
  projectTitle: string
  title: string
  plainText: string
  updatedAt: string
  provenanceLabel: ProvenanceLabel | null
}

export type ReviewRole = 'editor' | 'beta_reader' | 'co_writer'
export type ReviewFeedbackKind = 'comment' | 'suggestion'
export type ReviewDecisionType = 'accepted' | 'rejected' | 'deferred'
export type ReviewAnchorStatus = 'exact' | 'candidate' | 'lost'

export interface ReviewAnchor {
  paragraphIndex: number
  startOffset: number
  endOffset: number
  quote: string
  paragraphHash: string
  contextBefore: string
  contextAfter: string
}

export interface ReviewDecision {
  id: string
  feedbackId: string
  decision: ReviewDecisionType
  note: string
  createdAt: string
}

export interface ReviewFeedback {
  id: string
  sessionId: string
  sceneId: string
  sceneTitle: string
  kind: ReviewFeedbackKind
  body: string
  anchor: ReviewAnchor
  originalText: string
  replacementText: string
  createdAt: string
  decisions: ReviewDecision[]
  currentDecision: ReviewDecisionType | null
  anchorStatus: ReviewAnchorStatus
  resolvedStartOffset: number | null
}

export interface ReviewSessionScene {
  id: string
  title: string
  plainText: string
  contentHash: string
  provenanceLabel: ProvenanceLabel | null
}

export interface ReviewSession {
  id: string
  projectId: string | null
  sourceProjectId: string
  projectTitle: string
  role: ReviewRole
  reviewerName: string
  sceneIds: string[]
  scenes: ReviewSessionScene[]
  includeProvenance: boolean
  direction: 'authored' | 'received' | 'restored'
  status: 'open' | 'closed' | 'archived'
  expiresAt: string | null
  createdAt: string
  feedback: ReviewFeedback[]
}

export interface ReviewPackage {
  format: 'bbd-review-v1'
  protocolVersion: 1
  mode: 'assignment' | 'response'
  packageId: string
  sessionId: string
  projectFingerprint: string
  keySalt: string
  keyVerifier: string
  nonce: string
  authTag: string
  ciphertextHash: string
  ciphertext: string
  createdAt: string
}

export interface ReviewPackageInspection {
  valid: true
  mode: 'assignment' | 'response'
  sessionId: string
  projectTitle: string
  reviewerName: string
  role: ReviewRole
  sceneCount: number
  feedbackCount: number
  createdAt: string
}

export type SprintScope = 'scene' | 'project'
export type SprintStatus = 'running' | 'paused' | 'completed' | 'cancelled'
export type SprintClockStatus = 'ok' | 'sleep_reconciled' | 'clock_anomaly'
export type SprintEventType = 'started' | 'paused' | 'resumed' | 'sleep_detected' | 'clock_anomaly' | 'completed' | 'cancelled'

export interface SprintSnapshotScene {
  sceneId: string
  revisionId: string | null
  contentHash: string
  wordCount: number
}

export interface SprintSample {
  id: string
  sessionId: string
  kind: 'start' | 'checkpoint' | 'end'
  capturedAt: string
  activeElapsedMs: number
  totalWords: number
  netWords: number
  scenes: SprintSnapshotScene[]
}

export interface SprintEvent {
  id: string
  sessionId: string
  type: SprintEventType
  occurredAt: string
  activeElapsedMs: number
  metadata: Record<string, unknown>
  previousHash: string | null
  eventHash: string
}

export interface SprintResultCard {
  id: string
  sessionId: string
  projectId: string
  participantLabel: string
  scope: SprintScope
  projectFingerprint: string
  scopeFingerprint: string
  startedAt: string
  endedAt: string
  activeDurationMs: number
  goalWords: number
  netWords: number
  eventChainHead: string
  eventCount: number
  createdAt: string
}

export interface SprintSession {
  id: string
  projectId: string
  scope: SprintScope
  sceneId: string | null
  durationMinutes: number
  goalWords: number
  status: SprintStatus
  clockStatus: SprintClockStatus
  startedAt: string
  plannedEndAt: string
  pausedAt: string | null
  endedAt: string | null
  totalPausedMs: number
  lastReconciledAt: string
  activeElapsedMs: number
  currentWords: number
  netWords: number
  samples: SprintSample[]
  events: SprintEvent[]
  resultCard: SprintResultCard | null
}

export type SprintShareCard = Omit<SprintResultCard, 'sessionId' | 'projectId'>

export interface SprintPackage {
  format: 'bbd-sprint-v1'
  protocolVersion: 1
  card: SprintShareCard
  events: Array<Omit<SprintEvent, 'sessionId'>>
  cardHash: string
}

export interface SprintPackageInspection {
  valid: true
  cardId: string
  participantLabel: string
  scope: SprintScope
  startedAt: string
  endedAt: string
  activeDurationMs: number
  goalWords: number
  netWords: number
  eventCount: number
}

export interface SprintBoardEntry {
  card: SprintShareCard
  cardHash: string
  importedAt: string
}

export interface SprintBoardParticipant {
  participantLabel: string
  netWords: number
  sprintCount: number
}

export interface SprintBoard {
  id: string
  projectId: string
  name: string
  period: 'day' | 'week'
  targetWords: number
  periodStartedAt: string
  createdAt: string
  updatedAt: string
  entries: SprintBoardEntry[]
  totalNetWords: number
  participants: SprintBoardParticipant[]
}

export type TemplateCapability = 'project.summary.read' | 'plan.nodes.create' | 'local.rules.run'
export type TemplatePackageStatus = 'enabled' | 'disabled' | 'uninstalled'

export interface TemplateStructureNode {
  localId: string
  parentLocalId: string | null
  type: 'chapter' | 'scene'
  title: string
  description: string
  status: Extract<SceneStatus, 'idea' | 'planned'>
}

export interface TemplateRule {
  id: string
  kind: 'minimum_scene_count' | 'unique_titles'
  title: string
  config: Record<string, unknown>
}

export interface TemplateManifest {
  packageId: string
  name: string
  version: string
  description: string
  authorLabel: string
  license: string
  sourceUrl: string
  capabilities: TemplateCapability[]
  structureHash: string
}

export interface TemplatePackage {
  format: 'bbd-template-v1'
  protocolVersion: 1
  manifest: TemplateManifest
  structure: { nodes: TemplateStructureNode[]; rules: TemplateRule[] }
  packageHash: string
}

export interface TemplatePackageInspection {
  valid: true
  duplicate: boolean
  collision: boolean
  manifest: TemplateManifest
  chapterCount: number
  sceneCount: number
  ruleCount: number
  packageHash: string
  warnings: string[]
}

export interface TemplateInstallation {
  id: string
  manifest: TemplateManifest
  package: TemplatePackage
  packageHash: string
  status: TemplatePackageStatus
  builtIn: boolean
  installedAt: string
  updatedAt: string
}

export interface TemplateGrant {
  projectId: string
  installationId: string
  capability: TemplateCapability
  granted: boolean
  updatedAt: string
}

export interface TemplateRuleResult {
  ruleId: string
  title: string
  passed: boolean
  message: string
}

export interface TemplatePreviewNode extends TemplateStructureNode {
  parentTitle: string
  conflict: 'none' | 'title'
}

export interface TemplatePreview {
  projectId: string
  installationId: string
  packageHash: string
  previewHash: string
  projectSummary: { title: string; description: string; chapterCount: number; sceneCount: number } | null
  nodes: TemplatePreviewNode[]
  conflicts: string[]
  ruleResults: TemplateRuleResult[]
  requiredCapabilities: TemplateCapability[]
  missingCapabilities: TemplateCapability[]
}

export interface TemplateApplication {
  id: string
  projectId: string
  installationId: string
  packageName: string
  packageVersion: string
  previewHash: string
  createdNodeIds: string[]
  status: 'applied' | 'reverted'
  appliedAt: string
  revertedAt: string | null
}

export type VisualSelectedField = 'canonicalName' | 'summary' | 'aliases' | `state:${string}`

export interface VisualCanonSnapshot {
  entityId: string
  entityType: Extract<EntityType, 'character' | 'location' | 'item'>
  entityUpdatedAt: string
  selectedFields: VisualSelectedField[]
  values: Record<string, unknown>
}

export interface VisualAsset {
  contentHash: string
  mimeType: 'image/png' | 'image/jpeg'
  byteSize: number
  width: number
  height: number
  createdAt: string
  url: string
}

export interface VisualCandidate {
  id: string
  projectId: string
  anchorId: string
  asset: VisualAsset
  sourceKind: 'import'
  sourceLabel: string
  fileName: string
  descriptionSnapshot: string
  canonHash: string
  status: 'pending' | 'accepted' | 'rejected' | 'superseded'
  createdAt: string
  resolvedAt: string | null
}

export interface VisualAnchor {
  id: string
  projectId: string
  entityId: string
  entityName: string
  entityType: Extract<EntityType, 'character' | 'location' | 'item'>
  selectedFields: VisualSelectedField[]
  styleNote: string
  visualDescription: string
  canonSnapshot: VisualCanonSnapshot
  canonHash: string
  currentCanonHash: string
  bindingStatus: 'unbound' | 'current' | 'stale'
  acceptedCandidateId: string | null
  acceptedAsset: VisualAsset | null
  candidates: VisualCandidate[]
  createdAt: string
  updatedAt: string
}

export interface StoryboardCard {
  id: string
  storyboardId: string
  position: number
  purpose: string
  note: string
  anchorIds: string[]
  asset: VisualAsset | null
  visualDescription: string
  canonBindings: Array<{ anchorId: string; canonHash: string }>
  createdAt: string
  updatedAt: string
}

export interface Storyboard {
  id: string
  projectId: string
  sceneId: string
  sceneTitle: string
  title: string
  cards: StoryboardCard[]
  createdAt: string
  updatedAt: string
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
