import type { AiContextItem, AiTaskResult, EntityState } from '../shared/types.js'
import type { AppDatabase } from './db.js'
import { estimateTokens, newId, nowIso, sha256 } from './utils.js'
import type { LocalVault } from './vault.js'
import { knowledgeKnownAt } from './knowledge.js'

export interface AiSettings {
  baseUrl: string
  model: string
  apiKey: string
}

export type AiProviderKind = 'demo' | 'ollama' | 'blocked'

const OLLAMA_BASE_URLS = new Set([
  'http://127.0.0.1:11434/v1',
  'http://localhost:11434/v1',
])

export class AiService {
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
    const items: AiContextItem[] = [{
      id: nodeId, type: 'scene', title: `当前场景：${node.title}`, content: scene.plainText,
      reason: '当前文本与任务', privacyLevel: 'normal', selected: true, estimatedTokens: estimateTokens(scene.plainText),
    }]
    const entities = this.database.listEntities(projectId)
    const mentionedNames = entities.filter((entity) => [entity.canonicalName, ...entity.aliases].some((name) => name.length >= 2 && scene.plainText.includes(name)))
    for (const entity of mentionedNames) {
      items.push({
        id: entity.id, type: 'entity', title: `${labelEntity(entity.type)}：${entity.canonicalName}`,
        content: entity.summary || '暂无简介', reason: '当前场景人物或设定', privacyLevel: entity.privacyLevel,
        selected: entity.privacyLevel !== 'local_private', estimatedTokens: estimateTokens(entity.summary || entity.canonicalName),
      })
      for (const state of this.database.listStates(entity.id)) items.push(stateContext(state, entity.canonicalName, entity.privacyLevel))
    }
    const nodes = this.database.listNodes(projectId).filter((item) => item.type === 'scene' && item.id !== nodeId && item.sortKey < node.sortKey).sort((a, b) => b.sortKey - a.sortKey).slice(0, 2)
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
    if (node.povEntityId) {
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
    return providerKind(this.loadFullSettings().baseUrl) === 'ollama' ? fitLocalContext(items) : items
  }

  async runTask(input: { projectId: string; nodeId: string; taskType: string; instruction: string; selectedContextIds: string[] }): Promise<AiTaskResult> {
    const settings = this.loadFullSettings()
    if (providerKind(settings.baseUrl) === 'blocked') throw new Error('零费用保护已停用外网 AI。请在设置中启用本地免费模型。')
    const context = this.buildContext(input.projectId, input.nodeId).filter((item) => input.selectedContextIds.includes(item.id) && item.privacyLevel !== 'local_private')
    const contextText = context.map((item) => `## ${item.title}\n${item.content}`).join('\n\n')
    const taskId = newId()
    const prompt = buildPrompt(input.taskType, input.instruction, contextText)
    const inputTokens = estimateTokens(prompt)
    const taskCreatedAt = nowIso()
    this.database.db.prepare(`INSERT INTO ai_tasks(id,project_id,node_id,task_type,prompt_version,model,context_hash,input_tokens,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      taskId, input.projectId, input.nodeId, input.taskType, 'mvp-1', settings.model, sha256(JSON.stringify(context.map((item) => item.id))), inputTokens, 'running', taskCreatedAt,
    )
    try {
      const output = settings.baseUrl.startsWith('mock://')
        ? runMockTask(input.taskType, input.instruction, this.database.getScene(input.nodeId)?.plainText ?? '')
        : await callOllama(settings, prompt, input.taskType)
      const outputTokens = estimateTokens(output)
      const outputHash = sha256(output)
      this.database.db.prepare('UPDATE ai_tasks SET output_hash=?,output_tokens=?,status=? WHERE id=?').run(outputHash, outputTokens, 'completed', taskId)
      this.database.recordProvenanceEvent({ projectId: input.projectId, nodeId: input.nodeId, eventType: 'ai_generated', actorType: 'ai', sourceTaskId: taskId, contentHash: outputHash, metadata: { taskType: input.taskType, promptVersion: 'mvp-1', model: settings.model, status: 'completed', contextHash: sha256(JSON.stringify(context.map((item) => item.id))), inputTokens, outputTokens }, createdAt: taskCreatedAt })
      return { taskId, taskType: input.taskType, output, model: settings.model, inputTokens, outputTokens, estimatedCost: null }
    } catch (error) {
      this.database.db.prepare('UPDATE ai_tasks SET status=? WHERE id=?').run('failed', taskId)
      this.database.recordProvenanceEvent({ projectId: input.projectId, nodeId: input.nodeId, eventType: 'ai_failed', actorType: 'ai', sourceTaskId: taskId, metadata: { taskType: input.taskType, promptVersion: 'mvp-1', model: settings.model, status: 'failed', inputTokens }, createdAt: taskCreatedAt })
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

function fitLocalContext(items: AiContextItem[]): AiContextItem[] {
  let remaining = 7_800
  const fitted: AiContextItem[] = []
  for (const item of items) {
    const itemLimit = item.type === 'scene' ? Math.min(5_000, remaining) : Math.min(900, remaining)
    if (itemLimit <= 0) break
    const content = truncateToTokenBudget(item.content, itemLimit)
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
    brainstorm: '给出 3 个彼此明显不同的剧情方向。每个方向包含机会、风险，不替作者做最终决定。',
    continue: '续写一小段中文正文，保持人物状态与现有文风，不引入未经支持的重大设定。',
    rewrite: '改写用户指定内容，保留事实、视角和时态，仅改善表达。',
    cold_read: '以第一次阅读的读者身份，列出期待、困惑和最想继续读的点，不直接重写。',
    continuity: '只报告有证据的连续性风险，逐项给出当前句与冲突事实。',
    extract_facts: '提取本场景明确发生的事实变化，不把猜测、比喻、梦境或角色谎言当成世界真相。',
  }
  const lengthRules: Record<string, string> = {
    brainstorm: '总长不超过 500 个中文字符；三个方向都要简洁完整。',
    continue: '续写 300–500 个中文字符，在完整句子处结束。',
    rewrite: '只给改写后的完整候选，不解释过程，总长不超过 700 个中文字符。',
    cold_read: '总长不超过 500 个中文字符。',
    continuity: '最多列出 6 项，总长不超过 500 个中文字符。',
    extract_facts: '最多列出 8 项，总长不超过 400 个中文字符。',
  }
  return `你是中文长篇创作助手。作者拥有最终决定权。不要展示思考过程。\n任务：${taskRules[taskType] ?? taskType}\n输出约束：${lengthRules[taskType] ?? '简洁作答。'}\n用户补充：${instruction || '无'}\n\n可用上下文：\n${context}`
}

function runMockTask(taskType: string, instruction: string, text: string): string {
  if (taskType === 'brainstorm') return `方向一｜让场景中的目标立刻受阻，迫使人物作出代价明确的选择。\n方向二｜让一个旧线索产生新的解释，但不直接揭晓答案。\n方向三｜用另一人物的反应改变当前场景的权力关系。\n\n提醒：以上只是候选，请结合正典决定。${instruction ? `\n你的要求：${instruction}` : ''}`
  if (taskType === 'cold_read') return `读者期待：当前冲突会在下一步产生不可逆后果。\n可能困惑：场景中人物的即时目标还可以更明确。\n继续阅读动力：想知道刚出现的线索是否与前文事件有关。`
  if (taskType === 'continuity') return '演示模型不替代规则检查。请查看“检查”页签中的带证据结果。'
  if (taskType === 'extract_facts') return '演示模式不会虚构事实候选。请在正典页手工建立候选，或配置支持结构化输出的模型。'
  if (taskType === 'rewrite') return text ? `${text.slice(0, 500)}\n\n（演示改写：保留事实，仅调整节奏。配置真实模型后可获得完整候选。）` : '请先在正文中写下或选择需要改写的内容。'
  return text ? `${text.slice(-300)}\n\n他没有立刻回答。短暂的沉默把真正的问题推到了两人之间。` : '先写下一句话，故事就会从那里开始。'
}

async function callOllama(settings: AiSettings, prompt: string, taskType: string): Promise<string> {
  if (providerKind(settings.baseUrl) !== 'ollama') throw new Error('零费用保护已拦截外网 AI 请求')
  const ollamaRoot = normalizeBaseUrl(settings.baseUrl).replace(/\/v1$/, '')
  const response = await fetch(`${ollamaRoot}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: settings.model, messages: [{ role: 'user', content: prompt }], stream: false, think: false, options: { temperature: 0.7, num_ctx: 8_192, num_predict: localOutputBudget(taskType) } }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!response.ok) throw new Error(`本地模型响应异常：HTTP ${response.status}`)
  const data = await response.json() as { message?: { content?: string } }
  const output = data.message?.content
  if (!output) throw new Error('本地模型没有返回正文')
  return output
}

function localOutputBudget(taskType: string): number {
  return ({ brainstorm: 600, continue: 700, rewrite: 800, cold_read: 600, continuity: 600, extract_facts: 500 } as Record<string, number>)[taskType] ?? 600
}
