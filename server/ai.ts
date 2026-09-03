import type { AiContextItem, AiStreamEvent, AiTaskResult, EntityState, TextSelectionAnchor } from '../shared/types.js'
import { storyTimeContext } from '../shared/storyTime.js'
import { compileVoiceContract } from '../shared/voice.js'
import type { AppDatabase } from './db.js'
import { estimateTokens, newId, nowIso, sha256 } from './utils.js'
import type { LocalVault } from './vault.js'
import { knowledgeKnownAt } from './knowledge.js'

export interface AiSettings {
  baseUrl: string
  model: string
  apiKey: string
}

export interface AiTaskInput {
  projectId: string
  nodeId: string
  taskType: string
  instruction: string
  selectedContextIds: string[]
  selectionAnchor?: TextSelectionAnchor
}

export type AiProviderKind = 'demo' | 'ollama' | 'blocked'

const OLLAMA_BASE_URLS = new Set([
  'http://127.0.0.1:11434/v1',
  'http://localhost:11434/v1',
])

export class AiService {
  private warming: Promise<{ ok: boolean; message: string }> | null = null

  constructor(private readonly database: AppDatabase, private readonly vault: LocalVault) {}

  getSettings(): Omit<AiSettings, 'apiKey'> & { hasApiKey: boolean; credentialStore: LocalVault['storage']; provider: AiProviderKind; costPolicy: 'local_only' } {
    const row = this.database.db.prepare('SELECT * FROM ai_settings WHERE id=1').get() as Record<string, unknown> | undefined
    const baseUrl = row ? String(row.base_url) : 'mock://local'
    return { baseUrl, model: row ? String(row.model) : '笔不怠演示模型', hasApiKey: Boolean(row?.encrypted_api_key), credentialStore: this.vault.storage, provider: providerKind(baseUrl), costPolicy: 'local_only' }
  }

  saveSettings(settings: AiSettings) {
    assertFreeLocalSettings(settings)
    this.database.db.prepare(`INSERT INTO ai_settings(id,base_url,model,encrypted_api_key,updated_at) VALUES(1,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET base_url=excluded.base_url,model=excluded.model,encrypted_api_key=excluded.encrypted_api_key,updated_at=excluded.updated_at`).run(
      normalizeBaseUrl(settings.baseUrl), settings.model.trim(), '', nowIso(),
    )
    return this.getSettings()
  }

  async testConnection(settings?: AiSettings): Promise<{ ok: boolean; message: string }> {
    const active = settings ?? this.loadFullSettings()
    if (active.baseUrl.startsWith('mock://')) return { ok: true, message: '本地演示模型可用；不会发送稿件。' }
    if (providerKind(active.baseUrl) !== 'ollama') return { ok: false, message: '零费用保护已拦截外网模型地址。请改用本机 Ollama。' }
    if (!active.model.trim()) return { ok: false, message: '请选择一个本地模型。' }
    try {
      const response = await fetch(`${normalizeBaseUrl(active.baseUrl)}/models`, { signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return { ok: false, message: `Ollama 响应异常：HTTP ${response.status}` }
      const payload = await response.json() as { data?: Array<{ id?: string }> }
      const models = (payload.data ?? []).map((item) => item.id).filter(Boolean)
      if (!models.includes(active.model)) return { ok: false, message: `Ollama 已运行，但还没有 ${active.model}。请先执行：ollama pull ${active.model}` }
      return { ok: true, message: `本地模型 ${active.model} 可用；稿件不出本机，不会产生 API 费用。` }
    } catch (error) {
      return { ok: false, message: '未检测到本机 Ollama。请先安装并启动 Ollama，再下载所选模型。' }
    }
  }

  buildContext(projectId: string, nodeId: string): AiContextItem[] {
    const node = this.database.getNode(nodeId)
    const scene = this.database.getScene(nodeId)
    if (!node || !scene) throw new Error('Scene not found')
    const voice = this.database.getVoiceProfile(projectId, nodeId)
    const voiceExcerpts = this.voiceExcerpts(projectId, nodeId)
    const voiceContract = compileVoiceContract(voice, voiceExcerpts)
    const projectNodes = this.database.listNodes(projectId)
    const items: AiContextItem[] = [{
      id: nodeId, type: 'scene', title: `当前场景：${node.title}`, content: scene.plainText,
      reason: '当前文本与任务', privacyLevel: 'normal', selected: true, estimatedTokens: estimateTokens(scene.plainText),
    }, {
      id: `voice:${nodeId}`, type: 'voice', title: `本场景文风档 · ${voice.sourceLabel}`, content: voiceContract,
      reason: voice.authorNote ? '作者原话与旋钮共同约束这一场的文笔' : '本场文笔契约；在场景页可以改档',
      privacyLevel: 'normal', selected: true, estimatedTokens: estimateTokens(voiceContract),
    }, {
      id: `time:${nodeId}`, type: 'time', title: '本场故事时间', content: storyTimeContext(node, projectNodes),
      reason: '用于判断人物状态、先后与倒叙；不会猜测缺失日期', privacyLevel: 'normal', selected: true, estimatedTokens: 30,
    }]
    const entities = this.database.listEntities(projectId)
    const mentionedNames = entities.filter((entity) => [entity.canonicalName, ...entity.aliases].some((name) => name.length >= 2 && scene.plainText.includes(name)))
    for (const entity of mentionedNames) {
      items.push({
        id: entity.id, type: 'entity', title: `${labelEntity(entity.type)}：${entity.canonicalName}`,
        content: entity.summary || '暂无简介', reason: '当前场景人物或设定', privacyLevel: entity.privacyLevel,
        selected: entity.privacyLevel !== 'local_private', estimatedTokens: estimateTokens(entity.summary || entity.canonicalName),
      })
      for (const field of this.database.listProfileFields(entity.id).filter((item) => item.privacyLevel !== 'local_private')) {
        const content = `${field.label}：${field.value}`
        items.push({ id: `profile:${field.id}`, type: 'entity', title: `${entity.canonicalName}档案 · ${field.category}`, content, reason: '当前场景实体的作者档案', privacyLevel: field.privacyLevel, selected: true, estimatedTokens: estimateTokens(content) })
      }
      if (entity.type === 'character' && this.database.getCharacterVoice(projectId, entity.id).updatedAt) {
        const content = this.database.characterVoiceContract(projectId, entity.id)
        items.push({ id: `character_voice:${entity.id}`, type: 'voice', title: `人物口吻：${entity.canonicalName}`, content, reason: '当前场景人物已设置对白口吻', privacyLevel: entity.privacyLevel, selected: entity.privacyLevel !== 'local_private', estimatedTokens: estimateTokens(content) })
      }
      for (const state of this.database.listStates(entity.id)) items.push(stateContext(state, entity.canonicalName, entity.privacyLevel))
    }
    const entityById = new Map(entities.map((entity) => [entity.id, entity]))
    const mentionedIds = new Set(mentionedNames.map((entity) => entity.id))
    for (const relationship of this.database.listRelationships(projectId, null, nodeId).filter((item) => item.currentState && item.privacyLevel !== 'local_private' && (mentionedIds.has(item.sourceEntityId) || mentionedIds.has(item.targetEntityId)))) {
      const source = entityById.get(relationship.sourceEntityId); const target = entityById.get(relationship.targetEntityId)
      if (!source || !target) continue
      const arrow = relationship.direction === 'mutual' ? ' ↔ ' : ' → '
      const state = relationship.currentState!
      const content = `${source.canonicalName}${arrow}${target.canonicalName}\n关系：${relationship.label || relationship.relationType}\n当前状态：${state.statusLabel}${state.note ? `\n${state.note}` : ''}`
      items.push({ id: `relationship:${relationship.id}`, type: 'relationship', title: `当前关系：${source.canonicalName} / ${target.canonicalName}`, content, reason: '与当前场景实体相连且在本场景有效', privacyLevel: relationship.privacyLevel, selected: relationship.privacyLevel !== 'local_private', estimatedTokens: estimateTokens(content) })
    }
    const nodes = projectNodes.filter((item) => item.type === 'scene' && item.id !== nodeId && item.sortKey < node.sortKey).sort((a, b) => b.sortKey - a.sortKey).slice(0, 2)
    for (const previous of nodes) {
      const doc = this.database.getScene(previous.id)
      if (!doc?.plainText) continue
      const excerpt = doc.plainText.slice(-800)
      items.push({ id: previous.id, type: 'history', title: `最近场景：${previous.title}`, content: excerpt, reason: '最近叙述历史', privacyLevel: 'normal', selected: true, estimatedTokens: estimateTokens(excerpt) })
    }
    for (const foreshadow of this.database.listForeshadows(projectId).filter((item) => item.status !== 'resolved')) {
      const content = [foreshadow.summary, foreshadow.plannedPayoff ? `计划回收：${foreshadow.plannedPayoff}` : '', `当前阶段：${foreshadowLabel(foreshadow.status)}`].filter(Boolean).join('\n')
      items.push({ id: `foreshadow:${foreshadow.id}`, type: 'foreshadow', title: `未回收伏笔：${foreshadow.title}`, content, reason: '避免遗忘或提前泄露伏笔', privacyLevel: 'normal', selected: true, estimatedTokens: estimateTokens(content) })
    }
    if (node.povEntityId && entityById.has(node.povEntityId)) {
      const allNodes = this.database.listNodes(projectId)
      for (const fact of this.database.listKnowledgeFacts(projectId).filter((item) => knowledgeKnownAt(item, node.povEntityId!, nodeId, allNodes))) {
        const content = `${fact.title}${fact.detail ? `：${fact.detail}` : ''}`
        items.push({ id: `knowledge:${fact.id}`, type: 'knowledge', title: `POV 已知：${fact.title}`, content, reason: '当前视角人物在本场景已经知情', privacyLevel: fact.privacyLevel, selected: fact.privacyLevel !== 'local_private', estimatedTokens: estimateTokens(content) })
      }
    }
    let styleBudget = 1_200
    for (const sample of this.database.listStyleSamples(projectId).filter((item) => item.effectiveEnabled)) {
      const full = [sample.guidance ? `使用指导：${sample.guidance}` : '', sample.content].filter(Boolean).join('\n')
      const content = truncateToTokenBudget(full, styleBudget)
      const tokens = estimateTokens(content)
      if (!content || tokens === 0) break
      items.push({
        id: `style:${sample.id}`, type: 'style', title: `风格样本：${sample.title}`, content,
        reason: sample.scope === 'series' ? '当前项目所属系列的已启用样本' : '当前项目的已启用样本',
        privacyLevel: sample.privacyLevel, selected: sample.privacyLevel !== 'local_private', estimatedTokens: tokens,
      })
      styleBudget -= tokens
      if (styleBudget <= 0) break
    }
    const settings = this.loadFullSettings()
    return providerKind(settings.baseUrl) === 'ollama' ? fitLocalContext(items, settings.model) : items
  }

  private voiceExcerpts(projectId: string, nodeId: string): string[] {
    const samples = this.database.listStyleSamples(projectId).filter((item) => item.effectiveEnabled && item.privacyLevel !== 'local_private')
    const fromSamples = samples.slice(0, 2).map((sample) => {
      const body = sample.content.trim().slice(0, 400)
      return sample.guidance ? `${sample.guidance}\n${body}` : body
    }).filter(Boolean)
    if (fromSamples.length) return fromSamples
    const node = this.database.getNode(nodeId)
    if (!node) return []
    const previous = this.database.listNodes(projectId)
      .filter((item) => item.type === 'scene' && item.id !== nodeId && !item.deletedAt && (item.status === 'complete' || item.status === 'published') && item.sortKey < node.sortKey)
      .sort((a, b) => b.sortKey - a.sortKey)
    for (const item of previous) {
      const text = this.database.getScene(item.id)?.plainText.trim() ?? ''
      if (text.length >= 40) return [text.slice(-400)]
    }
    return []
  }

  async runTask(input: AiTaskInput): Promise<AiTaskResult> {
    return this.executeTask(input, () => {})
  }

  async runTaskStreaming(input: AiTaskInput, emit: (event: AiStreamEvent) => void, signal?: AbortSignal): Promise<AiTaskResult> {
    return this.executeTask(input, emit, signal)
  }

  async warmModel(): Promise<{ ok: boolean; message: string }> {
    const settings = this.loadFullSettings()
    if (providerKind(settings.baseUrl) !== 'ollama') return { ok: true, message: '当前模式无需预热' }
    if (this.warming) return this.warming
    this.warming = this.performWarm(settings)
    try { return await this.warming } finally { this.warming = null }
  }

  private async performWarm(settings: AiSettings): Promise<{ ok: boolean; message: string }> {
    try {
      const ollamaRoot = normalizeBaseUrl(settings.baseUrl).replace(/\/v1$/, '')
      const response = await fetch(`${ollamaRoot}/api/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: settings.model, stream: false, keep_alive: '10m' }), signal: AbortSignal.timeout(45_000),
      })
      if (response.ok) await response.json().catch(() => null)
      return response.ok ? { ok: true, message: `${settings.model} 已预热` } : { ok: false, message: `模型预热失败：HTTP ${response.status}` }
    } catch {
      return { ok: false, message: '模型预热未完成；首次生成可能需要更久' }
    }
  }

  private async executeTask(input: AiTaskInput, emit: (event: AiStreamEvent) => void, signal?: AbortSignal): Promise<AiTaskResult> {
    const settings = this.loadFullSettings()
    if (providerKind(settings.baseUrl) === 'blocked') throw new Error('零费用保护已停用外网 AI。请在设置中启用本地免费模型。')
    const selection = input.selectionAnchor ? validateSelection(this.database, input.projectId, input.nodeId, input.selectionAnchor) : null
    if (['word_inspiration', 'style_rewrite'].includes(input.taskType) && !selection) throw new Error('该任务需要有效的正文选区')
    const built = this.buildContext(input.projectId, input.nodeId)
    const selected = new Set(input.selectedContextIds)
    const context = built.filter((item) => item.privacyLevel !== 'local_private' && (selected.has(item.id) || item.type === 'voice' || item.type === 'time'))
    const selectionText = selection ? `## 精确选区\n选中文本：${selection.originalText}\n前文：${selection.contextBefore || '无'}\n后文：${selection.contextAfter || '无'}` : ''
    const contextText = [selectionText, ...context.map((item) => `## ${item.title}\n${item.content}`)].filter(Boolean).join('\n\n')
    const taskId = newId()
    const prompt = buildPrompt(input.taskType, input.instruction, contextText)
    const inputTokens = estimateTokens(prompt)
    const taskCreatedAt = nowIso()
    const voiceHash = sha256(compileVoiceContract(this.database.getVoiceProfile(input.projectId, input.nodeId)))
    this.database.db.prepare(`INSERT INTO ai_tasks(id,project_id,node_id,task_type,prompt_version,model,context_hash,input_tokens,status,created_at,effective_style_hash,selection_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      taskId, input.projectId, input.nodeId, input.taskType, 'style-v1', settings.model, sha256(JSON.stringify(context.map((item) => item.id))), inputTokens, 'running', taskCreatedAt, voiceHash, selection ? sha256(selection.originalText) : null,
    )
    try {
      emit({ type: 'status', stage: 'preparing', message: `正在整理 ${context.length} 项本地上下文` })
      let output: string
      if (settings.baseUrl.startsWith('mock://')) {
        output = runMockTask(input.taskType, input.instruction, this.database.getScene(input.nodeId)?.plainText ?? '')
        emit({ type: 'status', stage: 'generating', message: '正在生成演示候选' }); emit({ type: 'delta', delta: output })
      } else {
        if (this.warming) { emit({ type: 'status', stage: 'loading_model', message: '正在完成本地模型预热' }); await this.warming }
        output = await callOllamaStreaming(settings, prompt, input.taskType, emit, signal)
      }
      const outputTokens = estimateTokens(output)
      const outputHash = sha256(output)
      this.database.db.prepare('UPDATE ai_tasks SET output_hash=?,output_tokens=?,status=? WHERE id=?').run(outputHash, outputTokens, 'completed', taskId)
      this.database.recordProvenanceEvent({ projectId: input.projectId, nodeId: input.nodeId, eventType: 'ai_generated', actorType: 'ai', sourceTaskId: taskId, contentHash: outputHash, metadata: { taskType: input.taskType, promptVersion: 'style-v1', model: settings.model, status: 'completed', contextHash: sha256(JSON.stringify(context.map((item) => item.id))), effectiveStyleHash: voiceHash, selectionHash: selection ? sha256(selection.originalText) : null, inputTokens, outputTokens }, createdAt: taskCreatedAt })
      return { taskId, taskType: input.taskType, output, model: settings.model, inputTokens, outputTokens, estimatedCost: null }
    } catch (error) {
      this.database.db.prepare('UPDATE ai_tasks SET status=? WHERE id=?').run('failed', taskId)
      this.database.recordProvenanceEvent({ projectId: input.projectId, nodeId: input.nodeId, eventType: 'ai_failed', actorType: 'ai', sourceTaskId: taskId, metadata: { taskType: input.taskType, promptVersion: 'style-v1', model: settings.model, status: 'failed', inputTokens }, createdAt: taskCreatedAt })
      throw error
    }
  }

  private loadFullSettings(): AiSettings {
    const row = this.database.db.prepare('SELECT * FROM ai_settings WHERE id=1').get() as Record<string, unknown> | undefined
    if (!row) return { baseUrl: 'mock://local', model: '笔不怠演示模型', apiKey: '' }
    return { baseUrl: String(row.base_url), model: String(row.model), apiKey: this.vault.decrypt(String(row.encrypted_api_key ?? '')) }
  }

}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, '')
}

function providerKind(baseUrl: string): AiProviderKind {
  const normalized = normalizeBaseUrl(baseUrl)
  if (normalized.startsWith('mock://')) return 'demo'
  if (OLLAMA_BASE_URLS.has(normalized)) return 'ollama'
  return 'blocked'
}

function assertFreeLocalSettings(settings: AiSettings) {
  const provider = providerKind(settings.baseUrl)
  if (provider === 'blocked') throw new Error('零费用模式仅允许连接本机 Ollama，不能保存云端模型地址')
  if (!settings.model.trim()) throw new Error('模型名称不能为空')
}

function fitLocalContext(items: AiContextItem[], model: string): AiContextItem[] {
  let remaining = /(?:^|:)4b$/i.test(model) ? 4_500 : 6_500
  const fitted: AiContextItem[] = []
  for (const item of items) {
    const itemLimit = item.type === 'scene' || item.type === 'voice' ? Math.min(2_800, remaining) : Math.min(700, remaining)
    if (itemLimit <= 0) break
    const sourceContent = item.type === 'scene' && !item.content.trim() ? '（当前场景暂无正文）' : item.content
    const content = truncateToTokenBudget(sourceContent, itemLimit)
    const estimatedTokens = estimateTokens(content)
    if (!content || estimatedTokens <= 0) continue
    fitted.push({ ...item, content, estimatedTokens })
    remaining -= estimatedTokens
  }
  return fitted
}

function truncateToTokenBudget(text: string, budget: number): string {
  if (budget <= 0) return ''
  if (estimateTokens(text) <= budget) return text
  let low = 0; let high = text.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (estimateTokens(text.slice(0, middle)) <= budget) low = middle
    else high = middle - 1
  }
  return low ? `${text.slice(0, Math.max(0, low - 1))}…` : ''
}

function stateContext(state: EntityState, name: string, privacyLevel: AiContextItem['privacyLevel']): AiContextItem {
  const content = `${state.attributeKey}：${String(state.value)}${state.worldTimeFrom ? `（自 ${state.worldTimeFrom}）` : ''}`
  return { id: state.id, type: 'state', title: `${name}的当前状态`, content, reason: '该状态与当前实体相关', privacyLevel, selected: privacyLevel !== 'local_private', estimatedTokens: estimateTokens(content) }
}

function labelEntity(type: string) {
  return ({ character: '人物', location: '地点', item: '物品', event: '事件' } as Record<string, string>)[type] ?? '设定'
}

function foreshadowLabel(status: string) {
  return ({ planted: '建立', reinforced: '强化', misdirected: '误导', resolved: '回收' } as Record<string, string>)[status] ?? status
}

function buildPrompt(taskType: string, instruction: string, context: string): string {
  const taskRules: Record<string, string> = {
    word_inspiration: '围绕「精确选区」提供 8 个短小、可直接替换的中文表达灵感。兼顾当前文风档和前后句，不改变事实。严格每行输出“类别｜建议”，类别只能是动作、感官、搭配、比喻之一；不要编号、解释或写成段落。',
    style_rewrite: '按「本场景文风档」改写精确选区，保留原意、事实、视角和时态。给出 3 个互斥候选，严格按“候选一：…\n候选二：…\n候选三：…”输出，不解释。',
    idea_to_prose: '把用户写下的思路或骨架写成一小段中文正文，遵守「本场景文风档」和正典，只推进一个自然段落，不擅自增加重大设定。',
    brainstorm: '给出 3 个彼此明显不同的剧情方向。每个方向必须同时包含机会、风险，不替作者做最终决定。严格按“方向一：…\\n机会：…\\n风险：…”的三行结构依次输出；不要添加开场、总结、提醒或其他段落。',
    continue: '续写一小段中文正文。必须遵守「本场景文风档」。不引入未经支持的重大设定。',
    rewrite: '改写用户指定内容，保留事实、视角和时态，仅改善表达，并遵守「本场景文风档」。',
    polish: '按「本场景文风档」润色当前场景。若用户写了思路或骨架，把思路化进词面，不要另起情节、不要扩写成新事件。只输出润色后的正文，不要解释。',
    beat: '按「本场景文风档」只续一个戏剧节拍。若用户写了思路，按思路走，但仍只走一拍。不引入新势力、新秘密或重大设定。只输出这一拍正文，在完整句子处结束，不要解释。',
    cold_read: '以第一次阅读的读者身份，列出期待、困惑和最想继续读的点，不直接重写。',
    continuity: '只报告有证据的连续性风险，逐项给出当前句与冲突事实。',
    extract_facts: '提取本场景明确发生的事实变化，不把猜测、比喻、梦境或角色谎言当成世界真相。',
  }
  const lengthRules: Record<string, string> = {
    word_inspiration: '每条不超过 24 个中文字符，总长不超过 260 个字符。',
    style_rewrite: '每个候选不超过原选区长度的 1.5 倍，总长不超过 600 个中文字符。',
    idea_to_prose: '300–500 个中文字符，在完整句子处结束。',
    brainstorm: '总长不超过 500 个中文字符；三个方向都要简洁完整。',
    continue: '续写 300–500 个中文字符，在完整句子处结束。',
    rewrite: '只给改写后的完整候选，不解释过程，总长不超过 700 个中文字符。',
    polish: '篇幅接近原文，最多比原文多两成，且不超过 800 个中文字符。',
    beat: '150–250 个中文字符，只推进一个节拍。',
    cold_read: '总长不超过 500 个中文字符。',
    continuity: '最多列出 6 项，总长不超过 500 个中文字符。',
    extract_facts: '最多列出 8 项，总长不超过 400 个中文字符。',
  }
  return `你是中文长篇创作助手。作者拥有最终决定权。不要展示思考过程。若上下文里有「本场景文风档」，它是这一场的文笔契约，必须先遵守作者原话，再遵守旋钮。\n任务：${taskRules[taskType] ?? taskType}\n输出约束：${lengthRules[taskType] ?? '简洁作答。'}\n用户补充：${instruction || '无'}\n\n可用上下文：\n${context}`
}

function runMockTask(taskType: string, _instruction: string, text: string): string {
  if (taskType === 'word_inspiration') return '动作｜指节在袖中慢慢收紧\n感官｜冷意沿掌纹渗进去\n搭配｜沉默地避开视线\n比喻｜像门后压着一阵风\n动作｜呼吸顿在喉间\n感官｜听见自己的心跳\n搭配｜克制地收回手\n比喻｜如薄冰轻轻一裂'
  if (taskType === 'style_rewrite') return '候选一：他没有回答，只把手收回袖中。\n候选二：沉默压下来，他垂下眼，指节一点点松开。\n候选三：他避开那道目光，像什么都没有听见。'
  if (taskType === 'idea_to_prose') return '他先看见岩壁里那道过分笔直的缝。火光移过去，灰尘下面露出一小片暗色金属，没有锈，也没有矿石应有的纹理。他没有伸手，只让身后的人停下。风从更深处吹来，带着一种不属于洞穴的、微弱而均匀的震动。'
  if (taskType === 'brainstorm') return `方向一：目标受阻\n机会：迫使人物作出代价明确的选择。\n风险：冲突升级过快会压缩人物反应空间。\n\n方向二：旧线索转义\n机会：让一个旧线索产生新的解释，但不直接揭晓答案。\n风险：新解释需要与既有正典保持一致。\n\n方向三：权力关系变化\n机会：用另一人物的反应改变当前场景的权力关系。\n风险：新增反应不能替代当前人物的主动行动。`
  if (taskType === 'cold_read') return `读者期待：当前冲突会在下一步产生不可逆后果。\n可能困惑：场景中人物的即时目标还可以更明确。\n继续阅读动力：想知道刚出现的线索是否与前文事件有关。`
  if (taskType === 'continuity') return '演示模型不替代规则检查。请查看“检查”页签中的带证据结果。'
  if (taskType === 'extract_facts') return '演示模式不会虚构事实候选。请在正典页手工建立候选，或配置支持结构化输出的模型。'
  if (taskType === 'rewrite' || taskType === 'polish') return text ? `${text.slice(0, 500)}\n\n（演示润色：事实不动，只按当前文风档收紧词面。配置本地模型后可获得完整候选。）` : '先写下思路或正文，再按本场文风档润色。'
  if (taskType === 'beat') return text ? `${text.trim().slice(-80)}\n他停了一停，把没说完的那半句咽回去。` : '先写下这一拍的思路，再按本场文风档往前走一步。'
  return text ? `${text.slice(-300)}\n\n他没有立刻回答。短暂的沉默把真正的问题推到了两人之间。` : '先写下一句话，故事就会从那里开始。'
}

async function callOllamaStreaming(settings: AiSettings, prompt: string, taskType: string, emit: (event: AiStreamEvent) => void, externalSignal?: AbortSignal): Promise<string> {
  if (providerKind(settings.baseUrl) !== 'ollama') throw new Error('零费用保护已拦截外网 AI 请求')
  const ollamaRoot = normalizeBaseUrl(settings.baseUrl).replace(/\/v1$/, '')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (externalSignal?.aborted) throw new LocalAiError('已停止生成，未写入正文', 'cancelled', false)
    if (attempt === 0) emit({ type: 'status', stage: 'loading_model', message: '正在加载本地模型，首次使用可能需要约 20 秒' })
    else emit({ type: 'status', stage: 'retrying', message: '首次等待过久，已自动缩短上下文重试', resetOutput: true })
    try {
      return await runOllamaAttempt({ ollamaRoot, settings, prompt: attempt ? slimPrompt(prompt) : prompt, taskType, attempt, emit, externalSignal })
    } catch (error) {
      const normalized = normalizeLocalAiError(error, externalSignal)
      const canRetry = attempt === 0 && !normalized.producedOutput && ['first_token_timeout', 'idle_timeout'].includes(normalized.code)
      if (!canRetry) throw normalized
    }
  }
  throw new LocalAiError('本地模型生成失败，请重试', 'provider_error', true)
}

async function runOllamaAttempt({ ollamaRoot, settings, prompt, taskType, attempt, emit, externalSignal }: { ollamaRoot: string; settings: AiSettings; prompt: string; taskType: string; attempt: number; emit: (event: AiStreamEvent) => void; externalSignal?: AbortSignal }): Promise<string> {
  const controller = new AbortController(); let timeoutCode: LocalAiError['code'] | null = null; let producedOutput = false; let idleTimer: ReturnType<typeof setTimeout> | null = null
  const abortWith = (code: LocalAiError['code']) => { timeoutCode = code; controller.abort() }
  const firstTokenTimer = setTimeout(() => abortWith('first_token_timeout'), attempt ? 60_000 : 45_000)
  const totalTimer = setTimeout(() => abortWith('total_timeout'), attempt ? 120_000 : 180_000)
  const externalAbort = () => controller.abort(); externalSignal?.addEventListener('abort', externalAbort, { once: true })
  try {
    const response = await fetch(`${ollamaRoot}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: settings.model, messages: [{ role: 'user', content: prompt }], stream: true, think: false, keep_alive: '10m', options: { temperature: 0.7, num_ctx: attempt ? 4_096 : 6_144, num_predict: localOutputBudget(taskType, attempt > 0) } }),
      signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new LocalAiError(`本地模型响应异常：HTTP ${response.status}`, 'provider_error', true)
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let output = ''
    while (true) {
      const chunk = await reader.read(); buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      const lines = buffer.split('\n'); buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const data = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string }
        if (data.error) throw new LocalAiError(data.error, 'provider_error', true, producedOutput)
        const delta = data.message?.content ?? ''
        if (delta) {
          if (!producedOutput) { producedOutput = true; clearTimeout(firstTokenTimer); emit({ type: 'status', stage: 'generating', message: '本地模型正在逐句生成' }) }
          if (idleTimer) clearTimeout(idleTimer)
          idleTimer = setTimeout(() => abortWith('idle_timeout'), 30_000)
          output += delta; emit({ type: 'delta', delta })
        }
      }
      if (chunk.done) break
    }
    if (!output.trim()) throw new LocalAiError('本地模型没有返回正文', 'provider_error', true)
    return output
  } catch (error) {
    if (externalSignal?.aborted) throw new LocalAiError('已停止生成，未写入正文', 'cancelled', false, producedOutput)
    if (timeoutCode) throw new LocalAiError(timeoutMessage(timeoutCode), timeoutCode, true, producedOutput)
    throw normalizeLocalAiError(error, externalSignal, producedOutput)
  } finally {
    clearTimeout(firstTokenTimer); clearTimeout(totalTimer); if (idleTimer) clearTimeout(idleTimer); externalSignal?.removeEventListener('abort', externalAbort)
  }
}

class LocalAiError extends Error {
  constructor(message: string, readonly code: 'cancelled' | 'first_token_timeout' | 'idle_timeout' | 'total_timeout' | 'provider_error', readonly retryable: boolean, readonly producedOutput = false) { super(message) }
}

function normalizeLocalAiError(error: unknown, signal?: AbortSignal, producedOutput = false): LocalAiError {
  if (error instanceof LocalAiError) return error
  if (signal?.aborted) return new LocalAiError('已停止生成，未写入正文', 'cancelled', false, producedOutput)
  return new LocalAiError(error instanceof Error ? error.message : '本地模型生成失败', 'provider_error', true, producedOutput)
}

function timeoutMessage(code: LocalAiError['code']) {
  if (code === 'first_token_timeout') return '本地模型加载时间过长；已缩短上下文重试，仍未开始输出'
  if (code === 'idle_timeout') return '本地模型超过 30 秒没有继续输出，请重试'
  return '本地模型生成超过安全时限，请缩短上下文后重试'
}

function slimPrompt(prompt: string) {
  const marker = '\n\n可用上下文：\n'; const index = prompt.indexOf(marker)
  if (index < 0) return prompt.slice(0, 8_000)
  return `${prompt.slice(0, index + marker.length)}${prompt.slice(index + marker.length, index + marker.length + 8_000)}\n\n（上下文已自动精简）`
}

function localOutputBudget(taskType: string, retry = false): number {
  const budget = ({ word_inspiration: 220, style_rewrite: 420, idea_to_prose: 480, brainstorm: 320, continue: 450, rewrite: 500, polish: 520, beat: 220, cold_read: 320, continuity: 320, extract_facts: 260 } as Record<string, number>)[taskType] ?? 320
  return retry ? Math.max(160, Math.floor(budget * 0.55)) : budget
}

function validateSelection(database: AppDatabase, projectId: string, nodeId: string, anchor: TextSelectionAnchor): TextSelectionAnchor {
  const node = database.getNode(nodeId); const scene = database.getScene(nodeId)
  if (!node || !scene || node.projectId !== projectId || anchor.nodeId !== nodeId) throw new Error('正文选区不属于当前场景')
  if (scene.contentHash !== anchor.sourceContentHash) throw new Error('正文已变化，请重新选择后生成')
  if (anchor.startOffset >= anchor.endOffset || scene.plainText.slice(anchor.startOffset, anchor.endOffset) !== anchor.originalText) throw new Error('正文选区已失效，请重新选择')
  return anchor
}
