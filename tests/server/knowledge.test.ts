// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { checkPovKnowledge, knowledgeKnownAt } from '../../server/knowledge.js'
import type { Entity, KnowledgeFact, ManuscriptNode } from '../../shared/types.js'

describe('POV knowledge checks', () => {
  const pov: Entity = { id: 'lin', projectId: 'p', type: 'character', canonicalName: '林照', aliases: [], summary: '', privacyLevel: 'normal', createdAt: '', updatedAt: '', deletedAt: null }
  const nodes = [chapter(), scene('s1', 1000, 'lin'), scene('s2', 2000, 'lin')]
  const fact: KnowledgeFact = { id: 'k', projectId: 'p', title: '凶手身份', detail: '凶手是沈砚', keywords: ['沈砚是凶手'], firstRevealedNodeId: 's2', privacyLevel: 'author_only', createdAt: '', updatedAt: '', deletedAt: null, grants: [{ id: 'g', knowledgeId: 'k', entityId: 'lin', knownFromNodeId: 's2', sourceNodeId: 's2', evidence: '密信落款', note: '', createdAt: '' }] }

  it('reports evidence before the POV knows and clears at the knowledge start', () => {
    const early = checkPovKnowledge({ node: nodes[1], plainText: '她终于明白，沈砚是凶手。', entities: [pov], facts: [fact], nodes })
    expect(early[0]).toMatchObject({ rule: 'pov_knowledge_leak', severity: 'risk', currentEvidence: { quote: '她终于明白，沈砚是凶手。' }, conflictingEvidence: { nodeId: 's2' } })
    expect(knowledgeKnownAt(fact, 'lin', 's1', nodes)).toBe(false)
    expect(checkPovKnowledge({ node: nodes[2], plainText: '沈砚是凶手。', entities: [pov], facts: [fact], nodes })).toEqual([])
    expect(knowledgeKnownAt(fact, 'lin', 's2', nodes)).toBe(true)
  })

  it('does not guess when POV or explicit keywords are absent', () => {
    expect(checkPovKnowledge({ node: { ...nodes[1], povEntityId: null }, plainText: '沈砚是凶手。', entities: [pov], facts: [fact], nodes })).toEqual([])
    expect(checkPovKnowledge({ node: nodes[1], plainText: '她对沈砚仍有怀疑。', entities: [pov], facts: [fact], nodes })).toEqual([])
  })
})

function chapter(): ManuscriptNode { return { id: 'c', projectId: 'p', parentId: 'b', type: 'chapter', title: '章', sortKey: 1000, status: 'draft', povEntityId: null, storyTime: null, deletedAt: null, wordCount: 0 } }
function scene(id: string, sortKey: number, povEntityId: string): ManuscriptNode { return { id, projectId: 'p', parentId: 'c', type: 'scene', title: id, sortKey, status: 'draft', povEntityId, storyTime: null, deletedAt: null, wordCount: 0 } }
