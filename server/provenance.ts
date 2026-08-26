import type { ProvenanceBundle, ProvenanceManifestEvent, ProvenanceVerification, Revision } from '../shared/types.js'
import { AppDatabase, provenanceEventHash } from './db.js'
import { nowIso, sha256 } from './utils.js'

export function buildProvenanceBundle(database: AppDatabase, projectId: string, includeTextExcerpts = false): ProvenanceBundle {
  const project = database.getProject(projectId)
  if (!project) throw new Error('Project not found')
  const events = database.listProvenanceEvents(projectId)
  const revisionCache = new Map<string, Revision[]>()
  const manifestEvents: ProvenanceManifestEvent[] = events.map((event, index) => {
    let revision: Revision | undefined
    if (event.nodeId && event.revisionId) {
      if (!revisionCache.has(event.nodeId)) revisionCache.set(event.nodeId, database.listRevisions(event.nodeId))
      revision = revisionCache.get(event.nodeId)?.find((item) => item.id === event.revisionId)
    }
    const item: ProvenanceManifestEvent = {
      sequence: index + 1, id: event.id, nodeId: event.nodeId, revisionId: event.revisionId, eventType: event.eventType, actorType: event.actorType,
      sourceTaskId: event.sourceTaskId, sourceRevisionId: event.sourceRevisionId, contentHash: event.contentHash, metadata: event.metadata,
      previousHash: event.previousHash, eventHash: event.eventHash, createdAt: event.createdAt, nodeTitle: event.nodeTitle ?? '',
      parentRevisionId: revision?.parentRevisionId ?? null, provenanceLabel: revision?.provenanceLabel ?? null,
    }
    if (includeTextExcerpts && revision) item.textExcerpt = excerpt(revision.plainText)
    return item
  })
  const manifest: ProvenanceBundle['manifest'] = {
    formatVersion: 1,
    exportedAt: nowIso(),
    project: { title: project.title, projectFingerprint: sha256(events[0]?.eventHash ?? project.createdAt) },
    privacy: { includesTextExcerpts: includeTextExcerpts, excludesPromptsAndSecrets: true },
    events: manifestEvents,
    chainHead: manifestEvents.at(-1)?.eventHash ?? null,
  }
  return { format: 'bbd-provenance-v1', manifest, manifestHash: sha256(JSON.stringify(manifest)) }
}

export function verifyProvenanceBundle(value: unknown): ProvenanceVerification {
  if (!value || typeof value !== 'object') return failed('证明包不是有效对象')
  const bundle = value as Partial<ProvenanceBundle>
  if (bundle.format !== 'bbd-provenance-v1' || !bundle.manifest || typeof bundle.manifestHash !== 'string') return failed('不支持的证明包格式')
  const manifestHashValid = sha256(JSON.stringify(bundle.manifest)) === bundle.manifestHash
  const events = Array.isArray(bundle.manifest.events) ? bundle.manifest.events : []
  let previousHash: string | null = null
  let chainValid = true
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    const hash = provenanceEventHash({ eventType: event.eventType, actorType: event.actorType, contentHash: event.contentHash, metadata: event.metadata, previousHash: event.previousHash, createdAt: event.createdAt })
    if (event.sequence !== index + 1 || event.previousHash !== previousHash || event.eventHash !== hash) { chainValid = false; break }
    previousHash = event.eventHash
  }
  if (bundle.manifest.chainHead !== previousHash) chainValid = false
  const ok = manifestHashValid && chainValid
  return { ok, manifestHashValid, chainValid, eventCount: events.length, message: ok ? `验证通过：${events.length} 条来源事件与清单哈希一致` : !manifestHashValid ? '验证失败：清单内容已被修改' : '验证失败：来源事件链断裂或事件被修改' }
}

export function renderProvenanceHtml(bundle: ProvenanceBundle): string {
  const rows = bundle.manifest.events.map((event) => `<tr><td>${event.sequence}</td><td>${escapeHtml(event.createdAt)}</td><td>${escapeHtml(eventLabel(event.eventType))}</td><td>${escapeHtml(event.nodeTitle || '项目')}</td><td><code>${escapeHtml(event.contentHash.slice(0, 12) || '—')}</code></td><td><code>${escapeHtml(event.eventHash.slice(0, 12))}</code></td></tr>${event.textExcerpt ? `<tr class="excerpt"><td colspan="6">${escapeHtml(event.textExcerpt)}</td></tr>` : ''}`).join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(bundle.manifest.project.title)} · 创作来源报告</title><style>body{font:14px/1.6 system-ui,sans-serif;color:#26231f;max-width:1080px;margin:40px auto;padding:0 24px}h1{font-family:serif}header,p{color:#686158}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{padding:9px;border-bottom:1px solid #ddd8cc;text-align:left;vertical-align:top}.excerpt td{background:#f6f3ec;color:#5f594f}code{font-size:12px}footer{margin-top:30px;padding:16px;background:#f3f6f3;color:#315c4a}</style></head><body><header>笔不怠 · bbd-provenance-v1</header><h1>${escapeHtml(bundle.manifest.project.title)}：创作来源报告</h1><p>导出时间：${escapeHtml(bundle.manifest.exportedAt)} · 事件：${bundle.manifest.events.length} · 正文摘录：${bundle.manifest.privacy.includesTextExcerpts ? '作者已明确选择包含' : '不包含'}</p><p>清单 SHA-256：<code>${bundle.manifestHash}</code></p><table><thead><tr><th>#</th><th>时间</th><th>动作</th><th>对象</th><th>内容哈希</th><th>事件哈希</th></tr></thead><tbody>${rows}</tbody></table><footer>本报告用于说明本地记录的创作过程，不自动构成版权、司法效力或平台原创认证。JSON 证明包可用于完整离线校验。</footer></body></html>`
}

function excerpt(text: string) { const clean = text.trim(); return clean.length > 500 ? `${clean.slice(0, 500)}…` : clean }
function failed(message: string): ProvenanceVerification { return { ok: false, manifestHashValid: false, chainValid: false, eventCount: 0, message } }
function escapeHtml(value: string) { return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!) }
function eventLabel(type: string) { return ({ human_edit: '人工编辑', ai_generated: 'AI 候选生成', ai_failed: 'AI 任务失败', ai_accepted: '接受 AI 建议', ai_rejected: '拒绝 AI 候选', ai_undone: '撤销 AI 接受', human_after_ai: 'AI 后人工修订', import: '导入', restore: '恢复版本', merge: '拆分或合并', replace: '批量替换', replace_undone: '撤销批量替换', candidate_created: '事实候选', candidate_accepted: '接受事实候选', candidate_rejected: '拒绝事实候选' } as Record<string, string>)[type] ?? type }
