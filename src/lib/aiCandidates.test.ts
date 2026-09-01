import { describe, expect, it } from 'vitest'
import { candidateUnits, splitBrainstormDirections } from './aiCandidates'

describe('AI candidate grouping', () => {
  it('keeps each direction, opportunity and risk in one selectable unit', () => {
    const output = `方向一：资源争夺。\n机会：掠夺崖壁稀有矿产；风险：触发岩层崩塌。\n\n方向二：秘境探险。\n机会：发现上古遗迹入口；风险：陷入致命陷阱。`
    const directions = splitBrainstormDirections(output)

    expect(directions).toEqual([
      expect.objectContaining({ title: '方向一', premise: '资源争夺。', opportunity: '掠夺崖壁稀有矿产', risk: '触发岩层崩塌。' }),
      expect.objectContaining({ title: '方向二', premise: '秘境探险。', opportunity: '发现上古遗迹入口', risk: '陷入致命陷阱。' }),
    ])
    expect(candidateUnits('brainstorm', output)).toHaveLength(2)
    expect(candidateUnits('brainstorm', output)[0]).toContain('机会：掠夺崖壁稀有矿产')
    expect(candidateUnits('brainstorm', output)[0]).toContain('风险：触发岩层崩塌。')
  })

  it('accepts markdown headings and falls back safely when a model ignores the format', () => {
    expect(splitBrainstormDirections('**方向一：资源争夺**\n机会：取得矿产\n风险：岩层崩塌')).toEqual([
      expect.objectContaining({ title: '方向一', premise: '资源争夺', opportunity: '取得矿产', risk: '岩层崩塌' }),
    ])
    expect(candidateUnits('brainstorm', '先制造阻碍。再揭示线索。')).toEqual(['先制造阻碍。', '再揭示线索。'])
  })

  it('keeps non-brainstorm tasks selectable by sentence', () => {
    expect(candidateUnits('continue', '第一句。第二句！')).toEqual(['第一句。', '第二句！'])
  })
})
