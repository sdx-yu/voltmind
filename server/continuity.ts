import type { ContinuityIssue, Entity, EntityState, ManuscriptNode } from '../shared/types.js'
import { newId } from './utils.js'

interface CheckInput {
  node: ManuscriptNode
  plainText: string
  entities: Entity[]
  states: EntityState[]
  nodes: ManuscriptNode[]
}

export function checkContinuity(input: CheckInput): ContinuityIssue[] {
  const issues: ContinuityIssue[] = []
  const parentOrder = new Map(input.nodes.filter((node) => node.type === 'chapter').sort((a, b) => a.sortKey - b.sortKey).map((node, index) => [node.id, index]))
  const orderedScenes = input.nodes.filter((node) => node.type === 'scene').sort((a, b) => (parentOrder.get(a.parentId ?? '') ?? 0) - (parentOrder.get(b.parentId ?? '') ?? 0) || a.sortKey - b.sortKey)
  const nodeOrder = new Map(orderedScenes.map((node, index) => [node.id, index]))
  const currentOrder = nodeOrder.get(input.node.id) ?? Number.MAX_SAFE_INTEGER

  for (const entity of input.entities) {
    const names = [entity.canonicalName, ...entity.aliases]
    const mentioned = names.find((name) => name.length >= 2 && input.plainText.includes(name))
    if (!mentioned) continue

    const states = input.states.filter((state) => state.entityId === entity.id)
    const death = states.find((state) => {
      if (state.attributeKey !== 'life_status' || !['dead', '死亡', '已死亡'].includes(String(state.value))) return false
      if (!state.validFromNodeId) return true
      return (nodeOrder.get(state.validFromNodeId) ?? Number.MAX_SAFE_INTEGER) <= currentOrder
    })
    if (death) {
      issues.push({
        id: newId(), rule: 'character_after_death', severity: 'review', confidence: 0.9,
        message: `${entity.canonicalName}在当前正典中已处于死亡状态，但本场景再次提及。若为回忆、复活或同名人物，可设为例外。`,
        currentEvidence: { nodeId: input.node.id, quote: mentioned },
        conflictingEvidence: death.validFromNodeId ? { nodeId: death.validFromNodeId, quote: `${entity.canonicalName}：${String(death.value)}` } : undefined,
        actions: ['update_canon', 'edit_text', 'ignore', 'exception'],
      })
    }

    const holderStates = states.filter((state) => state.attributeKey === 'holder')
    if (entity.type === 'item' && holderStates.length > 1) {
      const open = holderStates.filter((state) => !state.worldTimeTo && !state.validToNodeId)
      if (open.length > 1) {
        issues.push({
          id: newId(), rule: 'multiple_current_holders', severity: 'risk', confidence: 1,
          message: `${entity.canonicalName}同时存在 ${open.length} 个未结束的持有状态，请明确转交的生效点。`,
          currentEvidence: { nodeId: input.node.id, quote: mentioned },
          actions: ['update_canon', 'ignore'],
        })
      }
    }
    if (entity.type === 'item' && holderStates.length) {
      const currentHolder = String(holderStates.filter((state) => !state.worldTimeTo && !state.validToNodeId).at(-1)?.value ?? '')
      for (const person of input.entities.filter((item) => item.type === 'character' && item.canonicalName !== currentHolder)) {
        const evidence = input.plainText.match(new RegExp(`${escapeRegExp(person.canonicalName)}[^。！？]{0,8}(?:握|持|拿|带|佩)[^。！？]{0,5}${escapeRegExp(entity.canonicalName)}|${escapeRegExp(entity.canonicalName)}[^。！？]{0,6}(?:在|归|属于)[^。！？]{0,3}${escapeRegExp(person.canonicalName)}`))?.[0]
        if (evidence) issues.push({ id: newId(), rule: 'holder_conflict', severity: 'risk', confidence: 0.88, message: `正文显示${person.canonicalName}持有${entity.canonicalName}，但当前正典持有者是${currentHolder}。`, currentEvidence: { nodeId: input.node.id, quote: evidence }, conflictingEvidence: { nodeId: holderStates.at(-1)?.validFromNodeId ?? input.node.id, quote: `${entity.canonicalName}持有者：${currentHolder}` }, actions: ['update_canon', 'edit_text', 'ignore', 'exception'] })
      }
    }
  }

  const knownNames = new Set(input.entities.flatMap((entity) => [entity.canonicalName, ...entity.aliases]))
  for (const entity of input.entities) {
    if (entity.canonicalName.length < 2 || entity.canonicalName.length > 6) continue
    const candidates = extractCjkTokens(input.plainText, entity.canonicalName.length)
    const typo = candidates.find((token) => !knownNames.has(token) && levenshtein(token, entity.canonicalName) === 1)
    if (typo) {
      issues.push({
        id: newId(), rule: 'proper_name_variant', severity: 'review', confidence: 0.72,
        message: `“${typo}”与正典名称“${entity.canonicalName}”仅一字不同，建议确认是否为专名误写。`,
        currentEvidence: { nodeId: input.node.id, quote: typo },
        actions: ['edit_text', 'ignore', 'exception'],
      })
    }
  }
  const currentIndex = nodeOrder.get(input.node.id) ?? -1
  const previous = currentIndex > 0 ? orderedScenes[currentIndex - 1] : undefined
  if (previous?.storyTime && input.node.storyTime && /^\d{4}-\d{2}-\d{2}/.test(previous.storyTime) && /^\d{4}-\d{2}-\d{2}/.test(input.node.storyTime) && previous.storyTime > input.node.storyTime) {
    issues.push({ id: newId(), rule: 'story_time_reverse', severity: 'review', confidence: 0.85, message: `本场景故事时间 ${input.node.storyTime} 早于上一场景 ${previous.storyTime}。如为倒叙可设为例外。`, currentEvidence: { nodeId: input.node.id, quote: input.node.storyTime }, conflictingEvidence: { nodeId: previous.id, quote: `${previous.title}：${previous.storyTime}` }, actions: ['edit_text', 'ignore', 'exception'] })
  }
  return dedupeIssues(issues)
}

function extractCjkTokens(text: string, length: number): string[] {
  const chunks = text.match(/[\u3400-\u9fff]{2,}/g) ?? []
  const tokens = new Set<string>()
  for (const chunk of chunks) {
    for (let i = 0; i <= chunk.length - length; i += 1) tokens.add(chunk.slice(i, i + length))
  }
  return [...tokens]
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function levenshtein(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0))
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return matrix[a.length][b.length]
}

function dedupeIssues(issues: ContinuityIssue[]): ContinuityIssue[] {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.rule}:${issue.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
