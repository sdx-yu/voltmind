// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { checkContinuity } from '../../server/continuity.js'
import type { Entity, EntityState, ManuscriptNode } from '../../shared/types.js'

describe('continuity checks', () => {
  it('provides evidence when a dead character appears later', () => {
    const nodes = [scene('s1', 1000), scene('s2', 2000)]
    const entity: Entity = { id: 'e1', projectId: 'p1', type: 'character', canonicalName: '沈砚', aliases: [], summary: '', privacyLevel: 'normal', createdAt: '', updatedAt: '', deletedAt: null }
    const state: EntityState = { id: 'st1', entityId: 'e1', attributeKey: 'life_status', value: '死亡', validFromNodeId: 's1', validToNodeId: null, worldTimeFrom: null, worldTimeTo: null, sourceMentionId: null, createdAt: '' }
    const issues = checkContinuity({ node: nodes[1], plainText: '沈砚推门走了进来。', entities: [entity], states: [state], nodes })
    expect(issues[0]).toMatchObject({ rule: 'character_after_death', severity: 'review', confidence: 0.9 })
    expect(issues[0].conflictingEvidence?.nodeId).toBe('s1')
  })

  it('reports a holder contradiction with both pieces of evidence', () => {
    const item: Entity = { id: 'sword', projectId: 'p1', type: 'item', canonicalName: '照影剑', aliases: [], summary: '', privacyLevel: 'normal', createdAt: '', updatedAt: '', deletedAt: null }
    const a: Entity = { ...item, id: 'a', type: 'character', canonicalName: '沈砚' }
    const b: Entity = { ...item, id: 'b', type: 'character', canonicalName: '林照' }
    const state: EntityState = { id: 'holder', entityId: item.id, attributeKey: 'holder', value: '沈砚', validFromNodeId: 's1', validToNodeId: null, worldTimeFrom: null, worldTimeTo: null, sourceMentionId: null, createdAt: '' }
    const issues = checkContinuity({ node: scene('s2', 2000), plainText: '林照握紧照影剑，望向门外。', entities: [item, a, b], states: [state], nodes: [scene('s1', 1000), scene('s2', 2000)] })
    expect(issues.find((issue) => issue.rule === 'holder_conflict')).toMatchObject({ severity: 'risk', currentEvidence: { quote: '林照握紧照影剑' }, conflictingEvidence: { quote: '照影剑持有者：沈砚' } })
  })

  it('does not report a configured alias as a proper-name typo when same-name records exist', () => {
    const primary: Entity = { id: 'lin', projectId: 'p1', type: 'character', canonicalName: '林照', aliases: ['阿照'], summary: '', privacyLevel: 'normal', createdAt: '', updatedAt: '', deletedAt: null }
    const duplicate: Entity = { ...primary, id: 'lin-copy', aliases: [] }
    const current = scene('s1', 1000)
    const issues = checkContinuity({ node: current, plainText: '阿照没有回头。', entities: [primary, duplicate], states: [], nodes: [current] })
    expect(issues.find((issue) => issue.rule === 'proper_name_variant')).toBeUndefined()
  })
})

function scene(id: string, sortKey: number): ManuscriptNode { return { id, projectId: 'p1', parentId: 'c1', type: 'scene', title: id, sortKey, status: 'draft', povEntityId: null, storyTime: null, deletedAt: null, wordCount: 0 } }
