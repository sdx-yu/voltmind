import type { DeliveryCheckResult, DeliveryRule, ManuscriptNode } from '../shared/types.js'
import type { AppDatabase } from './db.js'
import { newId } from './utils.js'

export function runDeliveryCheck(database: AppDatabase, projectId: string, templateId: string, chapterIds: string[]) {
  const template = database.listDeliveryTemplates(projectId).find((item) => item.id === templateId)
  if (!template) throw new Error('Delivery template not found')
  const nodes = database.listNodes(projectId).filter((node) => !node.deletedAt)
  const selectedChapters = chapterIds.length ? new Set(chapterIds) : new Set(nodes.filter((node) => node.type === 'chapter').map((node) => node.id))
  const chapters = nodes.filter((node) => node.type === 'chapter' && selectedChapters.has(node.id))
  const scenes = nodes.filter((node) => node.type === 'scene' && node.parentId && selectedChapters.has(node.parentId))
  const documents = new Map(scenes.map((scene) => [scene.id, database.getScene(scene.id)?.plainText ?? '']))
  const results = template.rules.filter((rule) => rule.effectiveEnabled && !rule.manual).flatMap((rule) => evaluateRule(rule, chapters, scenes, documents, nodes))
  return database.saveDeliveryCheckRun(projectId, templateId, [...selectedChapters], results)
}

function evaluateRule(rule: DeliveryRule, chapters: ManuscriptNode[], scenes: ManuscriptNode[], documents: Map<string, string>, allNodes: ManuscriptNode[]): DeliveryCheckResult[] {
  if (rule.kind === 'empty_scene') return scenes.filter((scene) => !(documents.get(scene.id) ?? '').trim()).map((scene) => issue(rule, scene.id, '', `“${scene.title}”没有正文。`))
  if (rule.kind === 'duplicate_title') {
    const first = new Map<string, ManuscriptNode>(); const results: DeliveryCheckResult[] = []
    for (const chapter of chapters) { const key = chapter.title.trim(); const previous = first.get(key); if (previous) results.push(issue(rule, chapter.id, chapter.title, `章节标题“${chapter.title}”与“${previous.title}”重复。`)); else first.set(key, chapter) }
    return results
  }
  if (rule.kind === 'unbroken_paragraph') {
    const maxChars = Number(rule.config.maxChars ?? 500)
    return scenes.flatMap((scene) => {
      const paragraph = (documents.get(scene.id) ?? '').split(/\n+/).find((item) => item.trim().length > maxChars)
      const text = documents.get(scene.id) ?? ''; const start = paragraph ? text.indexOf(paragraph) : 0
      return paragraph ? [issue(rule, scene.id, excerpt(paragraph), `“${scene.title}”存在超过 ${maxChars} 字的连续未分段正文。`, start, start + Math.min(paragraph.length, 90))] : []
    })
  }
  if (rule.kind === 'duplicate_scene') {
    const minChars = Number(rule.config.minChars ?? 30); const first = new Map<string, ManuscriptNode>(); const results: DeliveryCheckResult[] = []
    for (const scene of scenes) {
      const text = (documents.get(scene.id) ?? '').replace(/\s+/g, '').trim()
      if (text.length < minChars) continue
      const previous = first.get(text)
      if (previous) { const quote = excerpt(documents.get(scene.id) ?? ''); results.push(issue(rule, scene.id, quote, `“${scene.title}”与“${previous.title}”正文完全重复。`, 0, quote.length)) }
      else first.set(text, scene)
    }
    return results
  }
  if (rule.kind === 'min_project_words') {
    const minWords = Number(rule.config.minWords ?? 20_000)
    const words = allNodes.filter((node) => node.type === 'scene' && !node.deletedAt).reduce((sum, node) => sum + node.wordCount, 0)
    return words < minWords ? [issue(rule, null, '', `当前全书约 ${words.toLocaleString('zh-CN')} 字，尚未达到 ${minWords.toLocaleString('zh-CN')} 字提示线。`)] : []
  }
  return []
}

function issue(rule: DeliveryRule, nodeId: string | null, quote: string, message: string, startOffset = 0, endOffset = quote.length): DeliveryCheckResult {
  return { id: newId(), ruleId: rule.id, ruleCode: rule.code, ruleTitle: rule.title, severity: rule.severity, nodeId, quote, startOffset, endOffset, message }
}

function excerpt(value: string) { const clean = value.trim().replace(/\s+/g, ' '); return clean.length > 90 ? `${clean.slice(0, 90)}…` : clean }
