import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  CandidateChange,
  CanonDetection,
  DeliveryCheckResult,
  DeliveryCheckRun,
  DeliveryRule,
  DeliveryTemplate,
  Entity,
  EntityProfileField,
  EntityRelationship,
  EntityState,
  Foreshadow,
  ForeshadowEvent,
  KnowledgeFact,
  KnowledgeGrant,
  ManuscriptNode,
  Mention,
  MobileInboxAction,
  MobileInboxItem,
  Project,
  ProvenanceEvent,
  ProvenanceEventType,
  ProvenanceExportRecord,
  ProvenanceLabel,
  ReadAloudPreferences,
  RelationshipState,
  ReviewAnchor,
  ReviewDecision,
  ReviewFeedback,
  ReviewRole,
  ReviewSession,
  ReviewSessionScene,
  Revision,
  ReplaceBatch,
  ReplaceMatch,
  ReplaceScope,
  SceneDocument,
  SceneVoiceProfile,
  StyleAnalysisRun,
  SearchResult,
  Series,
  SeriesCanonEntry,
  SeriesCanonOverride,
  StyleSample,
  SprintBoard,
  SprintEvent,
  SprintEventType,
  SprintPackage,
  SprintResultCard,
  SprintSample,
  SprintSession,
  SprintSnapshotScene,
  SyncConflict,
  SyncProjectStatus,
  SyncVector,
  WritingStats,
} from '../shared/types.js'
import {
  analyzeStyleSamples, compileCharacterVoiceContract, compileVoiceContract, evaluateVoiceConsistency,
  normalizeCharacterVoice, normalizeVoiceKnobs, voiceSourceLabel,
  type CharacterVoiceKnobs, type CharacterVoiceProfile, type VoiceConsistencyReport,
  type VoiceKnobs, type VoicePreferenceSummary, type VoiceSource,
} from '../shared/voice.js'
import { countWords, jsonParse, newId, normalizeName, nowIso, sha256 } from './utils.js'

type Row = Record<string, unknown>

const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

export class AppDatabase {
  readonly db: DatabaseSync
  readonly databasePath: string
  private transactionDepth = 0

  constructor(databasePath: string) {
    this.databasePath = databasePath
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    backupBeforeMigration(databasePath, 20)
    this.db = new DatabaseSync(databasePath)
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;')
    this.migrate()
  }

  close() {
    this.db.close()
  }

  transaction<T>(fn: () => T): T {
    if (this.transactionDepth > 0) return fn()
    this.db.exec('BEGIN IMMEDIATE')
    this.transactionDepth += 1
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    } finally {
      this.transactionDepth -= 1
    }
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `)
    const version = Number((this.db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as Row).version)
    if (version < 1) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE projects (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
          );

          CREATE TABLE manuscript_nodes (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            parent_id TEXT REFERENCES manuscript_nodes(id),
            type TEXT NOT NULL CHECK(type IN ('book','volume','chapter','scene')),
            title TEXT NOT NULL,
            sort_key INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            pov_entity_id TEXT,
            story_time TEXT,
            deleted_at TEXT
          );
          CREATE INDEX idx_nodes_project_parent ON manuscript_nodes(project_id, parent_id, sort_key);

          CREATE TABLE scene_documents (
            node_id TEXT PRIMARY KEY REFERENCES manuscript_nodes(id),
            content_json TEXT NOT NULL,
            plain_text TEXT NOT NULL DEFAULT '',
            content_hash TEXT NOT NULL,
            current_revision_id TEXT,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE revisions (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL REFERENCES manuscript_nodes(id),
            parent_revision_id TEXT,
            content_json TEXT NOT NULL,
            plain_text TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            source_type TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_revisions_node_time ON revisions(node_id, created_at DESC);

          CREATE VIRTUAL TABLE scene_search USING fts5(node_id UNINDEXED, title, plain_text, tokenize='unicode61');

          CREATE TABLE entities (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            type TEXT NOT NULL,
            canonical_name TEXT NOT NULL,
            normalized_name TEXT NOT NULL,
            aliases_json TEXT NOT NULL DEFAULT '[]',
            summary TEXT NOT NULL DEFAULT '',
            privacy_level TEXT NOT NULL DEFAULT 'normal',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
          );
          CREATE INDEX idx_entities_project_type ON entities(project_id, type, normalized_name);

          CREATE TABLE entity_states (
            id TEXT PRIMARY KEY,
            entity_id TEXT NOT NULL REFERENCES entities(id),
            attribute_key TEXT NOT NULL,
            value_json TEXT NOT NULL,
            valid_from_node_id TEXT REFERENCES manuscript_nodes(id),
            valid_to_node_id TEXT REFERENCES manuscript_nodes(id),
            world_time_from TEXT,
            world_time_to TEXT,
            source_mention_id TEXT,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_states_entity_attribute ON entity_states(entity_id, attribute_key);

          CREATE TABLE mentions (
            id TEXT PRIMARY KEY,
            entity_id TEXT NOT NULL REFERENCES entities(id),
            node_id TEXT NOT NULL REFERENCES manuscript_nodes(id),
            quote TEXT NOT NULL,
            start_offset INTEGER NOT NULL,
            end_offset INTEGER NOT NULL,
            confirmed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_mentions_node ON mentions(node_id, start_offset);

          CREATE TABLE candidate_changes (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            node_id TEXT REFERENCES manuscript_nodes(id),
            target_type TEXT NOT NULL,
            target_id TEXT,
            operation TEXT NOT NULL,
            before_json TEXT,
            after_json TEXT,
            evidence_json TEXT NOT NULL DEFAULT '{}',
            confidence REAL NOT NULL DEFAULT 0,
            source_task_id TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            resolved_at TEXT
          );
          CREATE INDEX idx_candidates_project_status ON candidate_changes(project_id, status, created_at DESC);

          CREATE TABLE canon_events (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            candidate_id TEXT REFERENCES candidate_changes(id),
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            effective_node_id TEXT REFERENCES manuscript_nodes(id),
            created_at TEXT NOT NULL,
            previous_hash TEXT,
            event_hash TEXT NOT NULL
          );

          CREATE TABLE operation_log (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            object_type TEXT NOT NULL,
            object_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            revision_before TEXT,
            revision_after TEXT,
            actor_type TEXT NOT NULL,
            task_id TEXT,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_operations_project_time ON operation_log(project_id, created_at DESC);

          CREATE TABLE project_settings (
            project_id TEXT NOT NULL REFERENCES projects(id),
            key TEXT NOT NULL,
            value_json TEXT NOT NULL,
            PRIMARY KEY(project_id, key)
          );

          CREATE TABLE ai_settings (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            base_url TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            encrypted_api_key TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
          );

          CREATE TABLE ai_tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            node_id TEXT,
            task_type TEXT NOT NULL,
            prompt_version TEXT NOT NULL,
            model TEXT NOT NULL,
            context_hash TEXT NOT NULL,
            output_hash TEXT,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(1, nowIso())
      })
    }
    if (version < 2) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE replace_batches (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            query TEXT NOT NULL,
            replacement TEXT NOT NULL,
            scopes_json TEXT NOT NULL,
            changes_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            undone_at TEXT
          );
          CREATE TABLE imported_sources (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            file_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            byte_size INTEGER NOT NULL,
            content_hash TEXT NOT NULL,
            content_base64 TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE TABLE continuity_exceptions (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            node_id TEXT NOT NULL REFERENCES manuscript_nodes(id),
            rule TEXT NOT NULL,
            evidence_hash TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            UNIQUE(node_id, rule, evidence_hash)
          );
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(2, nowIso())
      })
    }
    if (version < 3) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE foreshadows (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            title TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL CHECK(status IN ('planted','reinforced','misdirected','resolved')),
            importance TEXT NOT NULL DEFAULT 'medium' CHECK(importance IN ('low','medium','high')),
            planned_payoff TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
          );
          CREATE INDEX idx_foreshadows_project_status ON foreshadows(project_id, status, updated_at DESC);
          CREATE TABLE foreshadow_events (
            id TEXT PRIMARY KEY,
            foreshadow_id TEXT NOT NULL REFERENCES foreshadows(id),
            node_id TEXT REFERENCES manuscript_nodes(id),
            action TEXT NOT NULL CHECK(action IN ('planted','reinforced','misdirected','resolved')),
            evidence TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_foreshadow_events_flow ON foreshadow_events(foreshadow_id, created_at);
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(3, nowIso())
      })
    }
    if (version < 4) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE knowledge_facts (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            title TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT '',
            keywords_json TEXT NOT NULL DEFAULT '[]',
            first_revealed_node_id TEXT REFERENCES manuscript_nodes(id),
            privacy_level TEXT NOT NULL DEFAULT 'author_only',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
          );
          CREATE INDEX idx_knowledge_project ON knowledge_facts(project_id, updated_at DESC);
          CREATE TABLE knowledge_grants (
            id TEXT PRIMARY KEY,
            knowledge_id TEXT NOT NULL REFERENCES knowledge_facts(id),
            entity_id TEXT NOT NULL REFERENCES entities(id),
            known_from_node_id TEXT NOT NULL REFERENCES manuscript_nodes(id),
            source_node_id TEXT REFERENCES manuscript_nodes(id),
            evidence TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            UNIQUE(knowledge_id, entity_id)
          );
          CREATE INDEX idx_knowledge_grants_entity ON knowledge_grants(entity_id, known_from_node_id);
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(4, nowIso())
      })
    }
    if (version < 5) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE series (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
          );
          CREATE TABLE series_projects (
            project_id TEXT PRIMARY KEY REFERENCES projects(id),
            series_id TEXT NOT NULL REFERENCES series(id),
            added_at TEXT NOT NULL
          );
          CREATE INDEX idx_series_projects_series ON series_projects(series_id, added_at);
          CREATE TABLE series_canon_entries (
            id TEXT PRIMARY KEY,
            series_id TEXT NOT NULL REFERENCES series(id),
            type TEXT NOT NULL CHECK(type IN ('character','location','item','event')),
            canonical_name TEXT NOT NULL,
            normalized_name TEXT NOT NULL,
            aliases_json TEXT NOT NULL DEFAULT '[]',
            summary TEXT NOT NULL DEFAULT '',
            privacy_level TEXT NOT NULL DEFAULT 'normal',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
          );
          CREATE INDEX idx_series_canon ON series_canon_entries(series_id, type, normalized_name);
          CREATE TABLE series_canon_overrides (
            id TEXT PRIMARY KEY,
            entry_id TEXT NOT NULL REFERENCES series_canon_entries(id),
            project_id TEXT NOT NULL REFERENCES projects(id),
            canonical_name TEXT NOT NULL,
            aliases_json TEXT NOT NULL DEFAULT '[]',
            summary TEXT NOT NULL DEFAULT '',
            privacy_level TEXT NOT NULL DEFAULT 'normal',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(entry_id, project_id)
          );
          CREATE INDEX idx_series_overrides_project ON series_canon_overrides(project_id, updated_at DESC);
          CREATE TABLE style_samples (
            id TEXT PRIMARY KEY,
            project_id TEXT REFERENCES projects(id),
            series_id TEXT REFERENCES series(id),
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            guidance TEXT NOT NULL DEFAULT '',
            privacy_level TEXT NOT NULL DEFAULT 'author_only',
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            CHECK((project_id IS NOT NULL AND series_id IS NULL) OR (project_id IS NULL AND series_id IS NOT NULL))
          );
          CREATE INDEX idx_style_samples_project ON style_samples(project_id, updated_at DESC);
          CREATE INDEX idx_style_samples_series ON style_samples(series_id, updated_at DESC);
          CREATE TABLE style_sample_preferences (
            sample_id TEXT NOT NULL REFERENCES style_samples(id),
            project_id TEXT NOT NULL REFERENCES projects(id),
            enabled INTEGER NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(sample_id, project_id)
          );
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(5, nowIso())
      })
    }
    if (version < 6) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE read_aloud_preferences (
            project_id TEXT PRIMARY KEY REFERENCES projects(id),
            voice_uri TEXT NOT NULL DEFAULT '',
            rate REAL NOT NULL DEFAULT 1,
            pitch REAL NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL
          );
          CREATE TABLE delivery_templates (
            id TEXT PRIMARY KEY,
            channel TEXT NOT NULL,
            name TEXT NOT NULL,
            version TEXT NOT NULL,
            verified_at TEXT NOT NULL,
            source_url TEXT NOT NULL DEFAULT '',
            source_note TEXT NOT NULL DEFAULT '',
            enabled INTEGER NOT NULL DEFAULT 1,
            built_in INTEGER NOT NULL DEFAULT 1,
            stale_after_days INTEGER NOT NULL DEFAULT 180,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
          );
          CREATE TABLE delivery_rules (
            id TEXT PRIMARY KEY,
            template_id TEXT NOT NULL REFERENCES delivery_templates(id),
            code TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL,
            config_json TEXT NOT NULL DEFAULT '{}',
            severity TEXT NOT NULL DEFAULT 'review',
            enabled INTEGER NOT NULL DEFAULT 1,
            manual INTEGER NOT NULL DEFAULT 0,
            sort_key INTEGER NOT NULL DEFAULT 1000
          );
          CREATE INDEX idx_delivery_rules_template ON delivery_rules(template_id, sort_key);
          CREATE TABLE project_delivery_rule_overrides (
            project_id TEXT NOT NULL REFERENCES projects(id),
            rule_id TEXT NOT NULL REFERENCES delivery_rules(id),
            enabled INTEGER NOT NULL,
            config_json TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL,
            PRIMARY KEY(project_id, rule_id)
          );
          CREATE TABLE delivery_check_runs (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            template_id TEXT NOT NULL REFERENCES delivery_templates(id),
            chapter_ids_json TEXT NOT NULL DEFAULT '[]',
            results_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_delivery_runs_project ON delivery_check_runs(project_id, created_at DESC);
        `)
        const createdAt = nowIso()
        const insertTemplate = this.db.prepare('INSERT INTO delivery_templates(id,channel,name,version,verified_at,source_url,source_note,enabled,built_in,stale_after_days,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        insertTemplate.run('builtin-general-v1', '通用', '通用交付自检', '1.0', '2026-08-26', '', '笔不怠本地示例规则，不代表任何平台官方要求。', 1, 1, 365, createdAt, createdAt)
        insertTemplate.run('builtin-fanqie-2026-08', '番茄小说', '番茄投稿辅助', '2026.08', '2026-08-26', 'https://fanqienovel.com/writer/zone/tutorial', '依据番茄作家课堂与内容发布规范核验；仅作本地辅助，不保证审核结果。', 1, 1, 90, createdAt, createdAt)
        const insertRule = this.db.prepare('INSERT INTO delivery_rules(id,template_id,code,title,description,kind,config_json,severity,enabled,manual,sort_key) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        insertRule.run('general-empty', 'builtin-general-v1', 'GEN-EMPTY-001', '空场景', '导出范围内不应包含没有正文的场景。', 'empty_scene', '{}', 'review', 1, 0, 1000)
        insertRule.run('general-title', 'builtin-general-v1', 'GEN-TITLE-001', '重复章节标题', '重复标题容易造成交付文件顺序混淆。', 'duplicate_title', '{}', 'review', 1, 0, 2000)
        insertRule.run('general-paragraph', 'builtin-general-v1', 'GEN-PARA-001', '超长未分段正文', '连续 500 字以上没有分段时提醒耳朵校对与排版复核。', 'unbroken_paragraph', '{"maxChars":500}', 'review', 1, 0, 3000)
        insertRule.run('fanqie-paragraph', 'builtin-fanqie-2026-08', 'FQ-FMT-001', '正文合理分段', '官方签约说明指出格式未分段可能被安全审核打回。', 'unbroken_paragraph', '{"maxChars":500}', 'risk', 1, 0, 1000)
        insertRule.run('fanqie-duplicate', 'builtin-fanqie-2026-08', 'FQ-LOW-001', '重复或无意义章节', '官方内容发布规范禁止批量无意义内容和恶意水文；这里只检测完全重复的正文。', 'duplicate_scene', '{"minChars":30}', 'risk', 1, 0, 2000)
        insertRule.run('fanqie-signing', 'builtin-fanqie-2026-08', 'FQ-SIGN-001', '首个签约申请字数提示', '官方作家课堂说明长篇作品达到 2 万字时出现首次签约申请机会。', 'min_project_words', '{"minWords":20000}', 'info', 1, 0, 3000)
        insertRule.run('fanqie-manual', 'builtin-fanqie-2026-08', 'FQ-CONTENT-001', '内容规范人工确认', '法律法规、低俗、侵权等内容风险必须由作者结合官方规范人工确认。', 'manual', '{}', 'review', 1, 1, 4000)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(6, createdAt)
      })
    }
    if (version < 7) {
      this.transaction(() => {
        const revisionColumns = new Set((this.db.prepare('PRAGMA table_info(revisions)').all() as Row[]).map((row) => String(row.name)))
        if (!revisionColumns.has('provenance_label')) this.db.exec("ALTER TABLE revisions ADD COLUMN provenance_label TEXT NOT NULL DEFAULT ''")
        if (!revisionColumns.has('source_task_id')) this.db.exec('ALTER TABLE revisions ADD COLUMN source_task_id TEXT')
        this.db.exec(`
          CREATE TABLE provenance_events (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            node_id TEXT REFERENCES manuscript_nodes(id),
            revision_id TEXT REFERENCES revisions(id),
            event_type TEXT NOT NULL,
            actor_type TEXT NOT NULL,
            source_task_id TEXT,
            source_revision_id TEXT,
            content_hash TEXT NOT NULL DEFAULT '',
            metadata_json TEXT NOT NULL DEFAULT '{}',
            previous_hash TEXT,
            event_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_provenance_project_time ON provenance_events(project_id, created_at);
          CREATE INDEX idx_provenance_node_time ON provenance_events(node_id, created_at);
          CREATE TABLE provenance_exports (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            format_version TEXT NOT NULL,
            manifest_hash TEXT NOT NULL,
            event_count INTEGER NOT NULL,
            included_text INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_provenance_exports_project ON provenance_exports(project_id, created_at DESC);
        `)
        this.backfillProvenance()
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(7, nowIso())
      })
    }
    if (version < 8) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE sync_project_configs (
            project_id TEXT PRIMARY KEY REFERENCES projects(id),
            device_id TEXT NOT NULL,
            device_name TEXT NOT NULL,
            key_salt TEXT NOT NULL,
            key_verifier TEXT NOT NULL,
            sequence INTEGER NOT NULL DEFAULT 0,
            vector_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_exported_at TEXT,
            last_imported_at TEXT
          );
          CREATE TABLE sync_scene_states (
            node_id TEXT PRIMARY KEY REFERENCES manuscript_nodes(id),
            project_id TEXT NOT NULL REFERENCES projects(id),
            state_base64 TEXT NOT NULL,
            state_vector_base64 TEXT NOT NULL,
            plain_hash TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX idx_sync_scene_project ON sync_scene_states(project_id);
          CREATE TABLE sync_object_versions (
            project_id TEXT NOT NULL REFERENCES projects(id),
            object_type TEXT NOT NULL,
            object_id TEXT NOT NULL,
            vector_json TEXT NOT NULL DEFAULT '{}',
            content_hash TEXT NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(project_id, object_type, object_id)
          );
          CREATE TABLE sync_updates (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            sender_device_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            vector_json TEXT NOT NULL DEFAULT '{}',
            envelope_json TEXT NOT NULL,
            payload_hash TEXT NOT NULL,
            direction TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            applied_at TEXT,
            UNIQUE(project_id, payload_hash, direction)
          );
          CREATE INDEX idx_sync_updates_project ON sync_updates(project_id, created_at DESC);
          CREATE TABLE sync_conflicts (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            object_type TEXT NOT NULL,
            object_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            local_vector_json TEXT NOT NULL,
            remote_vector_json TEXT NOT NULL,
            local_summary_json TEXT NOT NULL,
            remote_summary_json TEXT NOT NULL,
            local_value_json TEXT,
            remote_value_json TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            resolution TEXT,
            created_at TEXT NOT NULL,
            resolved_at TEXT
          );
          CREATE INDEX idx_sync_conflicts_project ON sync_conflicts(project_id, status, created_at DESC);
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(8, nowIso())
      })
    }
    if (version < 9) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE mobile_inbox_items (
            id TEXT PRIMARY KEY,
            project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
            target_node_id TEXT REFERENCES manuscript_nodes(id) ON DELETE SET NULL,
            kind TEXT NOT NULL CHECK(kind IN ('inspiration','scene_idea','review_note')),
            content TEXT NOT NULL,
            origin_device_id TEXT,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_mobile_inbox_project_time ON mobile_inbox_items(project_id, created_at DESC);
          CREATE TABLE mobile_inbox_actions (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL REFERENCES mobile_inbox_items(id) ON DELETE CASCADE,
            action TEXT NOT NULL CHECK(action IN ('filed','dismissed','revisit','approved')),
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_mobile_actions_item_time ON mobile_inbox_actions(item_id, created_at, id);
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(9, nowIso())
      })
    }
    if (version < 10) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE review_sessions (
            id TEXT PRIMARY KEY,
            project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
            source_project_id TEXT NOT NULL,
            project_title TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('editor','beta_reader','co_writer')),
            reviewer_name TEXT NOT NULL,
            scene_ids_json TEXT NOT NULL,
            scene_snapshots_json TEXT NOT NULL DEFAULT '[]',
            include_provenance INTEGER NOT NULL DEFAULT 0,
            direction TEXT NOT NULL CHECK(direction IN ('authored','received','restored')),
            status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','archived')),
            project_fingerprint TEXT NOT NULL,
            key_salt TEXT NOT NULL DEFAULT '',
            key_verifier TEXT NOT NULL DEFAULT '',
            expires_at TEXT,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_review_sessions_project ON review_sessions(project_id, created_at DESC);
          CREATE TABLE review_feedback (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
            scene_id TEXT NOT NULL,
            scene_title TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('comment','suggestion')),
            body TEXT NOT NULL,
            anchor_json TEXT NOT NULL,
            original_text TEXT NOT NULL DEFAULT '',
            replacement_text TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_review_feedback_session ON review_feedback(session_id, created_at, id);
          CREATE TABLE review_decisions (
            id TEXT PRIMARY KEY,
            feedback_id TEXT NOT NULL REFERENCES review_feedback(id) ON DELETE CASCADE,
            decision TEXT NOT NULL CHECK(decision IN ('accepted','rejected','deferred')),
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_review_decisions_feedback ON review_decisions(feedback_id, created_at, id);
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(10, nowIso())
      })
    }
    if (version < 11) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE sprint_sessions (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            scope TEXT NOT NULL CHECK(scope IN ('scene','project')),
            scene_id TEXT REFERENCES manuscript_nodes(id) ON DELETE SET NULL,
            duration_minutes INTEGER NOT NULL,
            goal_words INTEGER NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('running','paused','completed','cancelled')),
            clock_status TEXT NOT NULL DEFAULT 'ok' CHECK(clock_status IN ('ok','sleep_reconciled','clock_anomaly')),
            baseline_json TEXT NOT NULL,
            started_at TEXT NOT NULL,
            planned_end_at TEXT NOT NULL,
            paused_at TEXT,
            ended_at TEXT,
            total_paused_ms INTEGER NOT NULL DEFAULT 0,
            last_reconciled_at TEXT NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_sprint_sessions_project ON sprint_sessions(project_id, created_at DESC);
          CREATE UNIQUE INDEX idx_sprint_one_active_project ON sprint_sessions(project_id) WHERE status IN ('running','paused');
          CREATE TABLE sprint_samples (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sprint_sessions(id) ON DELETE CASCADE,
            kind TEXT NOT NULL CHECK(kind IN ('start','checkpoint','end')),
            captured_at TEXT NOT NULL,
            active_elapsed_ms INTEGER NOT NULL,
            total_words INTEGER NOT NULL,
            net_words INTEGER NOT NULL,
            scenes_json TEXT NOT NULL
          );
          CREATE INDEX idx_sprint_samples_session ON sprint_samples(session_id, captured_at, id);
          CREATE TABLE sprint_events (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sprint_sessions(id) ON DELETE CASCADE,
            event_type TEXT NOT NULL CHECK(event_type IN ('started','paused','resumed','sleep_detected','clock_anomaly','completed','cancelled')),
            occurred_at TEXT NOT NULL,
            active_elapsed_ms INTEGER NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            previous_hash TEXT,
            event_hash TEXT NOT NULL
          );
          CREATE INDEX idx_sprint_events_session ON sprint_events(session_id, occurred_at, id);
          CREATE TABLE sprint_result_cards (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL UNIQUE REFERENCES sprint_sessions(id) ON DELETE CASCADE,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            participant_label TEXT NOT NULL,
            scope TEXT NOT NULL CHECK(scope IN ('scene','project')),
            project_fingerprint TEXT NOT NULL,
            scope_fingerprint TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT NOT NULL,
            active_duration_ms INTEGER NOT NULL,
            goal_words INTEGER NOT NULL,
            net_words INTEGER NOT NULL,
            event_chain_head TEXT NOT NULL,
            event_count INTEGER NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_sprint_cards_project ON sprint_result_cards(project_id, created_at DESC);
          CREATE TABLE sprint_boards (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            period TEXT NOT NULL CHECK(period IN ('day','week')),
            target_words INTEGER NOT NULL,
            period_started_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX idx_sprint_boards_project ON sprint_boards(project_id, created_at DESC);
          CREATE TABLE sprint_board_cards (
            board_id TEXT NOT NULL REFERENCES sprint_boards(id) ON DELETE CASCADE,
            card_id TEXT NOT NULL,
            package_json TEXT NOT NULL,
            card_hash TEXT NOT NULL,
            imported_at TEXT NOT NULL,
            PRIMARY KEY(board_id, card_id)
          );
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(11, nowIso())
      })
    }
    if (version < 12) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE template_resources (
            content_hash TEXT PRIMARY KEY,
            media_type TEXT NOT NULL,
            content_json TEXT NOT NULL,
            byte_size INTEGER NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE TABLE template_packages (
            id TEXT PRIMARY KEY,
            package_key TEXT NOT NULL,
            name TEXT NOT NULL,
            version TEXT NOT NULL,
            description TEXT NOT NULL,
            author_label TEXT NOT NULL,
            license TEXT NOT NULL,
            source_url TEXT NOT NULL,
            capabilities_json TEXT NOT NULL,
            package_json TEXT NOT NULL,
            package_hash TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            built_in INTEGER NOT NULL DEFAULT 0,
            installed_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            uninstalled_at TEXT,
            UNIQUE(package_key, version)
          );
          CREATE INDEX idx_template_packages_status ON template_packages(uninstalled_at, enabled, name);
          CREATE TABLE template_package_resources (
            package_id TEXT NOT NULL REFERENCES template_packages(id) ON DELETE CASCADE,
            content_hash TEXT NOT NULL REFERENCES template_resources(content_hash),
            resource_path TEXT NOT NULL,
            PRIMARY KEY(package_id, resource_path)
          );
          CREATE TABLE template_grants (
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            package_id TEXT NOT NULL REFERENCES template_packages(id) ON DELETE CASCADE,
            capability TEXT NOT NULL CHECK(capability IN ('project.summary.read','plan.nodes.create','local.rules.run')),
            granted INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(project_id, package_id, capability)
          );
          CREATE TABLE template_applications (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            package_id TEXT NOT NULL REFERENCES template_packages(id),
            preview_hash TEXT NOT NULL,
            created_nodes_json TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('applied','reverted')),
            applied_at TEXT NOT NULL,
            reverted_at TEXT
          );
          CREATE INDEX idx_template_applications_project ON template_applications(project_id, applied_at DESC);
          CREATE TABLE template_events (
            id TEXT PRIMARY KEY,
            project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
            package_id TEXT NOT NULL REFERENCES template_packages(id),
            application_id TEXT REFERENCES template_applications(id) ON DELETE SET NULL,
            event_type TEXT NOT NULL CHECK(event_type IN ('installed','enabled','disabled','uninstalled','restored','granted','revoked','applied','reverted')),
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_template_events_project ON template_events(project_id, created_at, id);
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(12, nowIso())
      })
    }
    if (version < 13) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE visual_assets (
            content_hash TEXT PRIMARY KEY,
            mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png','image/jpeg')),
            byte_size INTEGER NOT NULL CHECK(byte_size > 0 AND byte_size <= 10485760),
            width INTEGER NOT NULL CHECK(width > 0 AND width <= 20000),
            height INTEGER NOT NULL CHECK(height > 0 AND height <= 20000),
            content_blob BLOB NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE TABLE visual_anchors (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            entity_id TEXT NOT NULL REFERENCES entities(id),
            selected_fields_json TEXT NOT NULL,
            style_note TEXT NOT NULL DEFAULT '',
            visual_description TEXT NOT NULL,
            canon_snapshot_json TEXT NOT NULL,
            canon_hash TEXT NOT NULL,
            accepted_candidate_id TEXT,
            accepted_asset_hash TEXT REFERENCES visual_assets(content_hash),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            UNIQUE(project_id, entity_id)
          );
          CREATE INDEX idx_visual_anchors_project ON visual_anchors(project_id, updated_at DESC);
          CREATE TABLE visual_candidates (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            anchor_id TEXT NOT NULL REFERENCES visual_anchors(id) ON DELETE CASCADE,
            asset_hash TEXT NOT NULL REFERENCES visual_assets(content_hash),
            source_kind TEXT NOT NULL CHECK(source_kind IN ('import')),
            source_label TEXT NOT NULL,
            file_name TEXT NOT NULL,
            description_snapshot TEXT NOT NULL,
            canon_hash TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','superseded')),
            created_at TEXT NOT NULL,
            resolved_at TEXT,
            UNIQUE(anchor_id, asset_hash, canon_hash)
          );
          CREATE INDEX idx_visual_candidates_anchor ON visual_candidates(anchor_id, created_at DESC);
          CREATE TABLE storyboards (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            scene_id TEXT NOT NULL REFERENCES manuscript_nodes(id),
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(project_id, scene_id)
          );
          CREATE INDEX idx_storyboards_project ON storyboards(project_id, updated_at DESC);
          CREATE TABLE storyboard_cards (
            id TEXT PRIMARY KEY,
            storyboard_id TEXT NOT NULL REFERENCES storyboards(id) ON DELETE CASCADE,
            position INTEGER NOT NULL CHECK(position >= 0),
            purpose TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            anchor_ids_json TEXT NOT NULL DEFAULT '[]',
            asset_hash TEXT REFERENCES visual_assets(content_hash),
            visual_description TEXT NOT NULL DEFAULT '',
            canon_bindings_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX idx_storyboard_cards_board ON storyboard_cards(storyboard_id, position, created_at);
          CREATE TABLE visual_events (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            anchor_id TEXT REFERENCES visual_anchors(id) ON DELETE SET NULL,
            candidate_id TEXT REFERENCES visual_candidates(id) ON DELETE SET NULL,
            storyboard_id TEXT REFERENCES storyboards(id) ON DELETE SET NULL,
            event_type TEXT NOT NULL CHECK(event_type IN ('anchor_created','anchor_refreshed','candidate_imported','candidate_accepted','candidate_rejected','storyboard_created','storyboard_updated')),
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_visual_events_project ON visual_events(project_id, created_at, id);
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(13, nowIso())
      })
    }
    if (version < 14) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE research_enrollments (
            id TEXT PRIMARY KEY,
            participant_code TEXT NOT NULL UNIQUE,
            consent_version TEXT NOT NULL,
            consent_text_hash TEXT NOT NULL,
            consent_receipt_hash TEXT NOT NULL UNIQUE,
            confirmations_json TEXT NOT NULL,
            consented_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE research_tasks (
            id TEXT PRIMARY KEY,
            enrollment_id TEXT NOT NULL REFERENCES research_enrollments(id) ON DELETE CASCADE,
            project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
            project_scope_hash TEXT NOT NULL,
            task_type TEXT NOT NULL CHECK(task_type IN ('canon_loop','fact_lookup','restore_drill','legacy_import','weekly_reflection')),
            status TEXT NOT NULL CHECK(status IN ('active','completed','abandoned')),
            started_at TEXT NOT NULL,
            completed_at TEXT,
            duration_seconds INTEGER,
            goal_achieved INTEGER,
            difficulty INTEGER,
            minutes_saved INTEGER,
            issue_codes_json TEXT NOT NULL DEFAULT '[]'
          );
          CREATE INDEX idx_research_tasks_enrollment ON research_tasks(enrollment_id, started_at DESC);

          CREATE TABLE research_events (
            id TEXT PRIMARY KEY,
            enrollment_id TEXT NOT NULL REFERENCES research_enrollments(id) ON DELETE CASCADE,
            sequence INTEGER NOT NULL,
            event_type TEXT NOT NULL CHECK(event_type IN ('consented','task_started','task_completed')),
            payload_json TEXT NOT NULL,
            previous_hash TEXT,
            event_hash TEXT NOT NULL UNIQUE,
            occurred_at TEXT NOT NULL,
            UNIQUE(enrollment_id, sequence)
          );
          CREATE INDEX idx_research_events_enrollment ON research_events(enrollment_id, sequence);
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(14, nowIso())
      })
    }
    if (version < 15) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE research_cohort_participants (
            id TEXT PRIMARY KEY,
            participant_code_hash TEXT NOT NULL UNIQUE,
            consent_receipt_hash TEXT NOT NULL UNIQUE,
            evidence_class TEXT NOT NULL CHECK(evidence_class IN ('external_attested','engineering_fixture')),
            segment TEXT NOT NULL CHECK(segment IN ('web_serial','revision_novel','ai_assisted','other_target')),
            attestation_json TEXT NOT NULL,
            retention_until TEXT NOT NULL,
            first_received_at TEXT NOT NULL,
            latest_received_at TEXT NOT NULL
          );

          CREATE TABLE research_cohort_submissions (
            id TEXT PRIMARY KEY,
            participant_id TEXT NOT NULL REFERENCES research_cohort_participants(id) ON DELETE CASCADE,
            manifest_hash TEXT NOT NULL UNIQUE,
            event_head_hash TEXT NOT NULL,
            event_hashes_json TEXT NOT NULL,
            event_count INTEGER NOT NULL,
            exported_at TEXT NOT NULL,
            received_at TEXT NOT NULL,
            observed_week_buckets INTEGER NOT NULL,
            active_span_days INTEGER NOT NULL,
            completed_tasks INTEGER NOT NULL,
            completed_core_loops INTEGER NOT NULL,
            reported_minutes_saved INTEGER NOT NULL,
            data_loss_reports INTEGER NOT NULL,
            false_positive_reports INTEGER NOT NULL,
            missed_fact_reports INTEGER NOT NULL,
            completed_outcomes INTEGER NOT NULL,
            abandoned_outcomes INTEGER NOT NULL,
            UNIQUE(participant_id, event_head_hash)
          );
          CREATE INDEX idx_research_cohort_submissions_participant ON research_cohort_submissions(participant_id, event_count DESC, received_at DESC);

          CREATE TABLE research_cohort_deletion_receipts (
            id TEXT PRIMARY KEY,
            tombstone_hash TEXT NOT NULL UNIQUE,
            reason TEXT NOT NULL CHECK(reason IN ('participant_request','retention_expired')),
            removed_submission_count INTEGER NOT NULL,
            removed_at TEXT NOT NULL
          );
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(15, nowIso())
      })
    }
    if (version < 16) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE research_waves (
            id TEXT PRIMARY KEY,
            display_code TEXT NOT NULL UNIQUE,
            kind TEXT NOT NULL CHECK(kind IN ('external_controlled','engineering_rehearsal')),
            status TEXT NOT NULL CHECK(status IN ('draft','recruiting','active','paused','review','closed','cancelled')),
            window_start TEXT NOT NULL,
            window_end TEXT NOT NULL,
            target_participants INTEGER NOT NULL,
            quotas_json TEXT NOT NULL,
            readiness_json TEXT NOT NULL,
            protocol_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE research_wave_events (
            id TEXT PRIMARY KEY,
            wave_id TEXT NOT NULL REFERENCES research_waves(id) ON DELETE CASCADE,
            sequence INTEGER NOT NULL,
            event_type TEXT NOT NULL CHECK(event_type IN ('created','status_changed','incident_opened','incident_resolved','participant_linked')),
            payload_json TEXT NOT NULL,
            previous_hash TEXT,
            event_hash TEXT NOT NULL UNIQUE,
            occurred_at TEXT NOT NULL,
            UNIQUE(wave_id, sequence)
          );
          CREATE INDEX idx_research_wave_events_wave ON research_wave_events(wave_id, sequence);

          CREATE TABLE research_wave_incidents (
            id TEXT PRIMARY KEY,
            wave_id TEXT NOT NULL REFERENCES research_waves(id) ON DELETE CASCADE,
            code TEXT NOT NULL CHECK(code IN ('onboarding_blocked','support_request','recovery_failed','data_loss','privacy_request','protocol_deviation')),
            severity TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
            opened_at TEXT NOT NULL,
            resolved_at TEXT
          );
          CREATE INDEX idx_research_wave_incidents_wave ON research_wave_incidents(wave_id, opened_at DESC);

          ALTER TABLE research_cohort_participants ADD COLUMN wave_id TEXT REFERENCES research_waves(id);
          CREATE INDEX idx_research_cohort_participants_wave ON research_cohort_participants(wave_id, first_received_at);
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(16, nowIso())
      })
    }
    if (version < 17) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE entity_profile_fields (
            id TEXT PRIMARY KEY,
            entity_id TEXT NOT NULL REFERENCES entities(id),
            category TEXT NOT NULL,
            label TEXT NOT NULL,
            value TEXT NOT NULL DEFAULT '',
            sort_key INTEGER NOT NULL DEFAULT 1000,
            privacy_level TEXT NOT NULL DEFAULT 'author_only',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX idx_profile_fields_entity ON entity_profile_fields(entity_id, sort_key, created_at);

          CREATE TABLE entity_relationships (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            source_entity_id TEXT NOT NULL REFERENCES entities(id),
            target_entity_id TEXT NOT NULL REFERENCES entities(id),
            relation_type TEXT NOT NULL,
            direction TEXT NOT NULL CHECK(direction IN ('directed','mutual')),
            label TEXT NOT NULL DEFAULT '',
            summary TEXT NOT NULL DEFAULT '',
            privacy_level TEXT NOT NULL DEFAULT 'normal',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            CHECK(source_entity_id <> target_entity_id)
          );
          CREATE INDEX idx_relationships_project ON entity_relationships(project_id, deleted_at, updated_at);
          CREATE INDEX idx_relationships_source ON entity_relationships(source_entity_id, deleted_at);
          CREATE INDEX idx_relationships_target ON entity_relationships(target_entity_id, deleted_at);

          CREATE TABLE relationship_states (
            id TEXT PRIMARY KEY,
            relationship_id TEXT NOT NULL REFERENCES entity_relationships(id),
            status_label TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            valid_from_node_id TEXT REFERENCES manuscript_nodes(id),
            valid_to_node_id TEXT REFERENCES manuscript_nodes(id),
            world_time_from TEXT,
            world_time_to TEXT,
            source_node_id TEXT REFERENCES manuscript_nodes(id),
            evidence TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_relationship_states_relation ON relationship_states(relationship_id, world_time_from, created_at);
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(17, nowIso())
      })
    }
    if (version < 18) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE project_voice_defaults (
            project_id TEXT PRIMARY KEY REFERENCES projects(id),
            family TEXT NOT NULL,
            intensity TEXT NOT NULL,
            pace TEXT NOT NULL,
            imagery TEXT NOT NULL,
            distance TEXT NOT NULL,
            interiority TEXT NOT NULL,
            intents_json TEXT NOT NULL DEFAULT '[]',
            register TEXT NOT NULL,
            sentence TEXT NOT NULL,
            dialogue TEXT NOT NULL,
            allusion TEXT NOT NULL,
            slang TEXT NOT NULL,
            author_note TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
          );
          CREATE TABLE scene_voice_profiles (
            node_id TEXT PRIMARY KEY REFERENCES manuscript_nodes(id),
            project_id TEXT NOT NULL REFERENCES projects(id),
            family TEXT NOT NULL,
            intensity TEXT NOT NULL,
            pace TEXT NOT NULL,
            imagery TEXT NOT NULL,
            distance TEXT NOT NULL,
            interiority TEXT NOT NULL,
            intents_json TEXT NOT NULL DEFAULT '[]',
            register TEXT NOT NULL,
            sentence TEXT NOT NULL,
            dialogue TEXT NOT NULL,
            allusion TEXT NOT NULL,
            slang TEXT NOT NULL,
            author_note TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
          );
          CREATE INDEX idx_scene_voice_project ON scene_voice_profiles(project_id, updated_at DESC);
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(18, nowIso())
      })
    }
    if (version < 19) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE style_analysis_runs (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            sample_ids_json TEXT NOT NULL,
            metrics_json TEXT NOT NULL,
            suggested_json TEXT NOT NULL,
            evidence_json TEXT NOT NULL,
            warnings_json TEXT NOT NULL,
            confirmed_at TEXT,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_style_analysis_project ON style_analysis_runs(project_id, created_at DESC);
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(19, nowIso())
      })
    }
    if (version < 20) {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE character_voice_profiles (
            entity_id TEXT PRIMARY KEY REFERENCES entities(id),
            project_id TEXT NOT NULL REFERENCES projects(id),
            register TEXT NOT NULL,
            sentence TEXT NOT NULL,
            directness TEXT NOT NULL,
            emotion TEXT NOT NULL,
            signature TEXT NOT NULL DEFAULT '',
            avoid TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
          );
          CREATE TABLE voice_preference_stats (
            project_id TEXT NOT NULL REFERENCES projects(id),
            family TEXT NOT NULL,
            task_type TEXT NOT NULL,
            accepted INTEGER NOT NULL DEFAULT 0,
            rejected INTEGER NOT NULL DEFAULT 0,
            undone INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(project_id,family,task_type)
          );
          CREATE INDEX idx_character_voice_project ON character_voice_profiles(project_id, updated_at DESC);
        `)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(20, nowIso())
      })
    }
    // A short-lived development build used schema version 18 before the full
    // style taxonomy was finalised. Repair those databases in place so a user
    // never has to delete a manuscript just to receive the completed feature.
    this.ensureColumns('project_voice_defaults', [
      ['family', "TEXT NOT NULL DEFAULT 'natural'"], ['intensity', "TEXT NOT NULL DEFAULT 'standard'"],
      ['pace', "TEXT NOT NULL DEFAULT 'balanced'"], ['imagery', "TEXT NOT NULL DEFAULT 'medium'"],
      ['distance', "TEXT NOT NULL DEFAULT 'medium'"], ['interiority', "TEXT NOT NULL DEFAULT 'medium'"],
      ['intents_json', "TEXT NOT NULL DEFAULT '[]'"],
    ])
    this.ensureColumns('scene_voice_profiles', [
      ['family', "TEXT NOT NULL DEFAULT 'natural'"], ['intensity', "TEXT NOT NULL DEFAULT 'standard'"],
      ['pace', "TEXT NOT NULL DEFAULT 'balanced'"], ['imagery', "TEXT NOT NULL DEFAULT 'medium'"],
      ['distance', "TEXT NOT NULL DEFAULT 'medium'"], ['interiority', "TEXT NOT NULL DEFAULT 'medium'"],
      ['intents_json', "TEXT NOT NULL DEFAULT '[]'"],
    ])
    this.ensureColumns('ai_tasks', [['effective_style_hash', 'TEXT'], ['selection_hash', 'TEXT']])
    const reviewTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='review_sessions'").get()
    const reviewColumns = reviewTable ? this.db.prepare('PRAGMA table_info(review_sessions)').all() as Row[] : []
    if (reviewColumns.length && !reviewColumns.some((column) => String(column.name) === 'scene_snapshots_json')) this.db.exec("ALTER TABLE review_sessions ADD COLUMN scene_snapshots_json TEXT NOT NULL DEFAULT '[]'")
  }

  private ensureColumns(table: string, columns: Array<[string, string]>) {
    const exists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
    if (!exists) return
    const current = new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((column) => String(column.name)))
    for (const [name, definition] of columns) if (!current.has(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
  }

  integrityCheck(): string {
    return String((this.db.prepare('PRAGMA integrity_check').get() as Row).integrity_check)
  }

  createProject(title: string, description = ''): Project {
    const id = newId()
    const bookId = newId()
    const chapterId = newId()
    const sceneId = newId()
    const createdAt = nowIso()
    this.transaction(() => {
      this.db.prepare('INSERT INTO projects(id,title,description,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, title, description, createdAt, createdAt)
      const insert = this.db.prepare('INSERT INTO manuscript_nodes(id,project_id,parent_id,type,title,sort_key,status) VALUES(?,?,?,?,?,?,?)')
      insert.run(bookId, id, null, 'book', title, 1000, 'draft')
      insert.run(chapterId, id, bookId, 'chapter', '第一章', 1000, 'draft')
      insert.run(sceneId, id, chapterId, 'scene', '场景 1', 1000, 'draft')
      const content = JSON.stringify(emptyDoc)
      const hash = sha256(content)
      this.db.prepare('INSERT INTO scene_documents(node_id,content_json,plain_text,content_hash,updated_at) VALUES(?,?,?,?,?)').run(sceneId, content, '', hash, createdAt)
      this.upsertSearch(sceneId, '场景 1', '')
      this.logOperation(id, 'project', id, 'create', null, null, 'human')
    })
    return { id, title, description, createdAt, updatedAt: createdAt, deletedAt: null }
  }

  listProjects(includeDeleted = false): Project[] {
    const rows = this.db.prepare(`SELECT * FROM projects ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY updated_at DESC`).all() as Row[]
    return rows.map(mapProject)
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id=?').get(id) as Row | undefined
    return row ? mapProject(row) : null
  }

  updateProject(id: string, patch: { title?: string; description?: string; deletedAt?: string | null }): Project | null {
    const current = this.getProject(id)
    if (!current) return null
    const updatedAt = nowIso()
    this.transaction(() => {
      this.db.prepare('UPDATE projects SET title=?,description=?,deleted_at=?,updated_at=? WHERE id=?').run(
        patch.title ?? current.title,
        patch.description ?? current.description,
        patch.deletedAt === undefined ? current.deletedAt : patch.deletedAt,
        updatedAt,
        id,
      )
      if (patch.title !== undefined) this.db.prepare("UPDATE manuscript_nodes SET title=? WHERE project_id=? AND type='book'").run(patch.title, id)
    })
    return this.getProject(id)
  }

  listNodes(projectId: string, includeDeleted = false): ManuscriptNode[] {
    const rows = this.db.prepare(`
      SELECT n.*, COALESCE(d.plain_text, '') AS plain_text
      FROM manuscript_nodes n LEFT JOIN scene_documents d ON d.node_id=n.id
      WHERE n.project_id=? ${includeDeleted ? '' : 'AND n.deleted_at IS NULL'}
      ORDER BY CASE n.type WHEN 'book' THEN 0 WHEN 'volume' THEN 1 WHEN 'chapter' THEN 2 ELSE 3 END, n.sort_key
    `).all(projectId) as Row[]
    return rows.map(mapNode)
  }

  getNode(id: string): ManuscriptNode | null {
    const row = this.db.prepare(`SELECT n.*, COALESCE(d.plain_text,'') AS plain_text FROM manuscript_nodes n LEFT JOIN scene_documents d ON d.node_id=n.id WHERE n.id=?`).get(id) as Row | undefined
    return row ? mapNode(row) : null
  }

  createNode(input: { projectId: string; parentId: string | null; type: ManuscriptNode['type']; title: string; sortKey?: number }): ManuscriptNode {
    const id = newId()
    const sortKey = input.sortKey ?? this.nextSortKey(input.projectId, input.parentId)
    this.transaction(() => {
      this.db.prepare('INSERT INTO manuscript_nodes(id,project_id,parent_id,type,title,sort_key,status) VALUES(?,?,?,?,?,?,?)').run(
        id, input.projectId, input.parentId, input.type, input.title, sortKey, input.type === 'scene' ? 'draft' : 'planned',
      )
      if (input.type === 'scene') {
        const content = JSON.stringify(emptyDoc)
        this.db.prepare('INSERT INTO scene_documents(node_id,content_json,plain_text,content_hash,updated_at) VALUES(?,?,?,?,?)').run(id, content, '', sha256(content), nowIso())
        this.upsertSearch(id, input.title, '')
      }
      this.touchProject(input.projectId)
      this.logOperation(input.projectId, 'node', id, 'create', null, null, 'human')
    })
    return this.getNode(id)!
  }

  updateNode(id: string, patch: Partial<Pick<ManuscriptNode, 'parentId' | 'title' | 'sortKey' | 'status' | 'povEntityId' | 'storyTime'>>): ManuscriptNode | null {
    const current = this.getNode(id)
    if (!current) return null
    this.transaction(() => {
      this.db.prepare(`UPDATE manuscript_nodes SET parent_id=?,title=?,sort_key=?,status=?,pov_entity_id=?,story_time=? WHERE id=?`).run(
        patch.parentId === undefined ? current.parentId : patch.parentId,
        patch.title ?? current.title,
        patch.sortKey ?? current.sortKey,
        patch.status ?? current.status,
        patch.povEntityId === undefined ? current.povEntityId : patch.povEntityId,
        patch.storyTime === undefined ? current.storyTime : patch.storyTime,
        id,
      )
      if (current.type === 'scene' && patch.title) {
        const doc = this.getScene(id)
        this.upsertSearch(id, patch.title, doc?.plainText ?? '')
      }
      this.touchProject(current.projectId)
      this.logOperation(current.projectId, 'node', id, 'update', null, null, 'human')
    })
    return this.getNode(id)
  }

  softDeleteNode(id: string, deleted = true): ManuscriptNode | null {
    const current = this.getNode(id)
    if (!current) return null
    const value = deleted ? nowIso() : null
    this.transaction(() => {
      this.db.prepare(`WITH RECURSIVE descendants(id) AS (
        SELECT id FROM manuscript_nodes WHERE id=?
        UNION ALL
        SELECT n.id FROM manuscript_nodes n JOIN descendants d ON n.parent_id=d.id
      ) UPDATE manuscript_nodes SET deleted_at=? WHERE id IN (SELECT id FROM descendants)`).run(id, value)
      this.touchProject(current.projectId)
      this.logOperation(current.projectId, 'node', id, deleted ? 'trash' : 'restore', null, null, 'human')
    })
    return this.getNode(id)
  }

  getScene(nodeId: string): SceneDocument | null {
    const row = this.db.prepare('SELECT * FROM scene_documents WHERE node_id=?').get(nodeId) as Row | undefined
    return row ? mapScene(row) : null
  }

  saveScene(nodeId: string, contentJson: Record<string, unknown>, plainText: string, sourceType: Revision['sourceType'] = 'human', sourceTaskId: string | null = null): SceneDocument {
    const node = this.getNode(nodeId)
    if (!node || node.type !== 'scene') throw new Error('Scene not found')
    const current = this.getScene(nodeId)
    const content = JSON.stringify(contentJson)
    const hash = sha256(content)
    if (current?.contentHash === hash) return current
    this.transaction(() => this.saveSceneRaw(node, contentJson, plainText, sourceType, sourceTaskId))
    return this.getScene(nodeId)!
  }

  private saveSceneRaw(node: ManuscriptNode, contentJson: Record<string, unknown>, plainText: string, sourceType: Revision['sourceType'], sourceTaskId: string | null = null) {
    const current = this.getScene(node.id)
    const content = JSON.stringify(contentJson)
    const hash = sha256(content)
    if (current?.contentHash === hash) return current
    const revisionId = newId()
    const createdAt = nowIso()
    const provenanceLabel = this.revisionProvenanceLabel(current?.currentRevisionId ?? null, sourceType)
    this.db.prepare(`INSERT INTO revisions(id,node_id,parent_revision_id,content_json,plain_text,content_hash,source_type,provenance_label,source_task_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      revisionId, node.id, current?.currentRevisionId ?? null, content, plainText, hash, sourceType, provenanceLabel, sourceTaskId, createdAt,
    )
    this.db.prepare(`INSERT INTO scene_documents(node_id,content_json,plain_text,content_hash,current_revision_id,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET content_json=excluded.content_json,plain_text=excluded.plain_text,content_hash=excluded.content_hash,current_revision_id=excluded.current_revision_id,updated_at=excluded.updated_at`).run(
      node.id, content, plainText, hash, revisionId, createdAt,
    )
    this.repairMentionAnchors(node.id, plainText)
    this.upsertSearch(node.id, node.title, plainText)
    this.touchProject(node.projectId)
    this.recordProvenanceEvent({ projectId: node.projectId, nodeId: node.id, revisionId, eventType: revisionEventType(provenanceLabel), actorType: provenanceLabel === 'ai_accepted' ? 'ai' : provenanceLabel === 'human' || provenanceLabel === 'human_after_ai' ? 'human' : 'system', sourceTaskId, sourceRevisionId: current?.currentRevisionId ?? null, contentHash: hash, metadata: { sourceType, provenanceLabel }, createdAt })
    this.logOperation(node.projectId, 'scene', node.id, 'save', current?.currentRevisionId ?? null, revisionId, sourceType === 'human' ? 'human' : 'ai', sourceTaskId)
    return this.getScene(node.id)
  }

  private repairMentionAnchors(nodeId: string, plainText: string) {
    for (const mention of this.listMentions(nodeId)) {
      if (plainText.slice(mention.startOffset, mention.endOffset) === mention.quote) continue
      const positions: number[] = []
      let at = plainText.indexOf(mention.quote)
      while (at >= 0) { positions.push(at); at = plainText.indexOf(mention.quote, at + Math.max(1, mention.quote.length)) }
      if (!positions.length) continue
      const nearest = positions.sort((a, b) => Math.abs(a - mention.startOffset) - Math.abs(b - mention.startOffset))[0]
      this.db.prepare('UPDATE mentions SET start_offset=?,end_offset=? WHERE id=?').run(nearest, nearest + mention.quote.length, mention.id)
    }
  }

  listRevisions(nodeId: string): Revision[] {
    return (this.db.prepare('SELECT * FROM revisions WHERE node_id=? ORDER BY created_at DESC').all(nodeId) as Row[]).map(mapRevision)
  }

  restoreRevision(nodeId: string, revisionId: string): SceneDocument {
    const row = this.db.prepare('SELECT * FROM revisions WHERE id=? AND node_id=?').get(revisionId, nodeId) as Row | undefined
    if (!row) throw new Error('Revision not found')
    const revision = mapRevision(row)
    return this.saveScene(nodeId, revision.contentJson, revision.plainText, 'restore')
  }

  search(projectId: string, query: string): SearchResult[] {
    const cleaned = query.trim().replace(/["']/g, '')
    if (!cleaned) return []
    const rows = this.db.prepare(`
      SELECT s.node_id, n.title, snippet(scene_search, 2, '<mark>', '</mark>', '…', 16) AS snippet, bm25(scene_search) AS rank
      FROM scene_search s JOIN manuscript_nodes n ON n.id=s.node_id
      WHERE scene_search MATCH ? AND n.project_id=? AND n.deleted_at IS NULL
      ORDER BY rank LIMIT 100
    `).all(`"${cleaned.replaceAll('"', ' ')}"`, projectId) as Row[]
    const results = rows.map((row) => ({ nodeId: String(row.node_id), title: String(row.title), snippet: String(row.snippet), rank: Number(row.rank) }))
    if (results.length) return results
    const fallback = this.db.prepare(`
      SELECT n.id AS node_id, n.title, d.plain_text
      FROM scene_documents d JOIN manuscript_nodes n ON n.id=d.node_id
      WHERE n.project_id=? AND n.deleted_at IS NULL AND d.plain_text LIKE ?
      ORDER BY n.sort_key LIMIT 100
    `).all(projectId, `%${cleaned}%`) as Row[]
    return fallback.map((row) => {
      const text = String(row.plain_text)
      const index = Math.max(0, text.indexOf(cleaned))
      const start = Math.max(0, index - 18)
      const end = Math.min(text.length, index + cleaned.length + 28)
      const snippet = `${start ? '…' : ''}${escapeHtml(text.slice(start, index))}<mark>${escapeHtml(cleaned)}</mark>${escapeHtml(text.slice(index + cleaned.length, end))}${end < text.length ? '…' : ''}`
      return { nodeId: String(row.node_id), title: String(row.title), snippet, rank: 0 }
    })
  }

  createSeries(input: { name: string; description?: string; projectId: string }): Series {
    if (!this.getProject(input.projectId)) throw new Error('Project not found')
    if (this.getSeriesForProject(input.projectId)) throw new Error('Project already belongs to a series')
    const id = newId(); const createdAt = nowIso()
    this.transaction(() => {
      this.db.prepare('INSERT INTO series(id,name,description,created_at,updated_at) VALUES(?,?,?,?,?)').run(id, input.name.trim(), input.description ?? '', createdAt, createdAt)
      this.db.prepare('INSERT INTO series_projects(project_id,series_id,added_at) VALUES(?,?,?)').run(input.projectId, id, createdAt)
      this.touchProject(input.projectId)
      this.logOperation(input.projectId, 'series', id, 'create_and_join', null, null, 'human')
    })
    return this.getSeries(id)!
  }

  listSeries(includeDeleted = false): Series[] {
    return (this.db.prepare(`SELECT * FROM series ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY updated_at DESC`).all() as Row[]).map((row) => this.mapSeries(row))
  }

  getSeries(id: string): Series | null {
    const row = this.db.prepare('SELECT * FROM series WHERE id=?').get(id) as Row | undefined
    return row ? this.mapSeries(row) : null
  }

  getSeriesForProject(projectId: string): Series | null {
    const row = this.db.prepare('SELECT s.* FROM series s JOIN series_projects sp ON sp.series_id=s.id WHERE sp.project_id=? AND s.deleted_at IS NULL').get(projectId) as Row | undefined
    return row ? this.mapSeries(row) : null
  }

  updateSeries(id: string, patch: { name?: string; description?: string; deletedAt?: string | null }, actorProjectId: string): Series | null {
    const current = this.getSeries(id)
    if (!current) return null
    this.requireSeriesMember(id, actorProjectId)
    this.db.prepare('UPDATE series SET name=?,description=?,deleted_at=?,updated_at=? WHERE id=?').run(
      patch.name?.trim() ?? current.name, patch.description ?? current.description,
      patch.deletedAt === undefined ? current.deletedAt : patch.deletedAt, nowIso(), id,
    )
    this.logOperation(actorProjectId, 'series', id, 'update', null, null, 'human')
    return this.getSeries(id)
  }

  addProjectToSeries(seriesId: string, projectId: string, actorProjectId: string): Series {
    const series = this.getSeries(seriesId)
    if (!series || series.deletedAt) throw new Error('Series not found')
    if (actorProjectId !== projectId || this.getSeriesForProject(actorProjectId)) this.requireSeriesMember(seriesId, actorProjectId)
    if (!this.getProject(projectId)) throw new Error('Project not found')
    const existing = this.getSeriesForProject(projectId)
    if (existing && existing.id !== seriesId) throw new Error('Project already belongs to another series')
    if (!existing) {
      this.db.prepare('INSERT INTO series_projects(project_id,series_id,added_at) VALUES(?,?,?)').run(projectId, seriesId, nowIso())
      this.touchProject(projectId)
      this.logOperation(projectId, 'series_membership', seriesId, 'join', null, null, 'human')
    }
    return this.getSeries(seriesId)!
  }

  removeProjectFromSeries(seriesId: string, projectId: string, actorProjectId: string): boolean {
    this.requireSeriesMember(seriesId, actorProjectId)
    const result = this.db.prepare('DELETE FROM series_projects WHERE series_id=? AND project_id=?').run(seriesId, projectId)
    if (Number(result.changes)) {
      this.touchProject(projectId)
      this.logOperation(projectId, 'series_membership', seriesId, 'leave', null, null, 'human')
    }
    return Boolean(result.changes)
  }

  createSeriesCanon(input: { seriesId: string; actorProjectId: string; type: Entity['type']; canonicalName: string; aliases?: string[]; summary?: string; privacyLevel?: Entity['privacyLevel'] }): SeriesCanonEntry {
    this.requireSeriesMember(input.seriesId, input.actorProjectId)
    const id = newId(); const createdAt = nowIso()
    this.db.prepare('INSERT INTO series_canon_entries(id,series_id,type,canonical_name,normalized_name,aliases_json,summary,privacy_level,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(
      id, input.seriesId, input.type, input.canonicalName.trim(), normalizeName(input.canonicalName), JSON.stringify(input.aliases ?? []), input.summary ?? '', input.privacyLevel ?? 'normal', createdAt, createdAt,
    )
    this.logOperation(input.actorProjectId, 'series_canon', id, 'create', null, null, 'human')
    return this.getSeriesCanon(id, input.actorProjectId)!
  }

  listSeriesCanonForProject(projectId: string, includeDeleted = false): SeriesCanonEntry[] {
    const series = this.getSeriesForProject(projectId)
    return series ? this.listSeriesCanon(series.id, projectId, includeDeleted) : []
  }

  listSeriesCanon(seriesId: string, projectId: string, includeDeleted = false): SeriesCanonEntry[] {
    this.requireSeriesMember(seriesId, projectId)
    return (this.db.prepare(`SELECT * FROM series_canon_entries WHERE series_id=? ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY type, normalized_name`).all(seriesId) as Row[]).map((row) => this.mapSeriesCanon(row, projectId))
  }

  getSeriesCanon(id: string, projectId: string): SeriesCanonEntry | null {
    const row = this.db.prepare('SELECT * FROM series_canon_entries WHERE id=?').get(id) as Row | undefined
    if (!row) return null
    this.requireSeriesMember(String(row.series_id), projectId)
    return this.mapSeriesCanon(row, projectId)
  }

  updateSeriesCanon(id: string, patch: Partial<Pick<SeriesCanonEntry, 'type' | 'canonicalName' | 'aliases' | 'summary' | 'privacyLevel' | 'deletedAt'>>, actorProjectId: string): SeriesCanonEntry | null {
    const current = this.getSeriesCanon(id, actorProjectId)
    if (!current) return null
    this.db.prepare('UPDATE series_canon_entries SET type=?,canonical_name=?,normalized_name=?,aliases_json=?,summary=?,privacy_level=?,deleted_at=?,updated_at=? WHERE id=?').run(
      patch.type ?? current.type, patch.canonicalName?.trim() ?? current.canonicalName, normalizeName(patch.canonicalName ?? current.canonicalName), JSON.stringify(patch.aliases ?? current.aliases), patch.summary ?? current.summary,
      patch.privacyLevel ?? current.privacyLevel, patch.deletedAt === undefined ? current.deletedAt : patch.deletedAt, nowIso(), id,
    )
    this.logOperation(actorProjectId, 'series_canon', id, patch.deletedAt ? 'trash' : 'update', null, null, 'human')
    return this.getSeriesCanon(id, actorProjectId)
  }

  upsertSeriesCanonOverride(entryId: string, projectId: string, input: Pick<SeriesCanonOverride, 'canonicalName' | 'aliases' | 'summary' | 'privacyLevel'>): SeriesCanonOverride {
    const entry = this.getSeriesCanon(entryId, projectId)
    if (!entry || entry.deletedAt) throw new Error('Series canon entry not found')
    const existing = entry.override; const id = existing?.id ?? newId(); const time = nowIso()
    this.db.prepare(`INSERT INTO series_canon_overrides(id,entry_id,project_id,canonical_name,aliases_json,summary,privacy_level,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(entry_id,project_id) DO UPDATE SET canonical_name=excluded.canonical_name,aliases_json=excluded.aliases_json,summary=excluded.summary,privacy_level=excluded.privacy_level,updated_at=excluded.updated_at`).run(
      id, entryId, projectId, input.canonicalName.trim(), JSON.stringify(input.aliases), input.summary, input.privacyLevel, existing?.createdAt ?? time, time,
    )
    this.logOperation(projectId, 'series_canon_override', entryId, existing ? 'update' : 'create', null, null, 'human')
    return this.getSeriesCanon(entryId, projectId)!.override!
  }

  deleteSeriesCanonOverride(entryId: string, projectId: string): boolean {
    this.getSeriesCanon(entryId, projectId)
    const result = this.db.prepare('DELETE FROM series_canon_overrides WHERE entry_id=? AND project_id=?').run(entryId, projectId)
    if (Number(result.changes)) this.logOperation(projectId, 'series_canon_override', entryId, 'remove', null, null, 'human')
    return Boolean(result.changes)
  }

  createStyleSample(input: { projectId?: string | null; seriesId?: string | null; actorProjectId: string; title: string; content: string; guidance?: string; privacyLevel?: StyleSample['privacyLevel']; enabled?: boolean }): StyleSample {
    if (Boolean(input.projectId) === Boolean(input.seriesId)) throw new Error('Style sample must belong to one project or one series')
    if (input.projectId && input.projectId !== input.actorProjectId) throw new Error('Project style sample owner mismatch')
    if (input.seriesId) this.requireSeriesMember(input.seriesId, input.actorProjectId)
    const id = newId(); const time = nowIso()
    this.db.prepare('INSERT INTO style_samples(id,project_id,series_id,title,content,guidance,privacy_level,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(
      id, input.projectId ?? null, input.seriesId ?? null, input.title.trim(), input.content, input.guidance ?? '', input.privacyLevel ?? 'author_only', input.enabled === false ? 0 : 1, time, time,
    )
    this.logOperation(input.actorProjectId, 'style_sample', id, 'create', null, null, 'human')
    return this.getStyleSample(id, input.actorProjectId)!
  }

  listStyleSamples(projectId: string, includeDeleted = false): StyleSample[] {
    const series = this.getSeriesForProject(projectId)
    const rows = series
      ? this.db.prepare(`SELECT * FROM style_samples WHERE (project_id=? OR series_id=?) ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY updated_at DESC`).all(projectId, series.id) as Row[]
      : this.db.prepare(`SELECT * FROM style_samples WHERE project_id=? ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY updated_at DESC`).all(projectId) as Row[]
    return rows.map((row) => this.mapStyleSample(row, projectId))
  }

  getStyleSample(id: string, projectId: string): StyleSample | null {
    const row = this.db.prepare('SELECT * FROM style_samples WHERE id=?').get(id) as Row | undefined
    if (!row) return null
    if (row.project_id && String(row.project_id) !== projectId) throw new Error('Style sample is not visible to this project')
    if (row.series_id) this.requireSeriesMember(String(row.series_id), projectId)
    return this.mapStyleSample(row, projectId)
  }

  updateStyleSample(id: string, projectId: string, patch: Partial<Pick<StyleSample, 'title' | 'content' | 'guidance' | 'privacyLevel' | 'enabled' | 'deletedAt'>>): StyleSample | null {
    const current = this.getStyleSample(id, projectId)
    if (!current) return null
    this.db.prepare('UPDATE style_samples SET title=?,content=?,guidance=?,privacy_level=?,enabled=?,deleted_at=?,updated_at=? WHERE id=?').run(
      patch.title?.trim() ?? current.title, patch.content ?? current.content, patch.guidance ?? current.guidance, patch.privacyLevel ?? current.privacyLevel,
      patch.enabled === undefined ? (current.enabled ? 1 : 0) : (patch.enabled ? 1 : 0), patch.deletedAt === undefined ? current.deletedAt : patch.deletedAt, nowIso(), id,
    )
    this.logOperation(projectId, 'style_sample', id, patch.deletedAt ? 'trash' : 'update', null, null, 'human')
    return this.getStyleSample(id, projectId)
  }

  setStyleSamplePreference(sampleId: string, projectId: string, enabled: boolean): StyleSample {
    const sample = this.getStyleSample(sampleId, projectId)
    if (!sample || sample.scope !== 'series') throw new Error('Only a visible series sample can have a project preference')
    this.db.prepare(`INSERT INTO style_sample_preferences(sample_id,project_id,enabled,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(sample_id,project_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at`).run(sampleId, projectId, enabled ? 1 : 0, nowIso())
    this.logOperation(projectId, 'style_sample_preference', sampleId, enabled ? 'enable' : 'disable', null, null, 'human')
    return this.getStyleSample(sampleId, projectId)!
  }

  getVoiceProfile(projectId: string, nodeId: string): SceneVoiceProfile {
    const node = this.getNode(nodeId)
    if (!node || node.projectId !== projectId || node.type !== 'scene') throw new Error('Scene not found')
    const sceneRow = this.db.prepare('SELECT * FROM scene_voice_profiles WHERE node_id=?').get(nodeId) as Row | undefined
    if (sceneRow) return this.mapVoiceProfile(projectId, nodeId, sceneRow, 'scene')
    const projectRow = this.db.prepare('SELECT * FROM project_voice_defaults WHERE project_id=?').get(projectId) as Row | undefined
    if (projectRow) return this.mapVoiceProfile(projectId, nodeId, { ...knobsFromRow(projectRow), intents: [] }, 'project')
    return this.mapVoiceProfile(projectId, nodeId, null, 'default')
  }

  getProjectVoiceProfile(projectId: string): SceneVoiceProfile {
    if (!this.getProject(projectId)) throw new Error('Project not found')
    const row = this.db.prepare('SELECT * FROM project_voice_defaults WHERE project_id=?').get(projectId) as Row | undefined
    return this.mapVoiceProfile(projectId, projectId, row ? { ...knobsFromRow(row), intents: [] } : null, row ? 'project' : 'default')
  }

  saveVoiceProfile(projectId: string, nodeId: string, knobs: Partial<VoiceKnobs>): SceneVoiceProfile {
    const current = this.getVoiceProfile(projectId, nodeId)
    const next = normalizeVoiceKnobs({ ...current, ...knobs })
    const time = nowIso()
    this.db.prepare(`INSERT INTO scene_voice_profiles(node_id,project_id,family,intensity,pace,imagery,distance,interiority,intents_json,register,sentence,dialogue,allusion,slang,author_note,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(node_id) DO UPDATE SET family=excluded.family,intensity=excluded.intensity,pace=excluded.pace,imagery=excluded.imagery,distance=excluded.distance,interiority=excluded.interiority,intents_json=excluded.intents_json,register=excluded.register,sentence=excluded.sentence,dialogue=excluded.dialogue,allusion=excluded.allusion,slang=excluded.slang,author_note=excluded.author_note,updated_at=excluded.updated_at`)
      .run(nodeId, projectId, next.family, next.intensity, next.pace, next.imagery, next.distance, next.interiority, JSON.stringify(next.intents), next.register, next.sentence, next.dialogue, next.allusion, next.slang, next.authorNote, time)
    this.logOperation(projectId, 'scene_voice', nodeId, 'update', null, null, 'human')
    return this.getVoiceProfile(projectId, nodeId)
  }

  resetVoiceProfile(projectId: string, nodeId: string): SceneVoiceProfile {
    const node = this.getNode(nodeId)
    if (!node || node.projectId !== projectId || node.type !== 'scene') throw new Error('Scene not found')
    const result = this.db.prepare('DELETE FROM scene_voice_profiles WHERE node_id=? AND project_id=?').run(nodeId, projectId)
    if (Number(result.changes)) this.logOperation(projectId, 'scene_voice', nodeId, 'delete', null, null, 'human')
    return this.getVoiceProfile(projectId, nodeId)
  }

  saveProjectVoiceDefault(projectId: string, knobs: Partial<VoiceKnobs>): SceneVoiceProfile {
    if (!this.getProject(projectId)) throw new Error('Project not found')
    const next = { ...normalizeVoiceKnobs(knobs), intents: [] }
    this.db.prepare(`INSERT INTO project_voice_defaults(project_id,family,intensity,pace,imagery,distance,interiority,intents_json,register,sentence,dialogue,allusion,slang,author_note,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET family=excluded.family,intensity=excluded.intensity,pace=excluded.pace,imagery=excluded.imagery,distance=excluded.distance,interiority=excluded.interiority,intents_json=excluded.intents_json,register=excluded.register,sentence=excluded.sentence,dialogue=excluded.dialogue,allusion=excluded.allusion,slang=excluded.slang,author_note=excluded.author_note,updated_at=excluded.updated_at`)
      .run(projectId, next.family, next.intensity, next.pace, next.imagery, next.distance, next.interiority, JSON.stringify(next.intents), next.register, next.sentence, next.dialogue, next.allusion, next.slang, next.authorNote, nowIso())
    this.logOperation(projectId, 'project_voice', projectId, 'update', null, null, 'human')
    return this.getProjectVoiceProfile(projectId)
  }

  listVoiceProfiles(projectId: string): Array<VoiceKnobs & { nodeId: string; updatedAt: string }> {
    return (this.db.prepare('SELECT * FROM scene_voice_profiles WHERE project_id=?').all(projectId) as Row[]).map((row) => ({
      ...knobsFromRow(row),
      nodeId: String(row.node_id),
      updatedAt: String(row.updated_at),
    }))
  }

  getProjectVoiceDefault(projectId: string): VoiceKnobs | null {
    const row = this.db.prepare('SELECT * FROM project_voice_defaults WHERE project_id=?').get(projectId) as Row | undefined
    return row ? knobsFromRow(row) : null
  }

  analyzeStyleSamples(projectId: string, sampleIds: string[]): StyleAnalysisRun {
    if (!sampleIds.length) throw new Error('请至少选择一份风格样本')
    const samples = sampleIds.map((id) => this.getStyleSample(id, projectId)).filter((item): item is StyleSample => Boolean(item && !item.deletedAt))
    if (samples.length !== new Set(sampleIds).size) throw new Error('风格样本不存在或不属于当前作品')
    const result = analyzeStyleSamples(samples)
    const id = newId(); const createdAt = nowIso()
    this.db.prepare('INSERT INTO style_analysis_runs(id,project_id,sample_ids_json,metrics_json,suggested_json,evidence_json,warnings_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(
      id, projectId, JSON.stringify(sampleIds), JSON.stringify(result.metrics), JSON.stringify(result.suggested), JSON.stringify(result.evidence), JSON.stringify(result.warnings), createdAt,
    )
    this.logOperation(projectId, 'style_analysis', id, 'create', null, null, 'system')
    return { id, projectId, sampleIds, ...result, confirmedAt: null, createdAt }
  }

  confirmStyleAnalysis(projectId: string, runId: string, patch: Partial<VoiceKnobs> = {}): StyleAnalysisRun {
    const run = this.getStyleAnalysis(projectId, runId)
    if (!run) throw new Error('文风分析不存在')
    const suggested = normalizeVoiceKnobs({ ...run.suggested, ...patch })
    this.saveProjectVoiceDefault(projectId, suggested)
    const confirmedAt = nowIso()
    this.db.prepare('UPDATE style_analysis_runs SET suggested_json=?,confirmed_at=? WHERE id=? AND project_id=?').run(JSON.stringify(suggested), confirmedAt, runId, projectId)
    this.logOperation(projectId, 'style_analysis', runId, 'accept', null, null, 'human')
    return { ...run, suggested, confirmedAt }
  }

  getStyleAnalysis(projectId: string, runId: string): StyleAnalysisRun | null {
    const row = this.db.prepare('SELECT * FROM style_analysis_runs WHERE id=? AND project_id=?').get(runId, projectId) as Row | undefined
    return row ? mapStyleAnalysis(row) : null
  }

  listStyleAnalyses(projectId: string): StyleAnalysisRun[] {
    return (this.db.prepare('SELECT * FROM style_analysis_runs WHERE project_id=? ORDER BY created_at DESC').all(projectId) as Row[]).map(mapStyleAnalysis)
  }

  getVoiceConsistency(projectId: string, nodeId: string): VoiceConsistencyReport {
    const scene = this.getScene(nodeId); const node = this.getNode(nodeId)
    if (!scene || !node || node.projectId !== projectId) throw new Error('Scene not found')
    return evaluateVoiceConsistency(scene.plainText, this.getVoiceProfile(projectId, nodeId))
  }

  getCharacterVoice(projectId: string, entityId: string): CharacterVoiceProfile {
    const entity = this.getEntity(entityId)
    if (!entity || entity.projectId !== projectId || entity.type !== 'character') throw new Error('Character not found')
    const row = this.db.prepare('SELECT * FROM character_voice_profiles WHERE entity_id=?').get(entityId) as Row | undefined
    const knobs = normalizeCharacterVoice(row ? {
      register: row.register as CharacterVoiceKnobs['register'], sentence: row.sentence as CharacterVoiceKnobs['sentence'],
      directness: row.directness as CharacterVoiceKnobs['directness'], emotion: row.emotion as CharacterVoiceKnobs['emotion'],
      signature: String(row.signature), avoid: String(row.avoid),
    } : null)
    return { ...knobs, entityId, projectId, entityName: entity.canonicalName, updatedAt: row ? String(row.updated_at) : null }
  }

  saveCharacterVoice(projectId: string, entityId: string, patch: Partial<CharacterVoiceKnobs>): CharacterVoiceProfile {
    const current = this.getCharacterVoice(projectId, entityId); const next = normalizeCharacterVoice({ ...current, ...patch }); const updatedAt = nowIso()
    this.db.prepare(`INSERT INTO character_voice_profiles(entity_id,project_id,register,sentence,directness,emotion,signature,avoid,updated_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(entity_id) DO UPDATE SET register=excluded.register,sentence=excluded.sentence,directness=excluded.directness,emotion=excluded.emotion,signature=excluded.signature,avoid=excluded.avoid,updated_at=excluded.updated_at`).run(
      entityId, projectId, next.register, next.sentence, next.directness, next.emotion, next.signature, next.avoid, updatedAt,
    )
    this.logOperation(projectId, 'character_voice', entityId, 'update', null, null, 'human')
    return this.getCharacterVoice(projectId, entityId)
  }

  listCharacterVoices(projectId: string): CharacterVoiceProfile[] {
    return (this.db.prepare('SELECT entity_id FROM character_voice_profiles WHERE project_id=? ORDER BY updated_at DESC').all(projectId) as Row[]).map((row) => this.getCharacterVoice(projectId, String(row.entity_id)))
  }

  characterVoiceContract(projectId: string, entityId: string): string {
    const profile = this.getCharacterVoice(projectId, entityId)
    return compileCharacterVoiceContract(profile.entityName, profile)
  }

  recordVoicePreference(projectId: string, family: VoiceKnobs['family'], taskType: string, decision: 'accepted' | 'rejected' | 'undone') {
    const column = decision === 'accepted' ? 'accepted' : decision === 'rejected' ? 'rejected' : 'undone'
    this.db.prepare(`INSERT INTO voice_preference_stats(project_id,family,task_type,accepted,rejected,undone,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(project_id,family,task_type) DO UPDATE SET ${column}=${column}+1,updated_at=excluded.updated_at`).run(
      projectId, family, taskType, decision === 'accepted' ? 1 : 0, decision === 'rejected' ? 1 : 0, decision === 'undone' ? 1 : 0, nowIso(),
    )
  }

  listVoicePreferences(projectId: string): VoicePreferenceSummary[] {
    return (this.db.prepare('SELECT * FROM voice_preference_stats WHERE project_id=? ORDER BY updated_at DESC').all(projectId) as Row[]).map((row) => ({
      family: row.family as VoicePreferenceSummary['family'], taskType: String(row.task_type), accepted: Number(row.accepted), rejected: Number(row.rejected), undone: Number(row.undone), updatedAt: String(row.updated_at),
    }))
  }

  clearVoicePreferences(projectId: string): boolean {
    const result = this.db.prepare('DELETE FROM voice_preference_stats WHERE project_id=?').run(projectId)
    if (Number(result.changes)) this.logOperation(projectId, 'voice_preference', projectId, 'clear', null, null, 'human')
    return Boolean(result.changes)
  }

  private mapVoiceProfile(projectId: string, nodeId: string, row: Row | VoiceKnobs | null, source: VoiceSource): SceneVoiceProfile {
    const knobs = knobsFromRow(row)
    return {
      ...knobs,
      nodeId,
      projectId,
      inherited: source !== 'scene',
      source,
      sourceLabel: voiceSourceLabel(source),
      contract: compileVoiceContract(knobs),
      updatedAt: row && typeof row === 'object' && 'updated_at' in row ? String((row as Row).updated_at) : null,
    }
  }

  getReadAloudPreferences(projectId: string): ReadAloudPreferences {
    if (!this.getProject(projectId)) throw new Error('Project not found')
    const row = this.db.prepare('SELECT * FROM read_aloud_preferences WHERE project_id=?').get(projectId) as Row | undefined
    return row ? mapReadAloudPreferences(row) : { projectId, voiceUri: '', rate: 1, pitch: 1, updatedAt: '' }
  }

  saveReadAloudPreferences(projectId: string, patch: { voiceUri?: string; rate?: number; pitch?: number }): ReadAloudPreferences {
    const current = this.getReadAloudPreferences(projectId)
    const voiceUri = patch.voiceUri ?? current.voiceUri
    const rate = Math.max(0.5, Math.min(2, patch.rate ?? current.rate))
    const pitch = Math.max(0.5, Math.min(2, patch.pitch ?? current.pitch))
    const updatedAt = nowIso()
    this.db.prepare(`INSERT INTO read_aloud_preferences(project_id,voice_uri,rate,pitch,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(project_id) DO UPDATE SET voice_uri=excluded.voice_uri,rate=excluded.rate,pitch=excluded.pitch,updated_at=excluded.updated_at`).run(projectId, voiceUri, rate, pitch, updatedAt)
    this.logOperation(projectId, 'read_aloud_preferences', projectId, 'update', null, null, 'human')
    return this.getReadAloudPreferences(projectId)
  }

  listDeliveryTemplates(projectId: string): DeliveryTemplate[] {
    if (!this.getProject(projectId)) throw new Error('Project not found')
    const templates = this.db.prepare('SELECT * FROM delivery_templates WHERE enabled=1 AND deleted_at IS NULL ORDER BY channel,name').all() as Row[]
    return templates.map((template) => {
      const rules = (this.db.prepare(`SELECT r.*,o.enabled AS override_enabled,o.config_json AS override_config_json
        FROM delivery_rules r LEFT JOIN project_delivery_rule_overrides o ON o.rule_id=r.id AND o.project_id=?
        WHERE r.template_id=? ORDER BY r.sort_key,r.code`).all(projectId, String(template.id)) as Row[]).map(mapDeliveryRule)
      return mapDeliveryTemplate(template, rules)
    })
  }

  setDeliveryRuleOverride(projectId: string, ruleId: string, enabled: boolean, config: Record<string, unknown> = {}): DeliveryRule {
    if (!this.getProject(projectId)) throw new Error('Project not found')
    if (!this.db.prepare('SELECT 1 FROM delivery_rules WHERE id=?').get(ruleId)) throw new Error('Delivery rule not found')
    this.db.prepare(`INSERT INTO project_delivery_rule_overrides(project_id,rule_id,enabled,config_json,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(project_id,rule_id) DO UPDATE SET enabled=excluded.enabled,config_json=excluded.config_json,updated_at=excluded.updated_at`).run(projectId, ruleId, enabled ? 1 : 0, JSON.stringify(config), nowIso())
    this.logOperation(projectId, 'delivery_rule_override', ruleId, enabled ? 'enable' : 'disable', null, null, 'human')
    const rule = this.listDeliveryTemplates(projectId).flatMap((template) => template.rules).find((item) => item.id === ruleId)
    if (!rule) throw new Error('Delivery rule not found')
    return rule
  }

  listDeliveryRuleOverrides(projectId: string): Array<{ ruleId: string; ruleCode: string; enabled: boolean; config: Record<string, unknown> }> {
    return (this.db.prepare(`SELECT o.rule_id,r.code,o.enabled,o.config_json FROM project_delivery_rule_overrides o JOIN delivery_rules r ON r.id=o.rule_id WHERE o.project_id=? ORDER BY r.code`).all(projectId) as Row[]).map((row) => ({ ruleId: String(row.rule_id), ruleCode: String(row.code), enabled: Boolean(row.enabled), config: jsonParse(String(row.config_json), {}) }))
  }

  getDeliveryRuleByCode(projectId: string, code: string): DeliveryRule | null {
    return this.listDeliveryTemplates(projectId).flatMap((template) => template.rules).find((rule) => rule.code === code) ?? null
  }

  saveDeliveryCheckRun(projectId: string, templateId: string, chapterIds: string[], results: DeliveryCheckResult[], createdAt = nowIso()): DeliveryCheckRun {
    if (!this.getProject(projectId)) throw new Error('Project not found')
    if (!this.db.prepare('SELECT 1 FROM delivery_templates WHERE id=?').get(templateId)) throw new Error('Delivery template not found')
    const id = newId()
    this.db.prepare('INSERT INTO delivery_check_runs(id,project_id,template_id,chapter_ids_json,results_json,created_at) VALUES(?,?,?,?,?,?)').run(id, projectId, templateId, JSON.stringify(chapterIds), JSON.stringify(results), createdAt)
    this.logOperation(projectId, 'delivery_check', id, 'run', null, null, 'human')
    return { id, projectId, templateId, chapterIds, results, createdAt }
  }

  listDeliveryCheckRuns(projectId: string): DeliveryCheckRun[] {
    return (this.db.prepare('SELECT * FROM delivery_check_runs WHERE project_id=? ORDER BY created_at DESC,rowid DESC').all(projectId) as Row[]).map(mapDeliveryCheckRun)
  }

  listProvenanceEvents(projectId: string, nodeId?: string | null): ProvenanceEvent[] {
    if (!this.getProject(projectId)) throw new Error('Project not found')
    const rows = this.db.prepare(`SELECT p.*,n.title AS node_title,r.parent_revision_id,r.provenance_label
      FROM provenance_events p
      LEFT JOIN manuscript_nodes n ON n.id=p.node_id
      LEFT JOIN revisions r ON r.id=p.revision_id
      WHERE p.project_id=? ${nodeId ? 'AND p.node_id=?' : ''}
      ORDER BY p.created_at,p.rowid`).all(...(nodeId ? [projectId, nodeId] : [projectId])) as Row[]
    return rows.map(mapProvenanceEvent)
  }

  recordProvenanceEvent(input: {
    projectId: string
    nodeId?: string | null
    revisionId?: string | null
    eventType: ProvenanceEventType
    actorType: ProvenanceEvent['actorType']
    sourceTaskId?: string | null
    sourceRevisionId?: string | null
    contentHash?: string
    metadata?: Record<string, unknown>
    createdAt?: string
  }): ProvenanceEvent {
    if (!this.getProject(input.projectId)) throw new Error('Project not found')
    const previous = this.db.prepare('SELECT event_hash FROM provenance_events WHERE project_id=? ORDER BY rowid DESC LIMIT 1').get(input.projectId) as Row | undefined
    const previousHash = previous ? String(previous.event_hash) : null
    const createdAt = input.createdAt ?? nowIso(); const metadata = input.metadata ?? {}; const id = newId()
    const eventHash = provenanceEventHash({ eventType: input.eventType, actorType: input.actorType, contentHash: input.contentHash ?? '', metadata, previousHash, createdAt })
    this.db.prepare(`INSERT INTO provenance_events(id,project_id,node_id,revision_id,event_type,actor_type,source_task_id,source_revision_id,content_hash,metadata_json,previous_hash,event_hash,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.projectId, input.nodeId ?? null, input.revisionId ?? null, input.eventType, input.actorType, input.sourceTaskId ?? null, input.sourceRevisionId ?? null, input.contentHash ?? '', JSON.stringify(metadata), previousHash, eventHash, createdAt)
    return this.listProvenanceEvents(input.projectId).find((event) => event.id === id)!
  }

  recordProvenanceExport(projectId: string, manifestHash: string, eventCount: number, includedText: boolean): ProvenanceExportRecord {
    if (!this.getProject(projectId)) throw new Error('Project not found')
    const record = { id: newId(), projectId, formatVersion: 'bbd-provenance-v1', manifestHash, eventCount, includedText, createdAt: nowIso() }
    this.db.prepare('INSERT INTO provenance_exports(id,project_id,format_version,manifest_hash,event_count,included_text,created_at) VALUES(?,?,?,?,?,?,?)').run(record.id, projectId, record.formatVersion, manifestHash, eventCount, includedText ? 1 : 0, record.createdAt)
    return record
  }

  listProvenanceExports(projectId: string): ProvenanceExportRecord[] {
    return (this.db.prepare('SELECT * FROM provenance_exports WHERE project_id=? ORDER BY created_at DESC,rowid DESC').all(projectId) as Row[]).map(mapProvenanceExport)
  }

  replaceProvenanceForRestore(projectId: string, events: ProvenanceEvent[], exports: ProvenanceExportRecord[], maps: { nodes: Map<string, string>; revisions: Map<string, string>; tasks: Map<string, string> }) {
    let previousHash: string | null = null
    for (const event of events) {
      const expectedHash = provenanceEventHash({ eventType: event.eventType, actorType: event.actorType, contentHash: event.contentHash, metadata: event.metadata, previousHash: event.previousHash, createdAt: event.createdAt })
      if (event.previousHash !== previousHash || event.eventHash !== expectedHash) throw new Error('备份中的创作来源链校验失败')
      previousHash = event.eventHash
    }
    this.db.prepare('DELETE FROM provenance_events WHERE project_id=?').run(projectId)
    this.db.prepare('DELETE FROM provenance_exports WHERE project_id=?').run(projectId)
    for (const event of events) {
      this.db.prepare(`INSERT INTO provenance_events(id,project_id,node_id,revision_id,event_type,actor_type,source_task_id,source_revision_id,content_hash,metadata_json,previous_hash,event_hash,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        newId(), projectId, event.nodeId ? maps.nodes.get(event.nodeId) ?? null : null, event.revisionId ? maps.revisions.get(event.revisionId) ?? null : null,
        event.eventType, event.actorType, event.sourceTaskId ? maps.tasks.get(event.sourceTaskId) ?? null : null, event.sourceRevisionId ? maps.revisions.get(event.sourceRevisionId) ?? null : null,
        event.contentHash, JSON.stringify(event.metadata), event.previousHash, event.eventHash, event.createdAt,
      )
    }
    for (const record of exports) this.db.prepare('INSERT INTO provenance_exports(id,project_id,format_version,manifest_hash,event_count,included_text,created_at) VALUES(?,?,?,?,?,?,?)').run(newId(), projectId, record.formatVersion, record.manifestHash, record.eventCount, record.includedText ? 1 : 0, record.createdAt)
  }

  private revisionProvenanceLabel(parentRevisionId: string | null, sourceType: Revision['sourceType']): ProvenanceLabel {
    if (sourceType !== 'human') return sourceType === 'ai_accepted' ? 'ai_accepted' : sourceType
    if (!parentRevisionId) return 'human'
    const aiAncestor = this.db.prepare(`WITH RECURSIVE lineage(id,parent_revision_id,source_type) AS (
      SELECT id,parent_revision_id,source_type FROM revisions WHERE id=?
      UNION ALL SELECT r.id,r.parent_revision_id,r.source_type FROM revisions r JOIN lineage l ON r.id=l.parent_revision_id
    ) SELECT 1 FROM lineage WHERE source_type='ai_accepted' LIMIT 1`).get(parentRevisionId)
    return aiAncestor ? 'human_after_ai' : 'human'
  }

  private backfillProvenance() {
    const revisions = this.db.prepare(`SELECT r.*,n.project_id FROM revisions r JOIN manuscript_nodes n ON n.id=r.node_id ORDER BY r.created_at,r.rowid`).all() as Row[]
    const revisionRows = new Map(revisions.map((row) => [String(row.id), row]))
    const labelFor = (row: Row): ProvenanceLabel => {
      const source = String(row.source_type) as Revision['sourceType']
      if (source !== 'human') return source === 'ai_accepted' ? 'ai_accepted' : source
      let parentId = row.parent_revision_id ? String(row.parent_revision_id) : ''
      while (parentId) { const parent = revisionRows.get(parentId); if (!parent) break; if (parent.source_type === 'ai_accepted') return 'human_after_ai'; parentId = parent.parent_revision_id ? String(parent.parent_revision_id) : '' }
      return 'human'
    }
    type Backfill = Parameters<AppDatabase['recordProvenanceEvent']>[0] & { order: string }
    const byProject = new Map<string, Backfill[]>()
    const push = (projectId: string, event: Backfill) => byProject.set(projectId, [...(byProject.get(projectId) ?? []), event])
    for (const row of revisions) {
      const label = labelFor(row); this.db.prepare('UPDATE revisions SET provenance_label=? WHERE id=?').run(label, String(row.id))
      push(String(row.project_id), { projectId: String(row.project_id), nodeId: String(row.node_id), revisionId: String(row.id), eventType: revisionEventType(label), actorType: label === 'ai_accepted' ? 'ai' : label === 'human' || label === 'human_after_ai' ? 'human' : 'system', sourceRevisionId: row.parent_revision_id ? String(row.parent_revision_id) : null, contentHash: String(row.content_hash), metadata: { sourceType: String(row.source_type), provenanceLabel: label, legacyProjection: true }, createdAt: String(row.created_at), order: `1:${String(row.id)}` })
    }
    for (const row of this.db.prepare('SELECT * FROM ai_tasks ORDER BY created_at,rowid').all() as Row[]) push(String(row.project_id), { projectId: String(row.project_id), nodeId: row.node_id ? String(row.node_id) : null, eventType: row.status === 'completed' ? 'ai_generated' : 'ai_failed', actorType: 'ai', sourceTaskId: String(row.id), contentHash: row.output_hash ? String(row.output_hash) : '', metadata: { taskType: String(row.task_type), promptVersion: String(row.prompt_version), model: String(row.model), status: String(row.status), contextHash: String(row.context_hash), inputTokens: Number(row.input_tokens), outputTokens: Number(row.output_tokens) }, createdAt: String(row.created_at), order: `2:${String(row.id)}` })
    for (const row of this.db.prepare('SELECT * FROM candidate_changes ORDER BY created_at,rowid').all() as Row[]) {
      const projectId = String(row.project_id); const metadata = { targetType: String(row.target_type), operation: String(row.operation), confidence: Number(row.confidence) }
      push(projectId, { projectId, nodeId: row.node_id ? String(row.node_id) : null, eventType: 'candidate_created', actorType: row.source_task_id ? 'ai' : 'system', sourceTaskId: row.source_task_id ? String(row.source_task_id) : null, contentHash: sha256(String(row.after_json ?? '')), metadata, createdAt: String(row.created_at), order: `3:${String(row.id)}` })
      if (row.resolved_at) push(projectId, { projectId, nodeId: row.node_id ? String(row.node_id) : null, eventType: ['accepted','accepted_modified'].includes(String(row.status)) ? 'candidate_accepted' : 'candidate_rejected', actorType: 'human', sourceTaskId: row.source_task_id ? String(row.source_task_id) : null, contentHash: sha256(String(row.after_json ?? '')), metadata: { ...metadata, status: String(row.status) }, createdAt: String(row.resolved_at), order: `4:${String(row.id)}` })
    }
    for (const row of this.db.prepare('SELECT * FROM imported_sources ORDER BY created_at,rowid').all() as Row[]) push(String(row.project_id), { projectId: String(row.project_id), eventType: 'import', actorType: 'system', contentHash: String(row.content_hash), metadata: { sourceKind: 'original_file', mimeType: String(row.mime_type), byteSize: Number(row.byte_size) }, createdAt: String(row.created_at), order: `5:${String(row.id)}` })
    for (const row of this.db.prepare('SELECT * FROM replace_batches ORDER BY created_at,rowid').all() as Row[]) {
      const projectId = String(row.project_id); const metadata = { scopes: jsonParse(String(row.scopes_json), []), changeCount: jsonParse<unknown[]>(String(row.changes_json), []).length }
      push(projectId, { projectId, eventType: 'replace', actorType: 'human', contentHash: sha256(String(row.changes_json)), metadata, createdAt: String(row.created_at), order: `6:${String(row.id)}` })
      if (row.undone_at) push(projectId, { projectId, eventType: 'replace_undone', actorType: 'human', contentHash: sha256(String(row.changes_json)), metadata, createdAt: String(row.undone_at), order: `7:${String(row.id)}` })
    }
    for (const events of byProject.values()) for (const event of events.sort((a, b) => `${a.createdAt}:${a.order}`.localeCompare(`${b.createdAt}:${b.order}`))) { const { order: _order, ...input } = event; this.recordProvenanceEvent(input) }
  }

  private requireSeriesMember(seriesId: string, projectId: string) {
    if (!this.db.prepare('SELECT 1 FROM series_projects WHERE series_id=? AND project_id=?').get(seriesId, projectId)) throw new Error('Project is not a member of this series')
  }

  private mapSeries(row: Row): Series {
    const members = (this.db.prepare('SELECT sp.project_id,p.title,sp.added_at FROM series_projects sp JOIN projects p ON p.id=sp.project_id WHERE sp.series_id=? ORDER BY sp.added_at,sp.rowid').all(String(row.id)) as Row[]).map((item) => ({ projectId: String(item.project_id), title: String(item.title), addedAt: String(item.added_at) }))
    return { id: String(row.id), name: String(row.name), description: String(row.description), createdAt: String(row.created_at), updatedAt: String(row.updated_at), deletedAt: row.deleted_at ? String(row.deleted_at) : null, members }
  }

  private mapSeriesCanon(row: Row, projectId: string): SeriesCanonEntry {
    const overrideRow = this.db.prepare('SELECT * FROM series_canon_overrides WHERE entry_id=? AND project_id=?').get(String(row.id), projectId) as Row | undefined
    const override = overrideRow ? mapSeriesCanonOverride(overrideRow) : null
    return { id: String(row.id), seriesId: String(row.series_id), type: row.type as Entity['type'], canonicalName: String(row.canonical_name), aliases: jsonParse(String(row.aliases_json), []), summary: String(row.summary), privacyLevel: row.privacy_level as Entity['privacyLevel'], createdAt: String(row.created_at), updatedAt: String(row.updated_at), deletedAt: row.deleted_at ? String(row.deleted_at) : null, override }
  }

  private mapStyleSample(row: Row, projectId: string): StyleSample {
    const preference = row.series_id ? this.db.prepare('SELECT enabled FROM style_sample_preferences WHERE sample_id=? AND project_id=?').get(String(row.id), projectId) as Row | undefined : undefined
    const enabled = Boolean(row.enabled)
    return { id: String(row.id), scope: row.series_id ? 'series' : 'project', projectId: row.project_id ? String(row.project_id) : null, seriesId: row.series_id ? String(row.series_id) : null, title: String(row.title), content: String(row.content), guidance: String(row.guidance), privacyLevel: row.privacy_level as StyleSample['privacyLevel'], enabled, effectiveEnabled: preference ? Boolean(preference.enabled) : enabled, createdAt: String(row.created_at), updatedAt: String(row.updated_at), deletedAt: row.deleted_at ? String(row.deleted_at) : null }
  }

  createEntity(input: Pick<Entity, 'projectId' | 'type' | 'canonicalName'> & Partial<Pick<Entity, 'aliases' | 'summary' | 'privacyLevel'>>): Entity {
    const id = newId()
    const time = nowIso()
    this.db.prepare(`INSERT INTO entities(id,project_id,type,canonical_name,normalized_name,aliases_json,summary,privacy_level,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      id, input.projectId, input.type, input.canonicalName.trim(), normalizeName(input.canonicalName), JSON.stringify(input.aliases ?? []), input.summary ?? '', input.privacyLevel ?? 'normal', time, time,
    )
    this.touchProject(input.projectId)
    this.logOperation(input.projectId, 'entity', id, 'create', null, null, 'human')
    return this.getEntity(id)!
  }

  listEntities(projectId: string, includeDeleted = false): Entity[] {
    return (this.db.prepare(`SELECT * FROM entities WHERE project_id=? ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY type, normalized_name`).all(projectId) as Row[]).map(mapEntity)
  }

  getEntity(id: string): Entity | null {
    const row = this.db.prepare('SELECT * FROM entities WHERE id=?').get(id) as Row | undefined
    return row ? mapEntity(row) : null
  }

  updateEntity(id: string, patch: Partial<Pick<Entity, 'canonicalName' | 'aliases' | 'summary' | 'privacyLevel' | 'deletedAt'>>): Entity | null {
    const current = this.getEntity(id)
    if (!current) return null
    this.db.prepare(`UPDATE entities SET canonical_name=?,normalized_name=?,aliases_json=?,summary=?,privacy_level=?,deleted_at=?,updated_at=? WHERE id=?`).run(
      patch.canonicalName ?? current.canonicalName,
      normalizeName(patch.canonicalName ?? current.canonicalName),
      JSON.stringify(patch.aliases ?? current.aliases),
      patch.summary ?? current.summary,
      patch.privacyLevel ?? current.privacyLevel,
      patch.deletedAt === undefined ? current.deletedAt : patch.deletedAt,
      nowIso(), id,
    )
    this.touchProject(current.projectId)
    this.logOperation(current.projectId, 'entity', id, 'update', null, null, 'human')
    return this.getEntity(id)
  }

  createState(input: Omit<EntityState, 'id' | 'createdAt'>): EntityState {
    const entity = this.getEntity(input.entityId)
    if (!entity) throw new Error('Entity not found')
    const existing = this.listStates(input.entityId).filter((state) => state.attributeKey === input.attributeKey)
    if (existing.some((state) => intervalsOverlap(state.worldTimeFrom, state.worldTimeTo, input.worldTimeFrom, input.worldTimeTo))) {
      throw new Error('State interval overlaps an existing value')
    }
    const id = newId()
    const createdAt = nowIso()
    this.transaction(() => {
      this.db.prepare(`INSERT INTO entity_states(id,entity_id,attribute_key,value_json,valid_from_node_id,valid_to_node_id,world_time_from,world_time_to,source_mention_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        id, input.entityId, input.attributeKey, JSON.stringify(input.value), input.validFromNodeId, input.validToNodeId, input.worldTimeFrom, input.worldTimeTo, input.sourceMentionId, createdAt,
      )
      this.logOperation(entity.projectId, 'state', id, 'create', null, null, 'human')
    })
    return this.getState(id)!
  }

  getState(id: string): EntityState | null {
    const row = this.db.prepare('SELECT * FROM entity_states WHERE id=?').get(id) as Row | undefined
    return row ? mapState(row) : null
  }

  listStates(entityId: string): EntityState[] {
    return (this.db.prepare('SELECT * FROM entity_states WHERE entity_id=? ORDER BY world_time_from, created_at').all(entityId) as Row[]).map(mapState)
  }

  listProfileFields(entityId: string): EntityProfileField[] {
    return (this.db.prepare('SELECT * FROM entity_profile_fields WHERE entity_id=? ORDER BY sort_key,created_at').all(entityId) as Row[]).map(mapProfileField)
  }

  createProfileField(input: Omit<EntityProfileField, 'id' | 'createdAt' | 'updatedAt' | 'sortKey'> & { sortKey?: number }): EntityProfileField {
    const entity = this.getEntity(input.entityId)
    if (!entity) throw new Error('Entity not found')
    const id = newId(); const time = nowIso()
    const sortKey = input.sortKey ?? Number((this.db.prepare('SELECT COALESCE(MAX(sort_key),0)+1000 AS next FROM entity_profile_fields WHERE entity_id=?').get(input.entityId) as Row).next)
    this.db.prepare('INSERT INTO entity_profile_fields(id,entity_id,category,label,value,sort_key,privacy_level,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(
      id, input.entityId, input.category.trim(), input.label.trim(), input.value, sortKey, input.privacyLevel, time, time,
    )
    this.touchProject(entity.projectId)
    this.logOperation(entity.projectId, 'profile_field', id, 'create', null, null, 'human')
    return this.getProfileField(id)!
  }

  getProfileField(id: string): EntityProfileField | null {
    const row = this.db.prepare('SELECT * FROM entity_profile_fields WHERE id=?').get(id) as Row | undefined
    return row ? mapProfileField(row) : null
  }

  updateProfileField(id: string, patch: Partial<Pick<EntityProfileField, 'category' | 'label' | 'value' | 'sortKey' | 'privacyLevel'>>): EntityProfileField | null {
    const current = this.getProfileField(id)
    if (!current) return null
    const entity = this.getEntity(current.entityId)
    this.db.prepare('UPDATE entity_profile_fields SET category=?,label=?,value=?,sort_key=?,privacy_level=?,updated_at=? WHERE id=?').run(
      patch.category?.trim() ?? current.category, patch.label?.trim() ?? current.label, patch.value ?? current.value, patch.sortKey ?? current.sortKey, patch.privacyLevel ?? current.privacyLevel, nowIso(), id,
    )
    if (entity) { this.touchProject(entity.projectId); this.logOperation(entity.projectId, 'profile_field', id, 'update', null, null, 'human') }
    return this.getProfileField(id)
  }

  deleteProfileField(id: string): boolean {
    const field = this.getProfileField(id); if (!field) return false
    const entity = this.getEntity(field.entityId)
    this.db.prepare('DELETE FROM entity_profile_fields WHERE id=?').run(id)
    if (entity) { this.touchProject(entity.projectId); this.logOperation(entity.projectId, 'profile_field', id, 'delete', null, null, 'human') }
    return true
  }

  createRelationship(input: Omit<EntityRelationship, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'states' | 'currentState'>): EntityRelationship {
    const source = this.getEntity(input.sourceEntityId); const target = this.getEntity(input.targetEntityId)
    if (!source || !target || source.projectId !== input.projectId || target.projectId !== input.projectId) throw new Error('Relationship entities must belong to this project')
    if (source.id === target.id) throw new Error('Relationship cannot link an entity to itself')
    const duplicate = input.direction === 'mutual'
      ? this.db.prepare("SELECT 1 FROM entity_relationships WHERE project_id=? AND relation_type=? AND direction='mutual' AND deleted_at IS NULL AND ((source_entity_id=? AND target_entity_id=?) OR (source_entity_id=? AND target_entity_id=?))").get(input.projectId, input.relationType, source.id, target.id, target.id, source.id)
      : this.db.prepare("SELECT 1 FROM entity_relationships WHERE project_id=? AND relation_type=? AND direction='directed' AND source_entity_id=? AND target_entity_id=? AND deleted_at IS NULL").get(input.projectId, input.relationType, source.id, target.id)
    if (duplicate) throw new Error('Relationship already exists')
    const id = newId(); const time = nowIso()
    this.db.prepare('INSERT INTO entity_relationships(id,project_id,source_entity_id,target_entity_id,relation_type,direction,label,summary,privacy_level,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
      id, input.projectId, source.id, target.id, input.relationType.trim(), input.direction, input.label.trim(), input.summary, input.privacyLevel, time, time,
    )
    this.touchProject(input.projectId); this.logOperation(input.projectId, 'relationship', id, 'create', null, null, 'human')
    return this.getRelationship(id)!
  }

  getRelationship(id: string, atNodeId: string | null = null): EntityRelationship | null {
    const row = this.db.prepare('SELECT * FROM entity_relationships WHERE id=?').get(id) as Row | undefined
    if (!row) return null
    return this.mapRelationship(row, atNodeId)
  }

  listRelationships(projectId: string, entityId: string | null = null, atNodeId: string | null = null, includeDeleted = false): EntityRelationship[] {
    const rows = entityId
      ? this.db.prepare(`SELECT * FROM entity_relationships WHERE project_id=? AND (source_entity_id=? OR target_entity_id=?) ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY updated_at DESC,rowid DESC`).all(projectId, entityId, entityId)
      : this.db.prepare(`SELECT * FROM entity_relationships WHERE project_id=? ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY updated_at DESC,rowid DESC`).all(projectId)
    return (rows as Row[]).map((row) => this.mapRelationship(row, atNodeId))
  }

  updateRelationship(id: string, patch: Partial<Pick<EntityRelationship, 'relationType' | 'direction' | 'label' | 'summary' | 'privacyLevel' | 'deletedAt'>>): EntityRelationship | null {
    const current = this.getRelationship(id)
    if (!current) return null
    this.db.prepare('UPDATE entity_relationships SET relation_type=?,direction=?,label=?,summary=?,privacy_level=?,deleted_at=?,updated_at=? WHERE id=?').run(
      patch.relationType?.trim() ?? current.relationType, patch.direction ?? current.direction, patch.label?.trim() ?? current.label, patch.summary ?? current.summary, patch.privacyLevel ?? current.privacyLevel, patch.deletedAt === undefined ? current.deletedAt : patch.deletedAt, nowIso(), id,
    )
    this.touchProject(current.projectId); this.logOperation(current.projectId, 'relationship', id, 'update', null, null, 'human')
    return this.getRelationship(id)
  }

  createRelationshipState(input: Omit<RelationshipState, 'id' | 'createdAt'>): RelationshipState {
    const relationship = this.getRelationship(input.relationshipId)
    if (!relationship) throw new Error('Relationship not found')
    if (input.validFromNodeId && (this.getNode(input.validFromNodeId)?.projectId !== relationship.projectId || this.getNode(input.validFromNodeId)?.type !== 'scene')) throw new Error('Relationship state scene belongs to another project')
    if (input.validToNodeId && (this.getNode(input.validToNodeId)?.projectId !== relationship.projectId || this.getNode(input.validToNodeId)?.type !== 'scene')) throw new Error('Relationship state scene belongs to another project')
    if (input.sourceNodeId && this.getNode(input.sourceNodeId)?.projectId !== relationship.projectId) throw new Error('Relationship evidence scene belongs to another project')
    const id = newId(); const createdAt = nowIso()
    const nodes = this.listNodes(relationship.projectId); const order = narrativeSceneOrder(nodes)
    if (input.worldTimeFrom && input.worldTimeTo && input.worldTimeFrom >= input.worldTimeTo) throw new Error('Relationship state interval is invalid')
    if (input.validFromNodeId && input.validToNodeId && (order.get(input.validFromNodeId) ?? Number.MAX_SAFE_INTEGER) >= (order.get(input.validToNodeId) ?? -1)) throw new Error('Relationship state interval is invalid')
    this.transaction(() => {
      const before = this.listRelationshipStates(input.relationshipId)
      if (input.worldTimeFrom) {
        const previous = before.filter((state) => (state.worldTimeFrom || state.worldTimeTo) && !state.worldTimeTo && (state.worldTimeFrom ?? '') < input.worldTimeFrom!).at(-1)
        if (previous) this.db.prepare('UPDATE relationship_states SET world_time_to=? WHERE id=?').run(input.worldTimeFrom, previous.id)
      } else if (input.validFromNodeId) {
        const nextStart = order.get(input.validFromNodeId) ?? Number.MAX_SAFE_INTEGER
        const previous = before.filter((state) => !state.worldTimeFrom && !state.worldTimeTo && !state.validToNodeId && (state.validFromNodeId ? order.get(state.validFromNodeId) ?? Number.MAX_SAFE_INTEGER : -1) < nextStart).at(-1)
        if (previous) this.db.prepare('UPDATE relationship_states SET valid_to_node_id=? WHERE id=?').run(input.validFromNodeId, previous.id)
      }
      const states = this.listRelationshipStates(input.relationshipId)
      if (states.some((state) => relationshipStateIntervalsOverlap(state, input, nodes))) throw new Error('Relationship state interval overlaps an existing value')
      this.db.prepare('INSERT INTO relationship_states(id,relationship_id,status_label,note,valid_from_node_id,valid_to_node_id,world_time_from,world_time_to,source_node_id,evidence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
        id, input.relationshipId, input.statusLabel.trim(), input.note, input.validFromNodeId, input.validToNodeId, input.worldTimeFrom, input.worldTimeTo, input.sourceNodeId, input.evidence, createdAt,
      )
      this.db.prepare('UPDATE entity_relationships SET updated_at=? WHERE id=?').run(createdAt, input.relationshipId)
      this.touchProject(relationship.projectId); this.logOperation(relationship.projectId, 'relationship_state', id, 'create', null, null, 'human')
    })
    return this.getRelationshipState(id)!
  }

  getRelationshipState(id: string): RelationshipState | null {
    const row = this.db.prepare('SELECT * FROM relationship_states WHERE id=?').get(id) as Row | undefined
    return row ? mapRelationshipState(row) : null
  }

  listRelationshipStates(relationshipId: string): RelationshipState[] {
    return (this.db.prepare('SELECT * FROM relationship_states WHERE relationship_id=? ORDER BY world_time_from,created_at').all(relationshipId) as Row[]).map(mapRelationshipState)
  }

  private mapRelationship(row: Row, atNodeId: string | null): EntityRelationship {
    const states = this.listRelationshipStates(String(row.id))
    const currentState = resolveRelationshipState(states, atNodeId, atNodeId ? this.listNodes(String(row.project_id)) : [])
    return { ...mapRelationshipBase(row), states, currentState }
  }

  createMention(input: Omit<Mention, 'id' | 'createdAt'>): Mention {
    const id = newId()
    const createdAt = nowIso()
    this.db.prepare(`INSERT INTO mentions(id,entity_id,node_id,quote,start_offset,end_offset,confirmed,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(
      id, input.entityId, input.nodeId, input.quote, input.startOffset, input.endOffset, input.confirmed ? 1 : 0, createdAt,
    )
    return { ...input, id, createdAt }
  }

  listMentions(nodeId: string): Mention[] {
    return (this.db.prepare('SELECT * FROM mentions WHERE node_id=? ORDER BY start_offset').all(nodeId) as Row[]).map(mapMention)
  }

  createForeshadow(input: Pick<Foreshadow, 'projectId' | 'title'> & Partial<Pick<Foreshadow, 'summary' | 'importance' | 'plannedPayoff'>> & { nodeId?: string | null; evidence?: string; note?: string }): Foreshadow {
    if (!this.getProject(input.projectId)) throw new Error('Project not found')
    this.validateForeshadowNode(input.projectId, input.nodeId ?? null)
    const id = newId(); const createdAt = nowIso()
    this.transaction(() => {
      this.db.prepare('INSERT INTO foreshadows(id,project_id,title,summary,status,importance,planned_payoff,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(
        id, input.projectId, input.title.trim(), input.summary ?? '', 'planted', input.importance ?? 'medium', input.plannedPayoff ?? '', createdAt, createdAt,
      )
      this.insertForeshadowEvent(id, input.nodeId ?? null, 'planted', input.evidence ?? '', input.note ?? '', createdAt)
      this.touchProject(input.projectId)
      this.logOperation(input.projectId, 'foreshadow', id, 'create', null, null, 'human')
    })
    return this.getForeshadow(id)!
  }

  listForeshadows(projectId: string, includeDeleted = false): Foreshadow[] {
    return (this.db.prepare(`SELECT * FROM foreshadows WHERE project_id=? ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY CASE importance WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, updated_at DESC`).all(projectId) as Row[]).map((row) => this.mapForeshadow(row))
  }

  getForeshadow(id: string): Foreshadow | null {
    const row = this.db.prepare('SELECT * FROM foreshadows WHERE id=?').get(id) as Row | undefined
    return row ? this.mapForeshadow(row) : null
  }

  updateForeshadow(id: string, patch: Partial<Pick<Foreshadow, 'title' | 'summary' | 'importance' | 'plannedPayoff' | 'deletedAt'>>): Foreshadow | null {
    const current = this.getForeshadow(id); if (!current) return null
    const updatedAt = nowIso()
    this.db.prepare('UPDATE foreshadows SET title=?,summary=?,importance=?,planned_payoff=?,deleted_at=?,updated_at=? WHERE id=?').run(
      patch.title?.trim() ?? current.title, patch.summary ?? current.summary, patch.importance ?? current.importance, patch.plannedPayoff ?? current.plannedPayoff,
      patch.deletedAt === undefined ? current.deletedAt : patch.deletedAt, updatedAt, id,
    )
    this.touchProject(current.projectId)
    return this.getForeshadow(id)
  }

  transitionForeshadow(id: string, input: { action: Foreshadow['status']; nodeId?: string | null; evidence?: string; note?: string }): Foreshadow {
    const current = this.getForeshadow(id); if (!current || current.deletedAt) throw new Error('Foreshadow not found')
    const allowed: Record<Foreshadow['status'], Foreshadow['status'][]> = {
      planted: ['reinforced', 'misdirected', 'resolved'], reinforced: ['reinforced', 'misdirected', 'resolved'],
      misdirected: ['reinforced', 'misdirected', 'resolved'], resolved: ['reinforced'],
    }
    if (!allowed[current.status].includes(input.action)) throw new Error(`Invalid foreshadow transition: ${current.status} -> ${input.action}`)
    this.validateForeshadowNode(current.projectId, input.nodeId ?? null)
    const createdAt = nowIso()
    this.transaction(() => {
      this.db.prepare('UPDATE foreshadows SET status=?,updated_at=? WHERE id=?').run(input.action, createdAt, id)
      this.insertForeshadowEvent(id, input.nodeId ?? null, input.action, input.evidence ?? '', input.note ?? '', createdAt)
      this.touchProject(current.projectId)
      this.logOperation(current.projectId, 'foreshadow', id, input.action, null, null, 'human')
    })
    return this.getForeshadow(id)!
  }

  private validateForeshadowNode(projectId: string, nodeId: string | null) {
    if (!nodeId) return
    const node = this.getNode(nodeId)
    if (!node || node.projectId !== projectId || node.type !== 'scene' || node.deletedAt) throw new Error('Foreshadow event scene is invalid')
  }

  private insertForeshadowEvent(foreshadowId: string, nodeId: string | null, action: Foreshadow['status'], evidence: string, note: string, createdAt = nowIso()) {
    this.db.prepare('INSERT INTO foreshadow_events(id,foreshadow_id,node_id,action,evidence,note,created_at) VALUES(?,?,?,?,?,?,?)').run(newId(), foreshadowId, nodeId, action, evidence, note, createdAt)
  }

  private listForeshadowEvents(foreshadowId: string): ForeshadowEvent[] {
    return (this.db.prepare('SELECT * FROM foreshadow_events WHERE foreshadow_id=? ORDER BY created_at,rowid').all(foreshadowId) as Row[]).map(mapForeshadowEvent)
  }

  private mapForeshadow(row: Row): Foreshadow {
    return { id: String(row.id), projectId: String(row.project_id), title: String(row.title), summary: String(row.summary), status: row.status as Foreshadow['status'], importance: row.importance as Foreshadow['importance'], plannedPayoff: String(row.planned_payoff), createdAt: String(row.created_at), updatedAt: String(row.updated_at), deletedAt: row.deleted_at ? String(row.deleted_at) : null, events: this.listForeshadowEvents(String(row.id)) }
  }

  createKnowledgeFact(input: Pick<KnowledgeFact, 'projectId' | 'title'> & Partial<Pick<KnowledgeFact, 'detail' | 'keywords' | 'firstRevealedNodeId' | 'privacyLevel'>>): KnowledgeFact {
    if (!this.getProject(input.projectId)) throw new Error('Project not found')
    this.validateProjectScene(input.projectId, input.firstRevealedNodeId ?? null, 'Knowledge reveal')
    const keywords = [...new Set((input.keywords ?? []).map((item) => item.trim()).filter((item) => item.length >= 2))]
    if (!keywords.length) throw new Error('Knowledge fact requires at least one keyword')
    const id = newId(); const createdAt = nowIso()
    this.db.prepare('INSERT INTO knowledge_facts(id,project_id,title,detail,keywords_json,first_revealed_node_id,privacy_level,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(
      id, input.projectId, input.title.trim(), input.detail ?? '', JSON.stringify(keywords), input.firstRevealedNodeId ?? null, input.privacyLevel ?? 'author_only', createdAt, createdAt,
    )
    this.touchProject(input.projectId); this.logOperation(input.projectId, 'knowledge', id, 'create', null, null, 'human')
    return this.getKnowledgeFact(id)!
  }

  listKnowledgeFacts(projectId: string, includeDeleted = false): KnowledgeFact[] {
    return (this.db.prepare(`SELECT * FROM knowledge_facts WHERE project_id=? ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY updated_at DESC`).all(projectId) as Row[]).map((row) => this.mapKnowledgeFact(row))
  }

  getKnowledgeFact(id: string): KnowledgeFact | null {
    const row = this.db.prepare('SELECT * FROM knowledge_facts WHERE id=?').get(id) as Row | undefined
    return row ? this.mapKnowledgeFact(row) : null
  }

  updateKnowledgeFact(id: string, patch: Partial<Pick<KnowledgeFact, 'title' | 'detail' | 'keywords' | 'firstRevealedNodeId' | 'privacyLevel' | 'deletedAt'>>): KnowledgeFact | null {
    const current = this.getKnowledgeFact(id); if (!current) return null
    this.validateProjectScene(current.projectId, patch.firstRevealedNodeId === undefined ? current.firstRevealedNodeId : patch.firstRevealedNodeId, 'Knowledge reveal')
    const keywords = patch.keywords ? [...new Set(patch.keywords.map((item) => item.trim()).filter((item) => item.length >= 2))] : current.keywords
    if (!keywords.length) throw new Error('Knowledge fact requires at least one keyword')
    this.db.prepare('UPDATE knowledge_facts SET title=?,detail=?,keywords_json=?,first_revealed_node_id=?,privacy_level=?,deleted_at=?,updated_at=? WHERE id=?').run(
      patch.title?.trim() ?? current.title, patch.detail ?? current.detail, JSON.stringify(keywords), patch.firstRevealedNodeId === undefined ? current.firstRevealedNodeId : patch.firstRevealedNodeId,
      patch.privacyLevel ?? current.privacyLevel, patch.deletedAt === undefined ? current.deletedAt : patch.deletedAt, nowIso(), id,
    )
    this.touchProject(current.projectId); return this.getKnowledgeFact(id)
  }

  grantKnowledge(knowledgeId: string, input: { entityId: string; knownFromNodeId: string; sourceNodeId?: string | null; evidence?: string; note?: string }): KnowledgeGrant {
    const fact = this.getKnowledgeFact(knowledgeId); if (!fact || fact.deletedAt) throw new Error('Knowledge fact not found')
    const entity = this.getEntity(input.entityId)
    if (!entity || entity.projectId !== fact.projectId || entity.type !== 'character' || entity.deletedAt) throw new Error('Knowledge holder must be a character in this project')
    this.validateProjectScene(fact.projectId, input.knownFromNodeId, 'Known-from')
    this.validateProjectScene(fact.projectId, input.sourceNodeId ?? null, 'Knowledge source')
    const id = newId(); const createdAt = nowIso()
    this.db.prepare(`INSERT INTO knowledge_grants(id,knowledge_id,entity_id,known_from_node_id,source_node_id,evidence,note,created_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(knowledge_id,entity_id) DO UPDATE SET known_from_node_id=excluded.known_from_node_id,source_node_id=excluded.source_node_id,evidence=excluded.evidence,note=excluded.note,created_at=excluded.created_at`).run(
      id, knowledgeId, input.entityId, input.knownFromNodeId, input.sourceNodeId ?? null, input.evidence ?? '', input.note ?? '', createdAt,
    )
    this.touchProject(fact.projectId)
    return this.listKnowledgeGrants(knowledgeId).find((grant) => grant.entityId === input.entityId)!
  }

  revokeKnowledgeGrant(knowledgeId: string, entityId: string): boolean {
    const fact = this.getKnowledgeFact(knowledgeId); if (!fact) return false
    const result = this.db.prepare('DELETE FROM knowledge_grants WHERE knowledge_id=? AND entity_id=?').run(knowledgeId, entityId)
    if (Number(result.changes)) this.touchProject(fact.projectId)
    return Boolean(result.changes)
  }

  listKnowledgeGrants(knowledgeId: string): KnowledgeGrant[] {
    return (this.db.prepare('SELECT * FROM knowledge_grants WHERE knowledge_id=? ORDER BY created_at,id').all(knowledgeId) as Row[]).map(mapKnowledgeGrant)
  }

  private validateProjectScene(projectId: string, nodeId: string | null, label: string) {
    if (!nodeId) return
    const node = this.getNode(nodeId)
    if (!node || node.projectId !== projectId || node.type !== 'scene' || node.deletedAt) throw new Error(`${label} scene is invalid`)
  }

  private mapKnowledgeFact(row: Row): KnowledgeFact {
    return { id: String(row.id), projectId: String(row.project_id), title: String(row.title), detail: String(row.detail), keywords: jsonParse(String(row.keywords_json), []), firstRevealedNodeId: row.first_revealed_node_id ? String(row.first_revealed_node_id) : null, privacyLevel: row.privacy_level as KnowledgeFact['privacyLevel'], createdAt: String(row.created_at), updatedAt: String(row.updated_at), deletedAt: row.deleted_at ? String(row.deleted_at) : null, grants: this.listKnowledgeGrants(String(row.id)) }
  }

  suggestMentions(nodeId: string): Array<Omit<Mention, 'id' | 'createdAt'>> {
    const node = this.getNode(nodeId)
    const doc = this.getScene(nodeId)
    if (!node || !doc) return []
    const entities = this.listEntities(node.projectId)
    const existing = this.listMentions(nodeId)
    const suggestions: Array<Omit<Mention, 'id' | 'createdAt'>> = []
    for (const entity of entities) {
      for (const name of [entity.canonicalName, ...entity.aliases].filter((value) => value.length >= 2)) {
        let index = doc.plainText.indexOf(name)
        while (index >= 0) {
          const duplicate = existing.some((mention) => mention.entityId === entity.id && mention.startOffset === index)
          if (!duplicate) suggestions.push({ entityId: entity.id, nodeId, quote: name, startOffset: index, endOffset: index + name.length, confirmed: false })
          index = doc.plainText.indexOf(name, index + name.length)
        }
      }
    }
    return suggestions.sort((a, b) => a.startOffset - b.startOffset)
  }

  detectSceneCanon(nodeId: string): CanonDetection[] {
    const node = this.getNode(nodeId)
    const doc = this.getScene(nodeId)
    if (!node || !doc) return []
    return this.listEntities(node.projectId).flatMap((entity) => {
      const names = [...new Set([entity.canonicalName, ...entity.aliases].map((name) => name.trim()).filter((name) => name.length >= 2))]
      const matches = names.map((name) => ({ name, offsets: findTextOffsets(doc.plainText, name) })).filter((match) => match.offsets.length)
      if (!matches.length) return []
      return [{
        entityId: entity.id,
        canonicalName: entity.canonicalName,
        entityType: entity.type,
        matchedNames: matches.map((match) => match.name),
        occurrenceCount: matches.reduce((total, match) => total + match.offsets.length, 0),
        firstOffset: Math.min(...matches.flatMap((match) => match.offsets)),
      }]
    }).sort((a, b) => a.firstOffset - b.firstOffset || a.canonicalName.localeCompare(b.canonicalName, 'zh-CN')).map(({ firstOffset: _firstOffset, ...detection }) => detection)
  }

  createCandidate(input: Omit<CandidateChange, 'id' | 'status' | 'createdAt' | 'resolvedAt'>): CandidateChange {
    const id = newId()
    const createdAt = nowIso()
    this.db.prepare(`INSERT INTO candidate_changes(id,project_id,node_id,target_type,target_id,operation,before_json,after_json,evidence_json,confidence,source_task_id,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, input.projectId, input.nodeId, input.targetType, input.targetId, input.operation, JSON.stringify(input.before), JSON.stringify(input.after), JSON.stringify(input.evidence), input.confidence, input.sourceTaskId, 'pending', createdAt,
    )
    this.recordProvenanceEvent({ projectId: input.projectId, nodeId: input.nodeId, eventType: 'candidate_created', actorType: input.sourceTaskId ? 'ai' : 'system', sourceTaskId: input.sourceTaskId, contentHash: sha256(JSON.stringify(input.after)), metadata: { targetType: input.targetType, operation: input.operation, confidence: input.confidence }, createdAt })
    return this.getCandidate(id)!
  }

  getCandidate(id: string): CandidateChange | null {
    const row = this.db.prepare('SELECT * FROM candidate_changes WHERE id=?').get(id) as Row | undefined
    return row ? mapCandidate(row) : null
  }

  listCandidates(projectId: string, status = 'pending'): CandidateChange[] {
    return (this.db.prepare('SELECT * FROM candidate_changes WHERE project_id=? AND status=? ORDER BY created_at DESC').all(projectId, status) as Row[]).map(mapCandidate)
  }

  resolveCandidate(id: string, status: CandidateChange['status'], modifiedAfter?: unknown): CandidateChange {
    const candidate = this.getCandidate(id)
    if (!candidate) throw new Error('Candidate not found')
    if (candidate.status !== 'pending') throw new Error('Candidate already resolved')
    const after = modifiedAfter === undefined ? candidate.after : modifiedAfter
    this.transaction(() => {
      const resolvedAt = nowIso()
      if (status === 'accepted' || status === 'accepted_modified') {
        this.applyCandidate(candidate, after)
        const previous = this.db.prepare('SELECT event_hash FROM canon_events WHERE project_id=? ORDER BY created_at DESC LIMIT 1').get(candidate.projectId) as Row | undefined
        const createdAt = nowIso()
        const payload = JSON.stringify({ candidateId: id, targetType: candidate.targetType, targetId: candidate.targetId, operation: candidate.operation, after })
        const previousHash = previous ? String(previous.event_hash) : null
        const eventHash = sha256(`${previousHash ?? ''}:${payload}:${createdAt}`)
        this.db.prepare(`INSERT INTO canon_events(id,project_id,candidate_id,event_type,payload_json,effective_node_id,created_at,previous_hash,event_hash) VALUES(?,?,?,?,?,?,?,?,?)`).run(
          newId(), candidate.projectId, id, candidate.operation, payload, candidate.nodeId, createdAt, previousHash, eventHash,
        )
      }
      this.db.prepare('UPDATE candidate_changes SET after_json=?,status=?,resolved_at=? WHERE id=?').run(JSON.stringify(after), status, resolvedAt, id)
      this.recordProvenanceEvent({ projectId: candidate.projectId, nodeId: candidate.nodeId, eventType: status === 'accepted' || status === 'accepted_modified' ? 'candidate_accepted' : 'candidate_rejected', actorType: 'human', sourceTaskId: candidate.sourceTaskId, contentHash: sha256(JSON.stringify(after)), metadata: { targetType: candidate.targetType, operation: candidate.operation, status }, createdAt: resolvedAt })
      this.logOperation(candidate.projectId, 'candidate', id, status, null, null, 'human')
    })
    return this.getCandidate(id)!
  }

  previewReplace(projectId: string, query: string, replacement: string, scopes: ReplaceScope[]): ReplaceMatch[] {
    if (!query) return []
    const matches: ReplaceMatch[] = []
    if (scopes.includes('body')) {
      const rows = this.db.prepare(`SELECT n.id,n.title,d.plain_text,d.current_revision_id FROM manuscript_nodes n JOIN scene_documents d ON d.node_id=n.id WHERE n.project_id=? AND n.deleted_at IS NULL`).all(projectId) as Row[]
      for (const row of rows) {
        const start = matches.length
        pushReplaceMatch(matches, 'scene', String(row.id), String(row.title), 'plainText', String(row.plain_text), query, replacement)
        if (matches.length > start) matches[matches.length - 1].revisionId = row.current_revision_id ? String(row.current_revision_id) : null
      }
    }
    if (scopes.includes('title')) {
      const rows = this.db.prepare('SELECT id,title FROM manuscript_nodes WHERE project_id=? AND deleted_at IS NULL').all(projectId) as Row[]
      for (const row of rows) pushReplaceMatch(matches, 'node', String(row.id), String(row.title), 'title', String(row.title), query, replacement)
    }
    if (scopes.includes('canon')) {
      const rows = this.db.prepare('SELECT id,canonical_name,summary,aliases_json FROM entities WHERE project_id=? AND deleted_at IS NULL').all(projectId) as Row[]
      for (const row of rows) {
        const title = String(row.canonical_name)
        pushReplaceMatch(matches, 'entity', String(row.id), title, 'canonicalName', title, query, replacement)
        pushReplaceMatch(matches, 'entity', String(row.id), title, 'summary', String(row.summary), query, replacement)
        const aliases = jsonParse<string[]>(String(row.aliases_json), [])
        aliases.forEach((alias, index) => pushReplaceMatch(matches, 'entity', String(row.id), title, `alias:${index}`, alias, query, replacement))
      }
    }
    return matches
  }

  applyReplace(projectId: string, query: string, replacement: string, scopes: ReplaceScope[]): ReplaceBatch {
    const changes = this.previewReplace(projectId, query, replacement, scopes)
    if (!changes.length) throw new Error('No replace matches found')
    const id = newId()
    const createdAt = nowIso()
    this.transaction(() => {
      const sceneChanges = changes.filter((change) => change.objectType === 'scene')
      for (const change of sceneChanges) {
        const node = this.getNode(change.objectId)!
        const doc = this.getScene(change.objectId)!
        this.saveSceneRaw(node, replaceStringsInJson(doc.contentJson, query, replacement), change.after, 'merge')
      }
      for (const change of changes.filter((item) => item.objectType === 'node')) this.updateNodeRaw(change.objectId, { title: change.after })
      const entityGroups = new Map<string, ReplaceMatch[]>()
      for (const change of changes.filter((item) => item.objectType === 'entity')) entityGroups.set(change.objectId, [...(entityGroups.get(change.objectId) ?? []), change])
      for (const [entityId, entityChanges] of entityGroups) {
        const entity = this.getEntity(entityId)!
        let canonicalName = entity.canonicalName
        let summary = entity.summary
        const aliases = [...entity.aliases]
        for (const change of entityChanges) {
          if (change.field === 'canonicalName') canonicalName = change.after
          else if (change.field === 'summary') summary = change.after
          else if (change.field.startsWith('alias:')) aliases[Number(change.field.slice(6))] = change.after
        }
        this.updateEntityRaw(entityId, { canonicalName, summary, aliases })
      }
      this.db.prepare('INSERT INTO replace_batches(id,project_id,query,replacement,scopes_json,changes_json,created_at) VALUES(?,?,?,?,?,?,?)').run(id, projectId, query, replacement, JSON.stringify(scopes), JSON.stringify(changes), createdAt)
      this.recordProvenanceEvent({ projectId, eventType: 'replace', actorType: 'human', contentHash: sha256(JSON.stringify(changes)), metadata: { scopes, changeCount: changes.length }, createdAt })
      this.logOperation(projectId, 'replace_batch', id, 'apply', null, null, 'human')
    })
    return { id, projectId, query, replacement, scopes, changes, createdAt, undoneAt: null }
  }

  undoReplace(id: string): ReplaceBatch {
    const row = this.db.prepare('SELECT * FROM replace_batches WHERE id=?').get(id) as Row | undefined
    if (!row) throw new Error('Replace batch not found')
    if (row.undone_at) throw new Error('Replace batch already undone')
    const batch = mapReplaceBatch(row)
    this.transaction(() => {
      for (const change of batch.changes.filter((item) => item.objectType === 'scene')) {
        const node = this.getNode(change.objectId)!
        const revision = change.revisionId ? this.db.prepare('SELECT content_json,plain_text FROM revisions WHERE id=? AND node_id=?').get(change.revisionId, change.objectId) as Row | undefined : undefined
        if (revision) this.saveSceneRaw(node, jsonParse(String(revision.content_json), emptyDoc), String(revision.plain_text), 'restore')
        else this.saveSceneRaw(node, plainTextToDoc(change.before), change.before, 'restore')
      }
      for (const change of batch.changes.filter((item) => item.objectType === 'node')) this.updateNodeRaw(change.objectId, { title: change.before })
      const entityGroups = new Map<string, ReplaceMatch[]>()
      for (const change of batch.changes.filter((item) => item.objectType === 'entity')) entityGroups.set(change.objectId, [...(entityGroups.get(change.objectId) ?? []), change])
      for (const [entityId, entityChanges] of entityGroups) {
        const entity = this.getEntity(entityId)!
        let canonicalName = entity.canonicalName
        let summary = entity.summary
        const aliases = [...entity.aliases]
        for (const change of entityChanges) {
          if (change.field === 'canonicalName') canonicalName = change.before
          else if (change.field === 'summary') summary = change.before
          else if (change.field.startsWith('alias:')) aliases[Number(change.field.slice(6))] = change.before
        }
        this.updateEntityRaw(entityId, { canonicalName, summary, aliases })
      }
      const undoneAt = nowIso()
      this.db.prepare('UPDATE replace_batches SET undone_at=? WHERE id=?').run(undoneAt, id)
      this.recordProvenanceEvent({ projectId: batch.projectId, eventType: 'replace_undone', actorType: 'human', contentHash: sha256(JSON.stringify(batch.changes)), metadata: { scopes: batch.scopes, changeCount: batch.changes.length }, createdAt: undoneAt })
      this.logOperation(batch.projectId, 'replace_batch', id, 'undo', null, null, 'human')
    })
    return mapReplaceBatch(this.db.prepare('SELECT * FROM replace_batches WHERE id=?').get(id) as Row)
  }

  createImportedProject(input: { title: string; description?: string; chapters: Array<{ title: string; text: string; contentJson: Record<string, unknown> }>; original: { fileName: string; mimeType: string; byteSize: number; contentHash: string; contentBase64: string } }): Project {
    if (!input.chapters.length) throw new Error('Import has no chapters')
    const projectId = newId(); const bookId = newId(); const createdAt = nowIso()
    this.transaction(() => {
      this.db.prepare('INSERT INTO projects(id,title,description,created_at,updated_at) VALUES(?,?,?,?,?)').run(projectId, input.title, input.description ?? '', createdAt, createdAt)
      this.db.prepare('INSERT INTO manuscript_nodes(id,project_id,parent_id,type,title,sort_key,status) VALUES(?,?,?,?,?,?,?)').run(bookId, projectId, null, 'book', input.title, 1000, 'draft')
      input.chapters.forEach((chapter, index) => {
        const chapterId = newId(); const sceneId = newId()
        this.db.prepare('INSERT INTO manuscript_nodes(id,project_id,parent_id,type,title,sort_key,status) VALUES(?,?,?,?,?,?,?)').run(chapterId, projectId, bookId, 'chapter', chapter.title, (index + 1) * 1000, 'planned')
        this.db.prepare('INSERT INTO manuscript_nodes(id,project_id,parent_id,type,title,sort_key,status) VALUES(?,?,?,?,?,?,?)').run(sceneId, projectId, chapterId, 'scene', '正文', 1000, 'draft')
        this.db.prepare('INSERT INTO scene_documents(node_id,content_json,plain_text,content_hash,updated_at) VALUES(?,?,?,?,?)').run(sceneId, JSON.stringify(emptyDoc), '', sha256(JSON.stringify(emptyDoc)), createdAt)
        this.saveSceneRaw(this.getNode(sceneId)!, chapter.contentJson, chapter.text, 'import')
      })
      this.db.prepare('INSERT INTO imported_sources(id,project_id,file_name,mime_type,byte_size,content_hash,content_base64,created_at) VALUES(?,?,?,?,?,?,?,?)').run(newId(), projectId, input.original.fileName, input.original.mimeType, input.original.byteSize, input.original.contentHash, input.original.contentBase64, createdAt)
      this.recordProvenanceEvent({ projectId, eventType: 'import', actorType: 'system', contentHash: input.original.contentHash, metadata: { sourceKind: 'original_file', mimeType: input.original.mimeType, byteSize: input.original.byteSize }, createdAt })
      this.logOperation(projectId, 'project', projectId, 'import', null, null, 'human')
    })
    return this.getProject(projectId)!
  }

  writingStats(projectId: string): WritingStats {
    const scenes = this.listNodes(projectId).filter((node) => node.type === 'scene')
    const totalWords = scenes.reduce((sum, scene) => sum + scene.wordCount, 0)
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0); const todayBoundary = startOfToday.toISOString()
    let baseline = 0
    for (const scene of scenes) {
      const revision = this.db.prepare(`SELECT plain_text FROM revisions WHERE node_id=? AND created_at<? ORDER BY created_at DESC LIMIT 1`).get(scene.id, todayBoundary) as Row | undefined
      baseline += revision ? countWords(String(revision.plain_text)) : 0
    }
    return { totalWords, todayNet: totalWords - baseline, dailyGoal: this.getSetting(projectId, 'dailyGoal', 2000), projectGoal: this.getSetting(projectId, 'projectGoal', 100000) }
  }

  captureSprintSnapshot(projectId: string, scope: 'scene' | 'project', sceneId: string | null): SprintSnapshotScene[] {
    const project = this.getProject(projectId)
    if (!project || project.deletedAt) throw new Error('Sprint project not found')
    const scenes = this.listNodes(projectId).filter((node) => node.type === 'scene' && !node.deletedAt && (scope === 'project' || node.id === sceneId))
    if (scope === 'scene' && (!sceneId || scenes.length !== 1)) throw new Error('Sprint scene is outside the project')
    if (!scenes.length) throw new Error('Sprint scope has no writable scenes')
    return scenes.map((scene) => {
      const document = this.getScene(scene.id)
      if (!document) throw new Error('Sprint scene document not found')
      return { sceneId: scene.id, revisionId: document.currentRevisionId, contentHash: document.contentHash, wordCount: countWords(document.plainText) }
    })
  }

  listSprintSessions(projectId: string): SprintSession[] {
    return (this.db.prepare('SELECT * FROM sprint_sessions WHERE project_id=? ORDER BY created_at DESC,id DESC').all(projectId) as Row[]).map((row) => this.mapSprintSession(row))
  }

  getSprintSession(id: string): SprintSession | null {
    const row = this.db.prepare('SELECT * FROM sprint_sessions WHERE id=?').get(id) as Row | undefined
    return row ? this.mapSprintSession(row) : null
  }

  getSprintBaseline(id: string): SprintSnapshotScene[] {
    const row = this.db.prepare('SELECT baseline_json FROM sprint_sessions WHERE id=?').get(id) as Row | undefined
    if (!row) throw new Error('Sprint session not found')
    return jsonParse<SprintSnapshotScene[]>(String(row.baseline_json), [])
  }

  createSprintSession(input: { id: string; projectId: string; scope: 'scene' | 'project'; sceneId: string | null; durationMinutes: number; goalWords: number; baseline: SprintSnapshotScene[]; startedAt: string; plannedEndAt: string }): SprintSession {
    this.db.prepare(`INSERT INTO sprint_sessions(id,project_id,scope,scene_id,duration_minutes,goal_words,status,clock_status,baseline_json,started_at,planned_end_at,total_paused_ms,last_reconciled_at,created_at)
      VALUES(?,?,?,?,?,?,'running','ok',?,?,?,0,?,?)`).run(input.id, input.projectId, input.scope, input.sceneId, input.durationMinutes, input.goalWords, JSON.stringify(input.baseline), input.startedAt, input.plannedEndAt, input.startedAt, input.startedAt)
    return this.getSprintSession(input.id)!
  }

  updateSprintSession(id: string, patch: { status?: SprintSession['status']; clockStatus?: SprintSession['clockStatus']; pausedAt?: string | null; endedAt?: string | null; totalPausedMs?: number; lastReconciledAt?: string }): SprintSession {
    const current = this.getSprintSession(id)
    if (!current) throw new Error('Sprint session not found')
    const columns: string[] = []; const values: Array<string | number | null> = []
    const add = (column: string, value: string | number | null) => { columns.push(`${column}=?`); values.push(value) }
    if (patch.status !== undefined) add('status', patch.status)
    if (patch.clockStatus !== undefined) add('clock_status', patch.clockStatus)
    if (patch.pausedAt !== undefined) add('paused_at', patch.pausedAt)
    if (patch.endedAt !== undefined) add('ended_at', patch.endedAt)
    if (patch.totalPausedMs !== undefined) add('total_paused_ms', Math.max(0, Math.round(patch.totalPausedMs)))
    if (patch.lastReconciledAt !== undefined) add('last_reconciled_at', patch.lastReconciledAt)
    if (columns.length) this.db.prepare(`UPDATE sprint_sessions SET ${columns.join(',')} WHERE id=?`).run(...values, id)
    return this.getSprintSession(id)!
  }

  addSprintSample(input: Omit<SprintSample, 'id'> & { id?: string }): SprintSample {
    const sample = { ...input, id: input.id ?? newId() }
    this.db.prepare('INSERT INTO sprint_samples(id,session_id,kind,captured_at,active_elapsed_ms,total_words,net_words,scenes_json) VALUES(?,?,?,?,?,?,?,?)').run(sample.id, sample.sessionId, sample.kind, sample.capturedAt, sample.activeElapsedMs, sample.totalWords, sample.netWords, JSON.stringify(sample.scenes))
    return sample
  }

  appendSprintEvent(input: { id?: string; sessionId: string; type: SprintEventType; occurredAt: string; activeElapsedMs: number; metadata?: Record<string, unknown> }): SprintEvent {
    const previous = this.db.prepare('SELECT event_hash FROM sprint_events WHERE session_id=? ORDER BY rowid DESC LIMIT 1').get(input.sessionId) as Row | undefined
    const event = { id: input.id ?? newId(), sessionId: input.sessionId, type: input.type, occurredAt: input.occurredAt, activeElapsedMs: Math.max(0, Math.round(input.activeElapsedMs)), metadata: input.metadata ?? {}, previousHash: previous ? String(previous.event_hash) : null }
    const eventHash = sprintEventHash(event)
    this.db.prepare('INSERT INTO sprint_events(id,session_id,event_type,occurred_at,active_elapsed_ms,metadata_json,previous_hash,event_hash) VALUES(?,?,?,?,?,?,?,?)').run(event.id, event.sessionId, event.type, event.occurredAt, event.activeElapsedMs, JSON.stringify(event.metadata), event.previousHash, eventHash)
    return { ...event, eventHash }
  }

  createSprintResultCard(card: SprintResultCard): SprintResultCard {
    const existing = this.db.prepare('SELECT * FROM sprint_result_cards WHERE id=? OR session_id=?').get(card.id, card.sessionId) as Row | undefined
    if (existing) {
      const current = mapSprintResultCard(existing)
      if (JSON.stringify(current) !== JSON.stringify(card)) throw new Error('Sprint result card ID collision')
      return current
    }
    this.db.prepare(`INSERT INTO sprint_result_cards(id,session_id,project_id,participant_label,scope,project_fingerprint,scope_fingerprint,started_at,ended_at,active_duration_ms,goal_words,net_words,event_chain_head,event_count,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(card.id, card.sessionId, card.projectId, card.participantLabel, card.scope, card.projectFingerprint, card.scopeFingerprint, card.startedAt, card.endedAt, card.activeDurationMs, card.goalWords, card.netWords, card.eventChainHead, card.eventCount, card.createdAt)
    return card
  }

  getSprintResultCard(id: string): SprintResultCard | null {
    const row = this.db.prepare('SELECT * FROM sprint_result_cards WHERE id=?').get(id) as Row | undefined
    return row ? mapSprintResultCard(row) : null
  }

  createSprintBoard(input: { projectId: string; name: string; period: 'day' | 'week'; targetWords: number; periodStartedAt: string }): SprintBoard {
    if (!this.getProject(input.projectId)) throw new Error('Sprint board project not found')
    const id = newId(); const createdAt = nowIso()
    this.db.prepare('INSERT INTO sprint_boards(id,project_id,name,period,target_words,period_started_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, input.projectId, input.name.trim(), input.period, input.targetWords, input.periodStartedAt, createdAt, createdAt)
    return this.getSprintBoard(id)!
  }

  listSprintBoards(projectId: string): SprintBoard[] {
    return (this.db.prepare('SELECT * FROM sprint_boards WHERE project_id=? ORDER BY created_at DESC,id DESC').all(projectId) as Row[]).map((row) => this.mapSprintBoard(row))
  }

  getSprintBoard(id: string): SprintBoard | null {
    const row = this.db.prepare('SELECT * FROM sprint_boards WHERE id=?').get(id) as Row | undefined
    return row ? this.mapSprintBoard(row) : null
  }

  addSprintBoardCard(boardId: string, sprintPackage: SprintPackage, importedAt = nowIso()): { board: SprintBoard; duplicate: boolean } {
    const board = this.getSprintBoard(boardId)
    if (!board) throw new Error('Sprint board not found')
    const existing = this.db.prepare('SELECT card_hash FROM sprint_board_cards WHERE board_id=? AND card_id=?').get(boardId, sprintPackage.card.id) as Row | undefined
    if (existing) {
      if (String(existing.card_hash) !== sprintPackage.cardHash) throw new Error('Sprint card ID collision')
      return { board, duplicate: true }
    }
    this.db.prepare('INSERT INTO sprint_board_cards(board_id,card_id,package_json,card_hash,imported_at) VALUES(?,?,?,?,?)').run(boardId, sprintPackage.card.id, JSON.stringify(sprintPackage), sprintPackage.cardHash, importedAt)
    this.db.prepare('UPDATE sprint_boards SET updated_at=? WHERE id=?').run(importedAt, boardId)
    return { board: this.getSprintBoard(boardId)!, duplicate: false }
  }

  listSprintBoardPackages(boardId: string): SprintPackage[] {
    return (this.db.prepare('SELECT package_json FROM sprint_board_cards WHERE board_id=? ORDER BY imported_at,card_id').all(boardId) as Row[]).map((row) => jsonParse<SprintPackage>(String(row.package_json), {} as SprintPackage))
  }

  private mapSprintSession(row: Row): SprintSession {
    const baseline = jsonParse<SprintSnapshotScene[]>(String(row.baseline_json), [])
    const samples = (this.db.prepare('SELECT * FROM sprint_samples WHERE session_id=? ORDER BY captured_at,id').all(String(row.id)) as Row[]).map(mapSprintSample)
    let current: SprintSnapshotScene[]
    try { current = this.captureSprintSnapshot(String(row.project_id), row.scope as 'scene' | 'project', row.scene_id ? String(row.scene_id) : null) }
    catch { current = samples.at(-1)?.scenes ?? baseline }
    const events = (this.db.prepare('SELECT * FROM sprint_events WHERE session_id=? ORDER BY occurred_at,id').all(String(row.id)) as Row[]).map(mapSprintEvent)
    const cardRow = this.db.prepare('SELECT * FROM sprint_result_cards WHERE session_id=?').get(String(row.id)) as Row | undefined
    const activeElapsedMs = sprintActiveElapsed(row)
    const baselineWords = baseline.reduce((sum, scene) => sum + scene.wordCount, 0)
    const currentWords = current.reduce((sum, scene) => sum + scene.wordCount, 0)
    return { id: String(row.id), projectId: String(row.project_id), scope: row.scope as SprintSession['scope'], sceneId: row.scene_id ? String(row.scene_id) : null, durationMinutes: Number(row.duration_minutes), goalWords: Number(row.goal_words), status: row.status as SprintSession['status'], clockStatus: row.clock_status as SprintSession['clockStatus'], startedAt: String(row.started_at), plannedEndAt: String(row.planned_end_at), pausedAt: row.paused_at ? String(row.paused_at) : null, endedAt: row.ended_at ? String(row.ended_at) : null, totalPausedMs: Number(row.total_paused_ms), lastReconciledAt: String(row.last_reconciled_at), activeElapsedMs, currentWords, netWords: currentWords - baselineWords, samples, events, resultCard: cardRow ? mapSprintResultCard(cardRow) : null }
  }

  private mapSprintBoard(row: Row): SprintBoard {
    const entries = (this.db.prepare('SELECT * FROM sprint_board_cards WHERE board_id=? ORDER BY imported_at,card_id').all(String(row.id)) as Row[]).map((entry) => {
      const sprintPackage = jsonParse<SprintPackage>(String(entry.package_json), {} as SprintPackage)
      return { card: sprintPackage.card, cardHash: String(entry.card_hash), importedAt: String(entry.imported_at) }
    })
    const participantMap = new Map<string, { participantLabel: string; netWords: number; sprintCount: number }>()
    for (const entry of entries) { const label = entry.card.participantLabel || '匿名作者'; const current = participantMap.get(label) ?? { participantLabel: label, netWords: 0, sprintCount: 0 }; current.netWords += entry.card.netWords; current.sprintCount += 1; participantMap.set(label, current) }
    return { id: String(row.id), projectId: String(row.project_id), name: String(row.name), period: row.period as SprintBoard['period'], targetWords: Number(row.target_words), periodStartedAt: String(row.period_started_at), createdAt: String(row.created_at), updatedAt: String(row.updated_at), entries, totalNetWords: entries.reduce((sum, entry) => sum + entry.card.netWords, 0), participants: [...participantMap.values()].sort((a, b) => b.netWords - a.netWords || a.participantLabel.localeCompare(b.participantLabel)) }
  }

  listReviewSessions(projectId?: string): ReviewSession[] {
    const rows = (projectId
      ? this.db.prepare("SELECT * FROM review_sessions WHERE project_id=? OR (project_id IS NULL AND direction='received') ORDER BY created_at DESC,id DESC").all(projectId)
      : this.db.prepare('SELECT * FROM review_sessions ORDER BY created_at DESC,id DESC').all()) as Row[]
    return rows.map((row) => this.mapReviewSession(row))
  }

  getReviewSession(id: string): ReviewSession | null {
    const row = this.db.prepare('SELECT * FROM review_sessions WHERE id=?').get(id) as Row | undefined
    return row ? this.mapReviewSession(row) : null
  }

  createReviewSession(input: {
    id: string; projectId: string | null; sourceProjectId: string; projectTitle: string; role: ReviewRole; reviewerName: string;
    sceneIds: string[]; scenes: ReviewSessionScene[]; includeProvenance: boolean; direction: ReviewSession['direction']; status?: ReviewSession['status'];
    projectFingerprint: string; keySalt: string; keyVerifier: string; expiresAt: string | null; createdAt: string
  }): ReviewSession {
    const existing = this.db.prepare('SELECT * FROM review_sessions WHERE id=?').get(input.id) as Row | undefined
    if (existing) {
      const current = this.mapReviewSession(existing)
      if (current.sourceProjectId !== input.sourceProjectId || current.role !== input.role || current.reviewerName !== input.reviewerName || current.direction !== input.direction || JSON.stringify(current.sceneIds) !== JSON.stringify(input.sceneIds)) throw new Error('Review session ID collision')
      return current
    }
    if (input.projectId && !this.getProject(input.projectId)) throw new Error('Review project not found')
    if (!input.sceneIds.length || input.sceneIds.length > 100 || input.scenes.length !== input.sceneIds.length || input.scenes.some((scene, index) => scene.id !== input.sceneIds[index]) || new Set(input.sceneIds).size !== input.sceneIds.length) throw new Error('Review scope is invalid')
    this.db.prepare(`INSERT INTO review_sessions(id,project_id,source_project_id,project_title,role,reviewer_name,scene_ids_json,scene_snapshots_json,include_provenance,direction,status,project_fingerprint,key_salt,key_verifier,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      input.id, input.projectId, input.sourceProjectId, input.projectTitle, input.role, input.reviewerName.trim(), JSON.stringify(input.sceneIds), JSON.stringify(input.scenes), input.includeProvenance ? 1 : 0, input.direction, input.status ?? 'open', input.projectFingerprint, input.keySalt, input.keyVerifier, input.expiresAt, input.createdAt,
    )
    return this.getReviewSession(input.id)!
  }

  createReviewFeedback(input: Omit<ReviewFeedback, 'decisions' | 'currentDecision' | 'anchorStatus' | 'resolvedStartOffset'>): ReviewFeedback {
    const session = this.getReviewSession(input.sessionId)
    if (!session || session.status !== 'open') throw new Error('Review session is not open')
    if (!session.sceneIds.includes(input.sceneId)) throw new Error('Feedback is outside the review scope')
    if (session.role === 'beta_reader' && input.kind === 'suggestion') throw new Error('Beta Reader can only comment')
    if (input.kind === 'suggestion' && (!input.originalText || input.originalText !== input.anchor.quote || !input.replacementText.trim())) throw new Error('Review suggestion requires an anchored replacement')
    const existing = this.db.prepare('SELECT * FROM review_feedback WHERE id=?').get(input.id) as Row | undefined
    if (existing) {
      const current = this.mapReviewFeedback(existing, session)
      if (current.sessionId !== input.sessionId || current.sceneId !== input.sceneId || current.kind !== input.kind || current.body !== input.body || JSON.stringify(current.anchor) !== JSON.stringify(input.anchor) || current.originalText !== input.originalText || current.replacementText !== input.replacementText || current.createdAt !== input.createdAt) throw new Error('Review feedback ID collision')
      return current
    }
    this.db.prepare('INSERT INTO review_feedback(id,session_id,scene_id,scene_title,kind,body,anchor_json,original_text,replacement_text,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(input.id, input.sessionId, input.sceneId, input.sceneTitle, input.kind, input.body, JSON.stringify(input.anchor), input.originalText, input.replacementText, input.createdAt)
    return this.mapReviewFeedback(this.db.prepare('SELECT * FROM review_feedback WHERE id=?').get(input.id) as Row, session)
  }

  createReviewDecision(input: ReviewDecision): ReviewDecision {
    const feedbackRow = this.db.prepare('SELECT * FROM review_feedback WHERE id=?').get(input.feedbackId) as Row | undefined
    if (!feedbackRow) throw new Error('Review feedback not found')
    const session = this.getReviewSession(String(feedbackRow.session_id))
    if (!session?.projectId || session.direction !== 'authored') throw new Error('Only the author copy can decide feedback')
    const existing = this.db.prepare('SELECT * FROM review_decisions WHERE id=?').get(input.id) as Row | undefined
    if (existing) {
      const current = mapReviewDecision(existing)
      if (JSON.stringify(current) !== JSON.stringify(input)) throw new Error('Review decision ID collision')
      return current
    }
    this.db.prepare('INSERT INTO review_decisions(id,feedback_id,decision,note,created_at) VALUES(?,?,?,?,?)').run(input.id, input.feedbackId, input.decision, input.note, input.createdAt)
    return input
  }

  private mapReviewSession(row: Row): ReviewSession {
    const sessionBase = {
      id: String(row.id), projectId: row.project_id ? String(row.project_id) : null, sourceProjectId: String(row.source_project_id), projectTitle: String(row.project_title), role: row.role as ReviewRole,
      reviewerName: String(row.reviewer_name), sceneIds: jsonParse<string[]>(String(row.scene_ids_json), []), scenes: jsonParse<ReviewSessionScene[]>(String(row.scene_snapshots_json), []), includeProvenance: Boolean(row.include_provenance),
      direction: row.direction as ReviewSession['direction'], status: row.status as ReviewSession['status'], expiresAt: row.expires_at ? String(row.expires_at) : null, createdAt: String(row.created_at),
    }
    const feedbackRows = this.db.prepare('SELECT * FROM review_feedback WHERE session_id=? ORDER BY created_at,id').all(sessionBase.id) as Row[]
    return { ...sessionBase, feedback: feedbackRows.map((feedback) => this.mapReviewFeedback(feedback, { ...sessionBase, feedback: [] })) }
  }

  private mapReviewFeedback(row: Row, session: ReviewSession): ReviewFeedback {
    const decisions = (this.db.prepare('SELECT * FROM review_decisions WHERE feedback_id=? ORDER BY created_at,id').all(String(row.id)) as Row[]).map(mapReviewDecision)
    const anchor = jsonParse<ReviewAnchor>(String(row.anchor_json), { paragraphIndex: -1, startOffset: 0, endOffset: 0, quote: '', paragraphHash: '', contextBefore: '', contextAfter: '' })
    const sceneText = session.projectId && this.getScene(String(row.scene_id))?.plainText || session.scenes.find((scene) => scene.id === String(row.scene_id))?.plainText || ''
    const resolution = resolveReviewAnchor(sceneText, anchor)
    return { id: String(row.id), sessionId: String(row.session_id), sceneId: String(row.scene_id), sceneTitle: String(row.scene_title), kind: row.kind as ReviewFeedback['kind'], body: String(row.body), anchor, originalText: String(row.original_text), replacementText: String(row.replacement_text), createdAt: String(row.created_at), decisions, currentDecision: decisions.at(-1)?.decision ?? null, anchorStatus: resolution.status, resolvedStartOffset: resolution.offset }
  }

  listMobileInbox(projectId?: string | null): MobileInboxItem[] {
    const rows = (projectId === undefined
      ? this.db.prepare('SELECT * FROM mobile_inbox_items ORDER BY created_at DESC,id DESC').all()
      : projectId === null
        ? this.db.prepare('SELECT * FROM mobile_inbox_items WHERE project_id IS NULL ORDER BY created_at DESC,id DESC').all()
        : this.db.prepare('SELECT * FROM mobile_inbox_items WHERE project_id=? OR project_id IS NULL ORDER BY created_at DESC,id DESC').all(projectId)) as Row[]
    return rows.map((row) => {
      const actions = (this.db.prepare('SELECT * FROM mobile_inbox_actions WHERE item_id=? ORDER BY created_at,id').all(String(row.id)) as Row[]).map(mapMobileAction)
      return mapMobileItem(row, actions)
    })
  }

  createMobileInboxItem(input: { id: string; projectId: string | null; targetNodeId: string | null; kind: MobileInboxItem['kind']; content: string; originDeviceId: string | null; createdAt: string }): MobileInboxItem {
    const projectId = input.projectId && this.getProject(input.projectId) ? input.projectId : null
    const target = input.targetNodeId ? this.getNode(input.targetNodeId) : null
    const targetNodeId = target && target.projectId === projectId ? target.id : null
    const existing = this.db.prepare('SELECT * FROM mobile_inbox_items WHERE id=?').get(input.id) as Row | undefined
    if (existing) {
      const current = mapMobileItem(existing, (this.db.prepare('SELECT * FROM mobile_inbox_actions WHERE item_id=? ORDER BY created_at,id').all(input.id) as Row[]).map(mapMobileAction))
      if (current.projectId !== projectId || current.targetNodeId !== targetNodeId || current.kind !== input.kind || current.content !== input.content || current.originDeviceId !== input.originDeviceId || current.createdAt !== input.createdAt) throw new Error('Mobile inbox ID collision')
      return current
    }
    this.db.prepare('INSERT INTO mobile_inbox_items(id,project_id,target_node_id,kind,content,origin_device_id,created_at) VALUES(?,?,?,?,?,?,?)').run(input.id, projectId, targetNodeId, input.kind, input.content, input.originDeviceId, input.createdAt)
    return mapMobileItem(this.db.prepare('SELECT * FROM mobile_inbox_items WHERE id=?').get(input.id) as Row, [])
  }

  createMobileInboxAction(input: MobileInboxAction): MobileInboxAction {
    if (!this.db.prepare('SELECT 1 FROM mobile_inbox_items WHERE id=?').get(input.itemId)) throw new Error('Mobile inbox item not found')
    const existing = this.db.prepare('SELECT * FROM mobile_inbox_actions WHERE id=?').get(input.id) as Row | undefined
    if (existing) {
      const current = mapMobileAction(existing)
      if (current.itemId !== input.itemId || current.action !== input.action || current.note !== input.note || current.createdAt !== input.createdAt) throw new Error('Mobile action ID collision')
      return current
    }
    this.db.prepare('INSERT INTO mobile_inbox_actions(id,item_id,action,note,created_at) VALUES(?,?,?,?,?)').run(input.id, input.itemId, input.action, input.note, input.createdAt)
    return input
  }

  private updateNodeRaw(id: string, patch: { title: string }) {
    const current = this.getNode(id)
    if (!current) throw new Error('Node not found')
    this.db.prepare('UPDATE manuscript_nodes SET title=? WHERE id=?').run(patch.title, id)
    if (current.type === 'scene') this.upsertSearch(id, patch.title, this.getScene(id)?.plainText ?? '')
    this.touchProject(current.projectId)
  }

  private updateEntityRaw(id: string, patch: Pick<Entity, 'canonicalName' | 'summary' | 'aliases'>) {
    const current = this.getEntity(id)
    if (!current) throw new Error('Entity not found')
    this.db.prepare('UPDATE entities SET canonical_name=?,normalized_name=?,summary=?,aliases_json=?,updated_at=? WHERE id=?').run(patch.canonicalName, normalizeName(patch.canonicalName), patch.summary, JSON.stringify(patch.aliases), nowIso(), id)
    this.touchProject(current.projectId)
  }

  private applyCandidate(candidate: CandidateChange, after: unknown) {
    if (candidate.targetType === 'entity_state' && candidate.targetId) {
      const value = after as Record<string, unknown>
      const attributeKey = String(value.attributeKey ?? value.attribute_key ?? 'state')
      const worldTimeFrom = typeof value.worldTimeFrom === 'string' ? value.worldTimeFrom : null
      if (worldTimeFrom) this.db.prepare('UPDATE entity_states SET world_time_to=? WHERE entity_id=? AND attribute_key=? AND world_time_from<? AND world_time_to IS NULL').run(worldTimeFrom, candidate.targetId, attributeKey, worldTimeFrom)
      this.createState({
        entityId: candidate.targetId,
        attributeKey,
        value: value.value,
        validFromNodeId: candidate.nodeId,
        validToNodeId: null,
        worldTimeFrom,
        worldTimeTo: null,
        sourceMentionId: null,
      })
      return
    }
    if (candidate.targetType === 'relationship_state' && candidate.targetId) {
      const value = after as Record<string, unknown>
      this.createRelationshipState({
        relationshipId: candidate.targetId,
        statusLabel: String(value.statusLabel ?? value.status_label ?? '关系变化'),
        note: typeof value.note === 'string' ? value.note : '',
        validFromNodeId: candidate.nodeId,
        validToNodeId: typeof value.validToNodeId === 'string' ? value.validToNodeId : null,
        worldTimeFrom: typeof value.worldTimeFrom === 'string' ? value.worldTimeFrom : null,
        worldTimeTo: typeof value.worldTimeTo === 'string' ? value.worldTimeTo : null,
        sourceNodeId: candidate.nodeId,
        evidence: candidate.evidence.quote ?? '',
      })
      return
    }
    if (candidate.targetType === 'entity' && candidate.targetId && candidate.operation === 'update') {
      this.updateEntity(candidate.targetId, after as Partial<Entity>)
      return
    }
    throw new Error(`Unsupported candidate operation: ${candidate.targetType}/${candidate.operation}`)
  }

  getSetting<T>(projectId: string, key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value_json FROM project_settings WHERE project_id=? AND key=?').get(projectId, key) as Row | undefined
    return row ? jsonParse(String(row.value_json), fallback) : fallback
  }

  setSetting(projectId: string, key: string, value: unknown) {
    this.db.prepare(`INSERT INTO project_settings(project_id,key,value_json) VALUES(?,?,?) ON CONFLICT(project_id,key) DO UPDATE SET value_json=excluded.value_json`).run(projectId, key, JSON.stringify(value))
    this.touchProject(projectId)
  }

  operationCount(projectId: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS count FROM operation_log WHERE project_id=?').get(projectId) as Row).count)
  }

  checkpoint() {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  }

  private nextSortKey(projectId: string, parentId: string | null): number {
    const row = parentId
      ? this.db.prepare('SELECT COALESCE(MAX(sort_key),0)+1000 AS next FROM manuscript_nodes WHERE project_id=? AND parent_id=?').get(projectId, parentId)
      : this.db.prepare('SELECT COALESCE(MAX(sort_key),0)+1000 AS next FROM manuscript_nodes WHERE project_id=? AND parent_id IS NULL').get(projectId)
    return Number((row as Row).next)
  }

  private touchProject(projectId: string) {
    this.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(nowIso(), projectId)
  }

  private upsertSearch(nodeId: string, title: string, plainText: string) {
    this.db.prepare('DELETE FROM scene_search WHERE node_id=?').run(nodeId)
    this.db.prepare('INSERT INTO scene_search(node_id,title,plain_text) VALUES(?,?,?)').run(nodeId, title, plainText)
  }

  private logOperation(projectId: string, objectType: string, objectId: string, operation: string, before: string | null, after: string | null, actorType: string, taskId: string | null = null) {
    this.db.prepare(`INSERT INTO operation_log(id,project_id,object_type,object_id,operation,revision_before,revision_after,actor_type,task_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      newId(), projectId, objectType, objectId, operation, before, after, actorType, taskId, nowIso(),
    )
  }
}

function mapProject(row: Row): Project {
  return { id: String(row.id), title: String(row.title), description: String(row.description), createdAt: String(row.created_at), updatedAt: String(row.updated_at), deletedAt: row.deleted_at ? String(row.deleted_at) : null }
}

function mapNode(row: Row): ManuscriptNode {
  return {
    id: String(row.id), projectId: String(row.project_id), parentId: row.parent_id ? String(row.parent_id) : null,
    type: row.type as ManuscriptNode['type'], title: String(row.title), sortKey: Number(row.sort_key), status: row.status as ManuscriptNode['status'],
    povEntityId: row.pov_entity_id ? String(row.pov_entity_id) : null, storyTime: row.story_time ? String(row.story_time) : null,
    deletedAt: row.deleted_at ? String(row.deleted_at) : null, wordCount: countWords(String(row.plain_text ?? '')),
  }
}

function mapScene(row: Row): SceneDocument {
  return { nodeId: String(row.node_id), contentJson: jsonParse(String(row.content_json), emptyDoc), plainText: String(row.plain_text), contentHash: String(row.content_hash), currentRevisionId: row.current_revision_id ? String(row.current_revision_id) : null, updatedAt: String(row.updated_at) }
}

function mapRevision(row: Row): Revision {
  const sourceType = row.source_type as Revision['sourceType']
  return { id: String(row.id), nodeId: String(row.node_id), parentRevisionId: row.parent_revision_id ? String(row.parent_revision_id) : null, contentJson: jsonParse(String(row.content_json), emptyDoc), plainText: String(row.plain_text), contentHash: String(row.content_hash), sourceType, provenanceLabel: (row.provenance_label || (sourceType === 'ai_accepted' ? 'ai_accepted' : sourceType)) as ProvenanceLabel, sourceTaskId: row.source_task_id ? String(row.source_task_id) : null, createdAt: String(row.created_at) }
}

function mapProvenanceEvent(row: Row): ProvenanceEvent {
  return {
    id: String(row.id), projectId: String(row.project_id), nodeId: row.node_id ? String(row.node_id) : null, revisionId: row.revision_id ? String(row.revision_id) : null,
    eventType: row.event_type as ProvenanceEventType, actorType: row.actor_type as ProvenanceEvent['actorType'], sourceTaskId: row.source_task_id ? String(row.source_task_id) : null,
    sourceRevisionId: row.source_revision_id ? String(row.source_revision_id) : null, contentHash: String(row.content_hash), metadata: jsonParse(String(row.metadata_json), {}),
    previousHash: row.previous_hash ? String(row.previous_hash) : null, eventHash: String(row.event_hash), createdAt: String(row.created_at), nodeTitle: row.node_title ? String(row.node_title) : undefined,
    revision: row.revision_id ? { parentRevisionId: row.parent_revision_id ? String(row.parent_revision_id) : null, provenanceLabel: row.provenance_label as ProvenanceLabel } : null,
  }
}

function mapProvenanceExport(row: Row): ProvenanceExportRecord {
  return { id: String(row.id), projectId: String(row.project_id), formatVersion: String(row.format_version), manifestHash: String(row.manifest_hash), eventCount: Number(row.event_count), includedText: Boolean(row.included_text), createdAt: String(row.created_at) }
}

function revisionEventType(label: ProvenanceLabel): ProvenanceEventType {
  return ({ human: 'human_edit', ai_accepted: 'ai_accepted', human_after_ai: 'human_after_ai', import: 'import', restore: 'restore', merge: 'merge' } as const)[label]
}

export function provenanceEventHash(input: { eventType: ProvenanceEventType; actorType: ProvenanceEvent['actorType']; contentHash: string; metadata: Record<string, unknown>; previousHash: string | null; createdAt: string }) {
  return sha256(JSON.stringify({ eventType: input.eventType, actorType: input.actorType, contentHash: input.contentHash, metadata: input.metadata, previousHash: input.previousHash, createdAt: input.createdAt }))
}

export function sprintEventHash(input: Pick<SprintEvent, 'type' | 'occurredAt' | 'activeElapsedMs' | 'metadata' | 'previousHash'>) {
  return sha256(JSON.stringify({ type: input.type, occurredAt: input.occurredAt, activeElapsedMs: input.activeElapsedMs, metadata: input.metadata, previousHash: input.previousHash }))
}

function sprintActiveElapsed(row: Row, at = Date.now()) {
  const started = Date.parse(String(row.started_at))
  const effectiveEnd = row.ended_at ? Date.parse(String(row.ended_at)) : row.status === 'paused' && row.paused_at ? Date.parse(String(row.paused_at)) : at
  return Math.max(0, effectiveEnd - started - Number(row.total_paused_ms))
}

function mapSprintSample(row: Row): SprintSample {
  return { id: String(row.id), sessionId: String(row.session_id), kind: row.kind as SprintSample['kind'], capturedAt: String(row.captured_at), activeElapsedMs: Number(row.active_elapsed_ms), totalWords: Number(row.total_words), netWords: Number(row.net_words), scenes: jsonParse<SprintSnapshotScene[]>(String(row.scenes_json), []) }
}

function mapSprintEvent(row: Row): SprintEvent {
  return { id: String(row.id), sessionId: String(row.session_id), type: row.event_type as SprintEventType, occurredAt: String(row.occurred_at), activeElapsedMs: Number(row.active_elapsed_ms), metadata: jsonParse<Record<string, unknown>>(String(row.metadata_json), {}), previousHash: row.previous_hash ? String(row.previous_hash) : null, eventHash: String(row.event_hash) }
}

function mapSprintResultCard(row: Row): SprintResultCard {
  return { id: String(row.id), sessionId: String(row.session_id), projectId: String(row.project_id), participantLabel: String(row.participant_label), scope: row.scope as SprintResultCard['scope'], projectFingerprint: String(row.project_fingerprint), scopeFingerprint: String(row.scope_fingerprint), startedAt: String(row.started_at), endedAt: String(row.ended_at), activeDurationMs: Number(row.active_duration_ms), goalWords: Number(row.goal_words), netWords: Number(row.net_words), eventChainHead: String(row.event_chain_head), eventCount: Number(row.event_count), createdAt: String(row.created_at) }
}

function mapEntity(row: Row): Entity {
  return { id: String(row.id), projectId: String(row.project_id), type: row.type as Entity['type'], canonicalName: String(row.canonical_name), aliases: jsonParse(String(row.aliases_json), []), summary: String(row.summary), privacyLevel: row.privacy_level as Entity['privacyLevel'], createdAt: String(row.created_at), updatedAt: String(row.updated_at), deletedAt: row.deleted_at ? String(row.deleted_at) : null }
}

function mapState(row: Row): EntityState {
  return { id: String(row.id), entityId: String(row.entity_id), attributeKey: String(row.attribute_key), value: jsonParse(String(row.value_json), null), validFromNodeId: row.valid_from_node_id ? String(row.valid_from_node_id) : null, validToNodeId: row.valid_to_node_id ? String(row.valid_to_node_id) : null, worldTimeFrom: row.world_time_from ? String(row.world_time_from) : null, worldTimeTo: row.world_time_to ? String(row.world_time_to) : null, sourceMentionId: row.source_mention_id ? String(row.source_mention_id) : null, createdAt: String(row.created_at) }
}

function mapProfileField(row: Row): EntityProfileField {
  return { id: String(row.id), entityId: String(row.entity_id), category: String(row.category), label: String(row.label), value: String(row.value), sortKey: Number(row.sort_key), privacyLevel: row.privacy_level as EntityProfileField['privacyLevel'], createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
}

function mapRelationshipBase(row: Row): Omit<EntityRelationship, 'states' | 'currentState'> {
  return { id: String(row.id), projectId: String(row.project_id), sourceEntityId: String(row.source_entity_id), targetEntityId: String(row.target_entity_id), relationType: String(row.relation_type), direction: row.direction as EntityRelationship['direction'], label: String(row.label), summary: String(row.summary), privacyLevel: row.privacy_level as EntityRelationship['privacyLevel'], createdAt: String(row.created_at), updatedAt: String(row.updated_at), deletedAt: row.deleted_at ? String(row.deleted_at) : null }
}

function mapRelationshipState(row: Row): RelationshipState {
  return { id: String(row.id), relationshipId: String(row.relationship_id), statusLabel: String(row.status_label), note: String(row.note), validFromNodeId: row.valid_from_node_id ? String(row.valid_from_node_id) : null, validToNodeId: row.valid_to_node_id ? String(row.valid_to_node_id) : null, worldTimeFrom: row.world_time_from ? String(row.world_time_from) : null, worldTimeTo: row.world_time_to ? String(row.world_time_to) : null, sourceNodeId: row.source_node_id ? String(row.source_node_id) : null, evidence: String(row.evidence), createdAt: String(row.created_at) }
}

function resolveRelationshipState(states: RelationshipState[], atNodeId: string | null, nodes: ManuscriptNode[]): RelationshipState | null {
  if (!states.length) return null
  if (!atNodeId) return states.at(-1) ?? null
  const atNode = nodes.find((node) => node.id === atNodeId)
  const order = narrativeSceneOrder(nodes); const at = order.get(atNodeId) ?? Number.MAX_SAFE_INTEGER
  const matching = states.filter((state) => {
    if (atNode?.storyTime && (state.worldTimeFrom || state.worldTimeTo)) return (!state.worldTimeFrom || state.worldTimeFrom <= atNode.storyTime) && (!state.worldTimeTo || atNode.storyTime < state.worldTimeTo)
    const from = state.validFromNodeId ? order.get(state.validFromNodeId) ?? Number.MAX_SAFE_INTEGER : -1
    const to = state.validToNodeId ? order.get(state.validToNodeId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
    return from <= at && at < to
  })
  return matching.at(-1) ?? null
}

function relationshipStateIntervalsOverlap(a: RelationshipState, b: Omit<RelationshipState, 'id' | 'createdAt'>, nodes: ManuscriptNode[]): boolean {
  const aWorld = Boolean(a.worldTimeFrom || a.worldTimeTo); const bWorld = Boolean(b.worldTimeFrom || b.worldTimeTo)
  if (aWorld || bWorld) {
    if (!aWorld || !bWorld) return true
    return (a.worldTimeFrom ?? '') < (b.worldTimeTo ?? '\uffff') && (b.worldTimeFrom ?? '') < (a.worldTimeTo ?? '\uffff')
  }
  const order = narrativeSceneOrder(nodes)
  const aFrom = a.validFromNodeId ? order.get(a.validFromNodeId) ?? Number.MAX_SAFE_INTEGER : -1
  const aTo = a.validToNodeId ? order.get(a.validToNodeId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
  const bFrom = b.validFromNodeId ? order.get(b.validFromNodeId) ?? Number.MAX_SAFE_INTEGER : -1
  const bTo = b.validToNodeId ? order.get(b.validToNodeId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
  return aFrom < bTo && bFrom < aTo
}

function narrativeSceneOrder(nodes: ManuscriptNode[]): Map<string, number> {
  const volumes = nodes.filter((node) => node.type === 'volume').sort((a, b) => a.sortKey - b.sortKey)
  const volumeRank = new Map(volumes.map((node, index) => [node.id, index]))
  const chapters = nodes.filter((node) => node.type === 'chapter').sort((a, b) => (volumeRank.get(a.parentId ?? '') ?? -1) - (volumeRank.get(b.parentId ?? '') ?? -1) || a.sortKey - b.sortKey)
  const result = new Map<string, number>(); let index = 0
  for (const chapter of chapters) for (const scene of nodes.filter((node) => node.type === 'scene' && node.parentId === chapter.id).sort((a, b) => a.sortKey - b.sortKey)) result.set(scene.id, index++)
  return result
}

function findTextOffsets(text: string, query: string): number[] {
  const offsets: number[] = []
  let index = text.indexOf(query)
  while (index >= 0) {
    offsets.push(index)
    index = text.indexOf(query, index + Math.max(1, query.length))
  }
  return offsets
}

function mapMention(row: Row): Mention {
  return { id: String(row.id), entityId: String(row.entity_id), nodeId: String(row.node_id), quote: String(row.quote), startOffset: Number(row.start_offset), endOffset: Number(row.end_offset), confirmed: Boolean(row.confirmed), createdAt: String(row.created_at) }
}

function mapMobileAction(row: Row): MobileInboxAction {
  return { id: String(row.id), itemId: String(row.item_id), action: row.action as MobileInboxAction['action'], note: String(row.note), createdAt: String(row.created_at) }
}

function mapMobileItem(row: Row, actions: MobileInboxAction[]): MobileInboxItem {
  return { id: String(row.id), projectId: row.project_id ? String(row.project_id) : null, targetNodeId: row.target_node_id ? String(row.target_node_id) : null, kind: row.kind as MobileInboxItem['kind'], content: String(row.content), originDeviceId: row.origin_device_id ? String(row.origin_device_id) : null, createdAt: String(row.created_at), actions, currentAction: actions.at(-1)?.action ?? null }
}

function mapReviewDecision(row: Row): ReviewDecision {
  return { id: String(row.id), feedbackId: String(row.feedback_id), decision: row.decision as ReviewDecision['decision'], note: String(row.note), createdAt: String(row.created_at) }
}

export function createReviewAnchor(plainText: string, paragraphIndex: number, startOffset: number, endOffset: number): ReviewAnchor {
  const paragraphs = plainText.split(/\n+/); const paragraph = paragraphs[paragraphIndex] ?? ''
  if (paragraphIndex < 0 || !paragraph || startOffset < 0 || endOffset <= startOffset || endOffset > paragraph.length) throw new Error('Review anchor range is invalid')
  return { paragraphIndex, startOffset, endOffset, quote: paragraph.slice(startOffset, endOffset), paragraphHash: sha256(paragraph), contextBefore: paragraph.slice(Math.max(0, startOffset - 24), startOffset), contextAfter: paragraph.slice(endOffset, endOffset + 24) }
}

export function resolveReviewAnchor(plainText: string, anchor: ReviewAnchor): { status: 'exact' | 'candidate' | 'lost'; offset: number | null } {
  const paragraphs = plainText.split(/\n+/); const paragraph = paragraphs[anchor.paragraphIndex]
  let paragraphBase = -1; let scanFrom = 0
  for (let index = 0; index <= anchor.paragraphIndex && index < paragraphs.length; index += 1) {
    paragraphBase = plainText.indexOf(paragraphs[index], scanFrom)
    if (paragraphBase < 0) break
    scanFrom = paragraphBase + paragraphs[index].length
  }
  if (paragraph && sha256(paragraph) === anchor.paragraphHash && paragraph.slice(anchor.startOffset, anchor.endOffset) === anchor.quote) return { status: 'exact', offset: paragraphBase + anchor.startOffset }
  const matches: number[] = []; let cursor = plainText.indexOf(anchor.quote)
  while (cursor >= 0) {
    const before = plainText.slice(Math.max(0, cursor - anchor.contextBefore.length), cursor); const after = plainText.slice(cursor + anchor.quote.length, cursor + anchor.quote.length + anchor.contextAfter.length)
    if ((!anchor.contextBefore || before === anchor.contextBefore) && (!anchor.contextAfter || after === anchor.contextAfter)) matches.push(cursor)
    cursor = plainText.indexOf(anchor.quote, cursor + Math.max(1, anchor.quote.length))
  }
  return matches.length === 1 ? { status: 'candidate', offset: matches[0] } : { status: 'lost', offset: null }
}

function mapForeshadowEvent(row: Row): ForeshadowEvent {
  return { id: String(row.id), foreshadowId: String(row.foreshadow_id), nodeId: row.node_id ? String(row.node_id) : null, action: row.action as ForeshadowEvent['action'], evidence: String(row.evidence), note: String(row.note), createdAt: String(row.created_at) }
}

function mapKnowledgeGrant(row: Row): KnowledgeGrant {
  return { id: String(row.id), knowledgeId: String(row.knowledge_id), entityId: String(row.entity_id), knownFromNodeId: String(row.known_from_node_id), sourceNodeId: row.source_node_id ? String(row.source_node_id) : null, evidence: String(row.evidence), note: String(row.note), createdAt: String(row.created_at) }
}

function mapSeriesCanonOverride(row: Row): SeriesCanonOverride {
  return { id: String(row.id), entryId: String(row.entry_id), projectId: String(row.project_id), canonicalName: String(row.canonical_name), aliases: jsonParse(String(row.aliases_json), []), summary: String(row.summary), privacyLevel: row.privacy_level as SeriesCanonOverride['privacyLevel'], createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
}

function mapReadAloudPreferences(row: Row): ReadAloudPreferences {
  return { projectId: String(row.project_id), voiceUri: String(row.voice_uri), rate: Number(row.rate), pitch: Number(row.pitch), updatedAt: String(row.updated_at) }
}

function mapDeliveryRule(row: Row): DeliveryRule {
  const baseConfig = jsonParse<Record<string, unknown>>(String(row.config_json), {})
  const overrideConfig = row.override_config_json ? jsonParse<Record<string, unknown>>(String(row.override_config_json), {}) : {}
  const hasOverride = row.override_enabled !== null && row.override_enabled !== undefined
  return { id: String(row.id), templateId: String(row.template_id), code: String(row.code), title: String(row.title), description: String(row.description), kind: row.kind as DeliveryRule['kind'], config: { ...baseConfig, ...overrideConfig }, severity: row.severity as DeliveryRule['severity'], enabled: Boolean(row.enabled), effectiveEnabled: hasOverride ? Boolean(row.override_enabled) : Boolean(row.enabled), manual: Boolean(row.manual) }
}

function mapDeliveryTemplate(row: Row, rules: DeliveryRule[]): DeliveryTemplate {
  return { id: String(row.id), channel: String(row.channel), name: String(row.name), version: String(row.version), verifiedAt: String(row.verified_at), sourceUrl: String(row.source_url), sourceNote: String(row.source_note), enabled: Boolean(row.enabled), builtIn: Boolean(row.built_in), staleAfterDays: Number(row.stale_after_days), rules }
}

function mapDeliveryCheckRun(row: Row): DeliveryCheckRun {
  return { id: String(row.id), projectId: String(row.project_id), templateId: String(row.template_id), chapterIds: jsonParse(String(row.chapter_ids_json), []), results: jsonParse(String(row.results_json), []), createdAt: String(row.created_at) }
}

function mapCandidate(row: Row): CandidateChange {
  return { id: String(row.id), projectId: String(row.project_id), nodeId: row.node_id ? String(row.node_id) : null, targetType: String(row.target_type), targetId: row.target_id ? String(row.target_id) : null, operation: String(row.operation), before: jsonParse(row.before_json ? String(row.before_json) : null, null), after: jsonParse(row.after_json ? String(row.after_json) : null, null), evidence: jsonParse(String(row.evidence_json), {}), confidence: Number(row.confidence), sourceTaskId: row.source_task_id ? String(row.source_task_id) : null, status: row.status as CandidateChange['status'], createdAt: String(row.created_at), resolvedAt: row.resolved_at ? String(row.resolved_at) : null }
}

function mapReplaceBatch(row: Row): ReplaceBatch {
  return {
    id: String(row.id), projectId: String(row.project_id), query: String(row.query), replacement: String(row.replacement),
    scopes: jsonParse(String(row.scopes_json), []), changes: jsonParse(String(row.changes_json), []), createdAt: String(row.created_at),
    undoneAt: row.undone_at ? String(row.undone_at) : null,
  }
}

function pushReplaceMatch(matches: ReplaceMatch[], objectType: ReplaceMatch['objectType'], objectId: string, title: string, field: string, value: string, query: string, replacement: string) {
  const occurrences = value.split(query).length - 1
  if (occurrences > 0) matches.push({ objectType, objectId, title, field, before: value, after: value.split(query).join(replacement), occurrences })
}

function replaceStringsInJson(value: unknown, query: string, replacement: string): Record<string, unknown> {
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit)
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, nested]) => [key, key === 'text' && typeof nested === 'string' ? nested.split(query).join(replacement) : visit(nested)]))
    return item
  }
  return visit(value) as Record<string, unknown>
}

function knobsFromRow(row: Row | VoiceKnobs | null | undefined): VoiceKnobs {
  if (!row) return normalizeVoiceKnobs(null)
  if ('authorNote' in row && !('author_note' in row)) return normalizeVoiceKnobs(row)
  return normalizeVoiceKnobs({
    family: row.family as VoiceKnobs['family'],
    intensity: row.intensity as VoiceKnobs['intensity'],
    pace: row.pace as VoiceKnobs['pace'],
    imagery: row.imagery as VoiceKnobs['imagery'],
    distance: row.distance as VoiceKnobs['distance'],
    interiority: row.interiority as VoiceKnobs['interiority'],
    intents: jsonParse(String(row.intents_json ?? '[]'), []),
    register: row.register as VoiceKnobs['register'],
    sentence: row.sentence as VoiceKnobs['sentence'],
    dialogue: row.dialogue as VoiceKnobs['dialogue'],
    allusion: row.allusion as VoiceKnobs['allusion'],
    slang: row.slang as VoiceKnobs['slang'],
    authorNote: String(row.author_note ?? row.authorNote ?? ''),
  })
}

function mapStyleAnalysis(row: Row): StyleAnalysisRun {
  return {
    id: String(row.id), projectId: String(row.project_id), sampleIds: jsonParse(String(row.sample_ids_json), []),
    metrics: jsonParse(String(row.metrics_json), {} as StyleAnalysisRun['metrics']),
    suggested: normalizeVoiceKnobs(jsonParse(String(row.suggested_json), {})),
    evidence: jsonParse(String(row.evidence_json), []), warnings: jsonParse(String(row.warnings_json), []),
    confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null, createdAt: String(row.created_at),
  }
}

function plainTextToDoc(text: string): Record<string, unknown> {
  return { type: 'doc', content: text.split(/\n/).map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : undefined })) }
}

function intervalsOverlap(aFrom: string | null, aTo: string | null, bFrom: string | null, bTo: string | null): boolean {
  if (!aFrom || !bFrom) return false
  const aEnd = aTo ?? '\uffff'
  const bEnd = bTo ?? '\uffff'
  return aFrom < bEnd && bFrom < aEnd
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

function backupBeforeMigration(databasePath: string, targetVersion: number) {
  if (!fs.existsSync(databasePath) || fs.statSync(databasePath).size === 0) return
  let currentVersion = 0
  try {
    const existing = new DatabaseSync(databasePath)
    try {
      existing.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      const hasMigrations = existing.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()
      if (hasMigrations) currentVersion = Number((existing.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get() as Row).version)
    } finally { existing.close() }
  } catch { return }
  if (currentVersion >= targetVersion) return
  const backupDir = path.join(path.dirname(databasePath), 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replaceAll(':', '-')
  fs.copyFileSync(databasePath, path.join(backupDir, `pre-migration-v${currentVersion}-to-v${targetVersion}-${stamp}.sqlite`))
}
