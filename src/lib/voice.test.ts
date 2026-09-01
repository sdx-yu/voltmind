import { describe, expect, it } from 'vitest'
import { compileVoiceContract, DEFAULT_VOICE_KNOBS, normalizeVoiceKnobs } from '../../shared/voice'

describe('scene voice contract', () => {
  it('puts the author note above knobs and never asks to imitate living authors', () => {
    const contract = compileVoiceContract({
      ...DEFAULT_VOICE_KNOBS,
      register: 'literary',
      sentence: 'short',
      slang: 'avoid',
      authorNote: '这场要冷、慢，不解释法术，沈砚少说话。',
    }, ['雨停了。他没有回头。'])

    expect(contract).toContain('作者原话（最高优先级，比上面的旋钮更重要）')
    expect(contract.indexOf('这场要冷、慢，不解释法术，沈砚少说话。')).toBeLessThan(contract.indexOf('像这样写'))
    expect(contract).toContain('语域偏书面：叙述克制，少解释，少把内心独白说满。')
    expect(contract).toContain('短句为主，一行一事，节奏干脆。')
    expect(contract).toContain('雨停了。他没有回头。')
    expect(contract).toContain('不要模仿任何在世作者的名字或作品标题。')
    expect(contract).not.toMatch(/网文市场|类型皮|模仿.+名家/)
  })

  it('falls back to the neutral knobs instead of inventing a market preset', () => {
    expect(normalizeVoiceKnobs({ register: 'cyberpunk' as never, authorNote: '  只要冷  ' })).toMatchObject({
      ...DEFAULT_VOICE_KNOBS,
      authorNote: '只要冷',
    })
  })
})
