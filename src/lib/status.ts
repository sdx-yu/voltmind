import type { ManuscriptNode } from '../../shared/types'

const LABELS: Record<ManuscriptNode['status'], { short: string; full: string }> = {
  idea: { short: '想', full: '想法' },
  planned: { short: '计', full: '计划' },
  draft: { short: '草', full: '草稿' },
  revising: { short: '修', full: '修订中' },
  complete: { short: '完', full: '已完成' },
  published: { short: '发', full: '已发布' },
}

export function sceneStatusShort(status: ManuscriptNode['status']) {
  return LABELS[status].short
}

export function sceneStatusLabel(status: ManuscriptNode['status']) {
  return LABELS[status].full
}
