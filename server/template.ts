import { z } from 'zod'
import type {
  ManuscriptNode,
  TemplateApplication,
  TemplateCapability,
  TemplateGrant,
  TemplateInstallation,
  TemplatePackage,
  TemplatePackageInspection,
  TemplatePreview,
  TemplateRule,
  TemplateRuleResult,
  TemplateStructureNode,
} from '../shared/types.js'
import { AppDatabase } from './db.js'
import { jsonParse, newId, nowIso, sha256 } from './utils.js'

type Row = Record<string, unknown>

const capabilitySchema = z.enum(['project.summary.read', 'plan.nodes.create', 'local.rules.run'])
const nodeSchema = z.object({
  localId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  parentLocalId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/).nullable(),
  type: z.enum(['chapter', 'scene']),
  title: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(''),
  status: z.enum(['idea', 'planned']).default('planned'),
}).strict()
const ruleSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  kind: z.enum(['minimum_scene_count', 'unique_titles']),
  title: z.string().trim().min(1).max(120),
  config: z.record(z.string(), z.unknown()).default({}),
}).strict()
const manifestSchema = z.object({
  packageId: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,99}$/),
  name: z.string().trim().min(1).max(120),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/),
  description: z.string().max(1000),
  authorLabel: z.string().trim().min(1).max(120),
  license: z.string().trim().min(1).max(120),
  sourceUrl: z.union([z.literal(''), z.string().url().max(500)]),
  capabilities: z.array(capabilitySchema).max(3),
  structureHash: z.string().length(64),
}).strict()
const packageSchema = z.object({
  format: z.literal('bbd-template-v1'),
  protocolVersion: z.literal(1),
  manifest: manifestSchema,
  structure: z.object({ nodes: z.array(nodeSchema).min(2).max(100), rules: z.array(ruleSchema).max(20) }).strict(),
  packageHash: z.string().length(64),
}).strict().superRefine((value, context) => {
  const capabilities = new Set(value.manifest.capabilities)
  if (capabilities.size !== value.manifest.capabilities.length) context.addIssue({ code: 'custom', message: '能力声明不能重复' })
  if (!capabilities.has('plan.nodes.create')) context.addIssue({ code: 'custom', message: '结构模板必须声明创建计划节点能力' })
  if (value.structure.rules.length && !capabilities.has('local.rules.run')) context.addIssue({ code: 'custom', message: '包含本地规则的模板必须声明规则能力' })
  const ids = new Set<string>()
  const nodes = new Map(value.structure.nodes.map((node) => [node.localId, node]))
  for (const node of value.structure.nodes) {
    if (ids.has(node.localId)) context.addIssue({ code: 'custom', message: `结构节点 ID 重复：${node.localId}` })
    ids.add(node.localId)
    if (node.type === 'chapter' && node.parentLocalId !== null) context.addIssue({ code: 'custom', message: `章节 ${node.localId} 不能有模板内父节点` })
    if (node.type === 'scene' && (!node.parentLocalId || nodes.get(node.parentLocalId)?.type !== 'chapter')) context.addIssue({ code: 'custom', message: `场景 ${node.localId} 必须指向模板内章节` })
  }
  const siblingTitles = new Set<string>()
  for (const node of value.structure.nodes) {
    const key = `${node.parentLocalId ?? 'root'}:${node.title.normalize('NFKC').toLocaleLowerCase('zh-CN')}`
    if (siblingTitles.has(key)) context.addIssue({ code: 'custom', message: `同级结构标题重复：${node.title}` })
    siblingTitles.add(key)
  }
  const ruleIds = new Set<string>()
  for (const rule of value.structure.rules) {
    if (ruleIds.has(rule.id)) context.addIssue({ code: 'custom', message: `规则 ID 重复：${rule.id}` })
    ruleIds.add(rule.id)
    if (rule.kind === 'minimum_scene_count') {
      const min = Number(rule.config.min)
      if (!Number.isInteger(min) || min < 1 || min > 1000) context.addIssue({ code: 'custom', message: `规则 ${rule.id} 的 min 必须是 1–1000` })
    }
  }
})

export class TemplateService {
  constructor(private readonly database: AppDatabase) {
    this.installPackage(createBuiltInTemplate(), true)
  }

  inspectPackage(input: unknown): TemplatePackageInspection {
    const templatePackage = verifyPackage(input)
    const existing = this.findByKey(templatePackage.manifest.packageId, templatePackage.manifest.version)
    return {
      valid: true,
      duplicate: Boolean(existing && existing.packageHash === templatePackage.packageHash),
      collision: Boolean(existing && existing.packageHash !== templatePackage.packageHash),
      manifest: templatePackage.manifest,
      chapterCount: templatePackage.structure.nodes.filter((node) => node.type === 'chapter').length,
      sceneCount: templatePackage.structure.nodes.filter((node) => node.type === 'scene').length,
      ruleCount: templatePackage.structure.rules.length,
      packageHash: templatePackage.packageHash,
      warnings: [
        '作者标签和来源网址均为包内自述，不代表认证身份。',
        '模板是声明式数据，不会获得正文、网络、密钥、任意文件或系统命令权限。',
      ],
    }
  }

  installPackage(input: unknown, builtIn = false): TemplateInstallation {
    const templatePackage = verifyPackage(input)
    const existing = this.findByKey(templatePackage.manifest.packageId, templatePackage.manifest.version)
    if (existing && existing.packageHash !== templatePackage.packageHash) throw new Error('Template package ID collision')
    if (existing) {
      if (existing.status === 'uninstalled') {
        const updatedAt = nowIso()
        this.database.db.prepare('UPDATE template_packages SET enabled=1,uninstalled_at=NULL,updated_at=? WHERE id=?').run(updatedAt, existing.id)
        this.recordEvent(existing.id, null, null, 'restored', { packageHash: existing.packageHash }, updatedAt)
      }
      return this.getInstallation(existing.id)!
    }
    const id = newId(); const installedAt = nowIso(); const structureJson = stableStringify(templatePackage.structure)
    this.database.transaction(() => {
      this.database.db.prepare(`INSERT INTO template_resources(content_hash,media_type,content_json,byte_size,created_at) VALUES(?,?,?,?,?)
        ON CONFLICT(content_hash) DO NOTHING`).run(templatePackage.manifest.structureHash, 'application/vnd.bibudai.structure+json', structureJson, Buffer.byteLength(structureJson), installedAt)
      this.database.db.prepare(`INSERT INTO template_packages(id,package_key,name,version,description,author_label,license,source_url,capabilities_json,package_json,package_hash,enabled,built_in,installed_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, templatePackage.manifest.packageId, templatePackage.manifest.name, templatePackage.manifest.version, templatePackage.manifest.description, templatePackage.manifest.authorLabel, templatePackage.manifest.license, templatePackage.manifest.sourceUrl, JSON.stringify(templatePackage.manifest.capabilities), JSON.stringify(templatePackage), templatePackage.packageHash, 1, builtIn ? 1 : 0, installedAt, installedAt)
      this.database.db.prepare('INSERT INTO template_package_resources(package_id,content_hash,resource_path) VALUES(?,?,?)').run(id, templatePackage.manifest.structureHash, 'structure.json')
      this.recordEvent(id, null, null, 'installed', { builtIn, packageHash: templatePackage.packageHash }, installedAt)
    })
    return this.getInstallation(id)!
  }

  listInstallations(includeUninstalled = true): TemplateInstallation[] {
    const rows = this.database.db.prepare(`SELECT * FROM template_packages ${includeUninstalled ? '' : 'WHERE uninstalled_at IS NULL'} ORDER BY built_in DESC,name,version`).all() as Row[]
    return rows.map(mapInstallation)
  }

  getInstallation(id: string): TemplateInstallation | null {
    const row = this.database.db.prepare('SELECT * FROM template_packages WHERE id=?').get(id) as Row | undefined
    return row ? mapInstallation(row) : null
  }

  setInstallationStatus(id: string, status: 'enabled' | 'disabled' | 'uninstalled'): TemplateInstallation {
    const installation = this.requireInstallation(id)
    const updatedAt = nowIso()
    this.database.db.prepare('UPDATE template_packages SET enabled=?,uninstalled_at=?,updated_at=? WHERE id=?').run(status === 'enabled' ? 1 : 0, status === 'uninstalled' ? updatedAt : null, updatedAt, id)
    this.recordEvent(id, null, null, status === 'enabled' ? 'enabled' : status === 'disabled' ? 'disabled' : 'uninstalled', { previousStatus: installation.status }, updatedAt)
    return this.getInstallation(id)!
  }

  listGrants(projectId: string, installationId: string): TemplateGrant[] {
    const project = this.database.getProject(projectId); if (!project) throw new Error('Project not found')
    const installation = this.requireInstallation(installationId)
    const rows = this.database.db.prepare('SELECT * FROM template_grants WHERE project_id=? AND package_id=?').all(projectId, installationId) as Row[]
    const byCapability = new Map(rows.map((row) => [String(row.capability), row]))
    return installation.manifest.capabilities.map((capability) => {
      const row = byCapability.get(capability)
      return { projectId, installationId, capability, granted: Boolean(row?.granted), updatedAt: row ? String(row.updated_at) : '' }
    })
  }

  setGrant(projectId: string, installationId: string, capability: TemplateCapability, granted: boolean): TemplateGrant {
    if (!this.database.getProject(projectId)) throw new Error('Project not found')
    const installation = this.requireInstallation(installationId)
    if (!installation.manifest.capabilities.includes(capability)) throw new Error('Template capability was not requested')
    if (installation.status !== 'enabled') throw new Error('Template package is not enabled')
    const updatedAt = nowIso()
    this.database.db.prepare(`INSERT INTO template_grants(project_id,package_id,capability,granted,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(project_id,package_id,capability) DO UPDATE SET granted=excluded.granted,updated_at=excluded.updated_at`).run(projectId, installationId, capability, granted ? 1 : 0, updatedAt)
    this.recordEvent(installationId, projectId, null, granted ? 'granted' : 'revoked', { capability }, updatedAt)
    return { projectId, installationId, capability, granted, updatedAt }
  }

  preview(projectId: string, installationId: string): TemplatePreview {
    const project = this.database.getProject(projectId); if (!project) throw new Error('Project not found')
    const installation = this.requireInstallation(installationId)
    if (installation.status !== 'enabled') throw new Error('Template package is not enabled')
    const nodes = this.database.listNodes(projectId)
    const grants = this.listGrants(projectId, installationId)
    const granted = new Set(grants.filter((grant) => grant.granted).map((grant) => grant.capability))
    const missingCapabilities = installation.manifest.capabilities.filter((capability) => !granted.has(capability))
    const chapters = nodes.filter((node) => node.type === 'chapter')
    const scenes = nodes.filter((node) => node.type === 'scene')
    const existingChapterTitles = new Set(chapters.map((node) => normalized(node.title)))
    const packageNodes = installation.package.structure.nodes
    const titleByLocalId = new Map(packageNodes.map((node) => [node.localId, node.title]))
    const previewNodes = packageNodes.map((node) => ({ ...node, parentTitle: node.parentLocalId ? titleByLocalId.get(node.parentLocalId) ?? '' : '书稿根目录', conflict: node.type === 'chapter' && existingChapterTitles.has(normalized(node.title)) ? 'title' as const : 'none' as const }))
    const conflicts = previewNodes.filter((node) => node.conflict !== 'none').map((node) => `已有同名章节“${node.title}”；应用时需明确改名。`)
    const ruleResults = granted.has('local.rules.run') ? runRules(installation.package.structure.rules, nodes) : []
    const projectSummary = granted.has('project.summary.read') ? { title: project.title, description: project.description, chapterCount: chapters.length, sceneCount: scenes.length } : null
    const previewBasis = { projectId, installationId, packageHash: installation.packageHash, existing: nodes.map((node) => ({ id: node.id, parentId: node.parentId, type: node.type, title: node.title, deletedAt: node.deletedAt })), nodes: previewNodes, conflicts, ruleResults }
    return { projectId, installationId, packageHash: installation.packageHash, previewHash: sha256(stableStringify(previewBasis)), projectSummary, nodes: previewNodes, conflicts, ruleResults, requiredCapabilities: installation.manifest.capabilities, missingCapabilities }
  }

  apply(projectId: string, installationId: string, previewHash: string, conflictStrategy: 'cancel' | 'rename' = 'cancel'): TemplateApplication {
    const preview = this.preview(projectId, installationId)
    if (preview.previewHash !== previewHash) throw new Error('Template preview is stale')
    if (preview.missingCapabilities.length) throw new Error(`Template capability grant required: ${preview.missingCapabilities.join(', ')}`)
    if (preview.conflicts.length && conflictStrategy === 'cancel') throw new Error('Template title conflict requires explicit rename')
    const installation = this.requireInstallation(installationId)
    const nodes = this.database.listNodes(projectId)
    const book = nodes.find((node) => node.type === 'book' && !node.deletedAt); if (!book) throw new Error('Project book not found')
    const existingTitles = new Set(nodes.filter((node) => node.type === 'chapter' && !node.deletedAt).map((node) => normalized(node.title)))
    const createdNodeIds: string[] = []; const createdByLocalId = new Map<string, ManuscriptNode>(); const applicationId = newId(); const appliedAt = nowIso()
    this.database.transaction(() => {
      for (const templateNode of installation.package.structure.nodes.filter((node) => node.type === 'chapter')) {
        const title = conflictStrategy === 'rename' ? uniqueTitle(templateNode.title, existingTitles) : templateNode.title
        existingTitles.add(normalized(title))
        const created = this.database.createNode({ projectId, parentId: book.id, type: 'chapter', title })
        this.database.updateNode(created.id, { status: templateNode.status })
        createdNodeIds.push(created.id); createdByLocalId.set(templateNode.localId, created)
      }
      for (const templateNode of installation.package.structure.nodes.filter((node) => node.type === 'scene')) {
        const parent = createdByLocalId.get(templateNode.parentLocalId!); if (!parent) throw new Error('Template parent node missing')
        const created = this.database.createNode({ projectId, parentId: parent.id, type: 'scene', title: templateNode.title })
        this.database.updateNode(created.id, { status: templateNode.status })
        createdNodeIds.push(created.id); createdByLocalId.set(templateNode.localId, created)
      }
      this.database.db.prepare('INSERT INTO template_applications(id,project_id,package_id,preview_hash,created_nodes_json,status,applied_at) VALUES(?,?,?,?,?,?,?)').run(applicationId, projectId, installationId, previewHash, JSON.stringify(createdNodeIds), 'applied', appliedAt)
      this.recordEvent(installationId, projectId, applicationId, 'applied', { packageHash: installation.packageHash, createdNodeIds, conflictStrategy }, appliedAt)
      this.database.recordProvenanceEvent({ projectId, eventType: 'template_applied', actorType: 'human', contentHash: sha256(stableStringify(createdNodeIds)), metadata: { applicationId, packageId: installation.manifest.packageId, version: installation.manifest.version, createdNodeCount: createdNodeIds.length }, createdAt: appliedAt })
    })
    return this.getApplication(applicationId)!
  }

  listApplications(projectId: string): TemplateApplication[] {
    return (this.database.db.prepare(`SELECT a.*,p.name,p.version FROM template_applications a JOIN template_packages p ON p.id=a.package_id WHERE a.project_id=? ORDER BY a.applied_at DESC,a.rowid DESC`).all(projectId) as Row[]).map(mapApplication)
  }

  getApplication(id: string): TemplateApplication | null {
    const row = this.database.db.prepare(`SELECT a.*,p.name,p.version FROM template_applications a JOIN template_packages p ON p.id=a.package_id WHERE a.id=?`).get(id) as Row | undefined
    return row ? mapApplication(row) : null
  }

  revert(applicationId: string): TemplateApplication {
    const application = this.getApplication(applicationId); if (!application) throw new Error('Template application not found')
    if (application.status === 'reverted') throw new Error('Template application already reverted')
    const row = this.database.db.prepare('SELECT package_id FROM template_applications WHERE id=?').get(applicationId) as Row
    const installationId = String(row.package_id); const revertedAt = nowIso(); const nodeSet = new Set(application.createdNodeIds)
    this.database.transaction(() => {
      const roots = application.createdNodeIds.map((id) => this.database.getNode(id)).filter((node): node is ManuscriptNode => Boolean(node)).filter((node) => !node.parentId || !nodeSet.has(node.parentId))
      for (const node of roots) this.database.softDeleteNode(node.id, true)
      this.database.db.prepare("UPDATE template_applications SET status='reverted',reverted_at=? WHERE id=?").run(revertedAt, applicationId)
      this.recordEvent(installationId, application.projectId, applicationId, 'reverted', { createdNodeIds: application.createdNodeIds, recoverableTrash: true }, revertedAt)
      this.database.recordProvenanceEvent({ projectId: application.projectId, eventType: 'template_reverted', actorType: 'human', contentHash: sha256(stableStringify(application.createdNodeIds)), metadata: { applicationId, recoverableTrash: true }, createdAt: revertedAt })
    })
    return this.getApplication(applicationId)!
  }

  exportProjectBundle(projectId: string) {
    const applications = this.listApplications(projectId)
    const installationIds = new Set<string>()
    for (const row of this.database.db.prepare('SELECT DISTINCT package_id FROM template_grants WHERE project_id=? UNION SELECT DISTINCT package_id FROM template_applications WHERE project_id=?').all(projectId, projectId) as Row[]) installationIds.add(String(row.package_id))
    return {
      packages: [...installationIds].map((id) => this.getInstallation(id)?.package).filter(Boolean),
      packageIds: [...installationIds].map((id) => {
        const installation = this.getInstallation(id)!
        return { installationId: id, packageId: installation.manifest.packageId, version: installation.manifest.version }
      }),
      grants: this.database.db.prepare('SELECT package_id AS installationId,capability,granted,updated_at AS updatedAt FROM template_grants WHERE project_id=?').all(projectId),
      applications,
    }
  }

  importProjectBundle(projectId: string, bundle: any, nodeMap: Map<string, string>) {
    const installationMap = new Map<string, string>()
    for (const packageInput of bundle?.packages ?? []) {
      const oldId = (bundle?.packageIds ?? []).find((item: any) => item.packageId === packageInput.manifest?.packageId && item.version === packageInput.manifest?.version)?.installationId
      const installed = this.installPackage(packageInput)
      if (oldId) installationMap.set(String(oldId), installed.id)
    }
    const resolveInstallation = (oldId: string) => installationMap.get(oldId) ?? this.getInstallation(oldId)?.id ?? null
    for (const grant of bundle?.grants ?? []) {
      const installationId = resolveInstallation(String(grant.installationId)); if (!installationId) continue
      this.setGrant(projectId, installationId, grant.capability, Boolean(grant.granted))
    }
    for (const application of bundle?.applications ?? []) {
      const installationId = resolveInstallation(String(application.installationId)); if (!installationId) continue
      const mappedNodes = (application.createdNodeIds ?? []).map((id: string) => nodeMap.get(id)).filter(Boolean)
      if (!mappedNodes.length) continue
      this.database.db.prepare('INSERT INTO template_applications(id,project_id,package_id,preview_hash,created_nodes_json,status,applied_at,reverted_at) VALUES(?,?,?,?,?,?,?,?)').run(newId(), projectId, installationId, application.previewHash, JSON.stringify(mappedNodes), application.status, application.appliedAt, application.revertedAt ?? null)
    }
  }

  private findByKey(packageId: string, version: string): TemplateInstallation | null {
    const row = this.database.db.prepare('SELECT * FROM template_packages WHERE package_key=? AND version=?').get(packageId, version) as Row | undefined
    return row ? mapInstallation(row) : null
  }

  private requireInstallation(id: string): TemplateInstallation {
    const installation = this.getInstallation(id); if (!installation) throw new Error('Template package not found')
    return installation
  }

  private recordEvent(packageId: string, projectId: string | null, applicationId: string | null, eventType: string, metadata: Record<string, unknown>, createdAt = nowIso()) {
    this.database.db.prepare('INSERT INTO template_events(id,project_id,package_id,application_id,event_type,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)').run(newId(), projectId, packageId, applicationId, eventType, JSON.stringify(metadata), createdAt)
  }
}

export function createTemplatePackage(input: Omit<TemplatePackage, 'format' | 'protocolVersion' | 'packageHash' | 'manifest'> & { manifest: Omit<TemplatePackage['manifest'], 'structureHash'> }): TemplatePackage {
  const structureHash = sha256(stableStringify(input.structure))
  const base = { format: 'bbd-template-v1' as const, protocolVersion: 1 as const, manifest: { ...input.manifest, structureHash }, structure: input.structure }
  return { ...base, packageHash: sha256(stableStringify(base)) }
}

export function verifyPackage(input: unknown): TemplatePackage {
  const parsed = packageSchema.parse(input) as TemplatePackage
  const structureHash = sha256(stableStringify(parsed.structure))
  if (structureHash !== parsed.manifest.structureHash) throw new Error('Template structure hash mismatch; package may be tampered')
  const { packageHash, ...base } = parsed
  if (sha256(stableStringify(base)) !== packageHash) throw new Error('Template package hash mismatch; package may be tampered')
  if (Buffer.byteLength(JSON.stringify(parsed)) > 512 * 1024) throw new Error('Template package exceeds 512 KiB limit')
  return parsed
}

function createBuiltInTemplate(): TemplatePackage {
  const nodes: TemplateStructureNode[] = [
    { localId: 'act-1', parentLocalId: null, type: 'chapter', title: '第一幕：建立', description: '建立人物、目标与失衡。', status: 'planned' },
    { localId: 'act-1-opening', parentLocalId: 'act-1', type: 'scene', title: '开场意象', description: '呈现故事开始时的世界状态。', status: 'idea' },
    { localId: 'act-1-inciting', parentLocalId: 'act-1', type: 'scene', title: '诱发事件', description: '打破原有平衡。', status: 'planned' },
    { localId: 'act-1-choice', parentLocalId: 'act-1', type: 'scene', title: '跨过门槛', description: '主角作出不可轻易撤回的选择。', status: 'planned' },
    { localId: 'act-2', parentLocalId: null, type: 'chapter', title: '第二幕：对抗', description: '行动、反作用与中点变化。', status: 'planned' },
    { localId: 'act-2-progress', parentLocalId: 'act-2', type: 'scene', title: '初次推进', description: '策略暂时奏效。', status: 'planned' },
    { localId: 'act-2-midpoint', parentLocalId: 'act-2', type: 'scene', title: '中点反转', description: '信息或代价改变行动逻辑。', status: 'planned' },
    { localId: 'act-2-low', parentLocalId: 'act-2', type: 'scene', title: '最低谷', description: '旧策略失效。', status: 'planned' },
    { localId: 'act-3', parentLocalId: null, type: 'chapter', title: '第三幕：解决', description: '最终选择与余波。', status: 'planned' },
    { localId: 'act-3-climax', parentLocalId: 'act-3', type: 'scene', title: '高潮抉择', description: '主角以行动回答核心命题。', status: 'planned' },
    { localId: 'act-3-ending', parentLocalId: 'act-3', type: 'scene', title: '结尾意象', description: '显示变化后的新平衡。', status: 'planned' },
  ]
  const rules: TemplateRule[] = [
    { id: 'minimum-scenes', kind: 'minimum_scene_count', title: '至少八个计划场景', config: { min: 8 } },
    { id: 'unique-titles', kind: 'unique_titles', title: '计划节点标题不重复', config: {} },
  ]
  return createTemplatePackage({
    manifest: { packageId: 'bibudai.local.three-act', name: '三幕结构起步包', version: '1.0.0', description: '本地示例模板：三幕、八个关键场景和两条声明式检查规则。', authorLabel: '笔不怠本地示例（非认证身份）', license: 'CC0-1.0', sourceUrl: '', capabilities: ['project.summary.read', 'plan.nodes.create', 'local.rules.run'] },
    structure: { nodes, rules },
  })
}

function runRules(rules: TemplateRule[], nodes: ManuscriptNode[]): TemplateRuleResult[] {
  const active = nodes.filter((node) => !node.deletedAt)
  return rules.map((rule) => {
    if (rule.kind === 'minimum_scene_count') {
      const minimum = Number(rule.config.min); const count = active.filter((node) => node.type === 'scene').length
      return { ruleId: rule.id, title: rule.title, passed: count >= minimum, message: count >= minimum ? `已有 ${count} 个场景，达到至少 ${minimum} 个的规则。` : `当前 ${count} 个场景，建议达到至少 ${minimum} 个。` }
    }
    const groups = new Map<string, number>()
    for (const node of active.filter((item) => item.type === 'chapter' || item.type === 'scene')) groups.set(normalized(node.title), (groups.get(normalized(node.title)) ?? 0) + 1)
    const duplicateCount = [...groups.values()].filter((count) => count > 1).length
    return { ruleId: rule.id, title: rule.title, passed: duplicateCount === 0, message: duplicateCount ? `发现 ${duplicateCount} 组重复标题，请人工复核。` : '当前章节和场景标题没有重复。' }
  })
}

function mapInstallation(row: Row): TemplateInstallation {
  const templatePackage = jsonParse<TemplatePackage>(String(row.package_json), {} as TemplatePackage)
  return { id: String(row.id), manifest: templatePackage.manifest, package: templatePackage, packageHash: String(row.package_hash), status: row.uninstalled_at ? 'uninstalled' : row.enabled ? 'enabled' : 'disabled', builtIn: Boolean(row.built_in), installedAt: String(row.installed_at), updatedAt: String(row.updated_at) }
}

function mapApplication(row: Row): TemplateApplication {
  return { id: String(row.id), projectId: String(row.project_id), installationId: String(row.package_id), packageName: String(row.name), packageVersion: String(row.version), previewHash: String(row.preview_hash), createdNodeIds: jsonParse<string[]>(String(row.created_nodes_json), []), status: row.status as TemplateApplication['status'], appliedAt: String(row.applied_at), revertedAt: row.reverted_at ? String(row.reverted_at) : null }
}

function normalized(value: string) { return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN') }
function uniqueTitle(base: string, existing: Set<string>) {
  if (!existing.has(normalized(base))) return base
  let index = 1
  while (existing.has(normalized(`${base}（模板${index > 1 ? ` ${index}` : ''}）`))) index += 1
  return `${base}（模板${index > 1 ? ` ${index}` : ''}）`
}
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(',')}}`
  return JSON.stringify(value)
}
