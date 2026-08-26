import { describe, expect, it } from 'vitest'
import { countWords, splitChapters, textToTiptap } from './text'

describe('text utilities', () => {
  it('counts Chinese characters and latin words with a documented mixed rule', () => {
    expect(countWords('你好 world 2026')).toBe(4)
  })
  it('splits common Chinese chapter headings while preserving text', () => {
    const chapters = splitChapters('第一章 雨夜\n沈砚醒来。\n第二章 归途\n林照回头。')
    expect(chapters).toEqual([{ title: '第一章 雨夜', text: '沈砚醒来。' }, { title: '第二章 归途', text: '林照回头。' }])
  })
  it('converts plain text paragraphs to editor JSON', () => {
    expect(textToTiptap('甲\n乙')).toMatchObject({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph' }] })
  })
})
