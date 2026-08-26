import type { ContinuityIssue, Entity, KnowledgeFact, ManuscriptNode } from '../shared/types.js'
import { newId } from './utils.js'

export function orderedScenes(nodes: ManuscriptNode[]): ManuscriptNode[] {
  const chapters = nodes.filter((node) => node.type === 'chapter' && !node.deletedAt).sort((a, b) => a.sortKey - b.sortKey)
  const chapterOrder = new Map(chapters.map((chapter, index) => [chapter.id, index]))
  return nodes.filter((node) => node.type === 'scene' && !node.deletedAt).sort((a, b) => (chapterOrder.get(a.parentId ?? '') ?? Number.MAX_SAFE_INTEGER) - (chapterOrder.get(b.parentId ?? '') ?? Number.MAX_SAFE_INTEGER) || a.sortKey - b.sortKey)
}

export function knowledgeKnownAt(fact: KnowledgeFact, entityId: string, nodeId: string, nodes: ManuscriptNode[]): boolean {
  const order = new Map(orderedScenes(nodes).map((node, index) => [node.id, index]))
  const current = order.get(nodeId)
  const grant = fact.grants.find((item) => item.entityId === entityId)
  if (current === undefined || !grant) return false
  const knownFrom = order.get(grant.knownFromNodeId)
  return knownFrom !== undefined && knownFrom <= current
}

export function checkPovKnowledge(input: { node: ManuscriptNode; plainText: string; entities: Entity[]; facts: KnowledgeFact[]; nodes: ManuscriptNode[] }): ContinuityIssue[] {
  if (!input.node.povEntityId || !input.plainText.trim()) return []
  const pov = input.entities.find((entity) => entity.id === input.node.povEntityId && entity.type === 'character' && !entity.deletedAt)
  if (!pov) return []
  const issues: ContinuityIssue[] = []
  for (const fact of input.facts.filter((item) => !item.deletedAt)) {
    const keyword = fact.keywords.find((item) => input.plainText.includes(item))
    if (!keyword || knowledgeKnownAt(fact, pov.id, input.node.id, input.nodes)) continue
    const grant = fact.grants.find((item) => item.entityId === pov.id)
    const conflictNodeId = grant?.knownFromNodeId ?? fact.firstRevealedNodeId ?? input.node.id
    issues.push({
      id: newId(), rule: 'pov_knowledge_leak', severity: 'risk', confidence: 0.84,
      message: `${pov.canonicalName}在本场景的知情范围内尚不包含“${fact.title}”，但正文出现了对应识别词。请确认是视角泄密、叙述者信息，还是需要补录知情起点。`,
      currentEvidence: { nodeId: input.node.id, quote: evidenceSentence(input.plainText, keyword) },
      conflictingEvidence: { nodeId: conflictNodeId, quote: grant ? `${pov.canonicalName}从“${nodeTitle(input.nodes, grant.knownFromNodeId)}”起知道：${fact.title}` : `${pov.canonicalName}尚未登记知晓：${fact.title}` },
      actions: ['update_canon', 'edit_text', 'ignore', 'exception'],
    })
  }
  return issues
}

function evidenceSentence(text: string, keyword: string): string {
  const index = text.indexOf(keyword)
  const start = Math.max(text.lastIndexOf('。', index - 1), text.lastIndexOf('！', index - 1), text.lastIndexOf('？', index - 1), text.lastIndexOf('\n', index - 1)) + 1
  const endings = [text.indexOf('。', index), text.indexOf('！', index), text.indexOf('？', index), text.indexOf('\n', index)].filter((value) => value >= 0)
  const end = endings.length ? Math.min(...endings) + 1 : Math.min(text.length, index + keyword.length + 30)
  return text.slice(start, end).trim() || keyword
}

function nodeTitle(nodes: ManuscriptNode[], id: string) { return nodes.find((node) => node.id === id)?.title ?? '未找到场景' }
