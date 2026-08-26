import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManuscriptNode } from '../../shared/types'
import { ReadAloudPanel } from './ReadAloudPanel'

const mocks = vi.hoisted(() => ({ getReadAloudPreferences: vi.fn(), saveReadAloudPreferences: vi.fn(), getScene: vi.fn() }))
vi.mock('../lib/api', () => ({ api: mocks }))

const nodes = [node('book', '书', null, 1000), node('chapter', '第一章', 'book', 1000), node('scene', '雨夜', 'chapter', 1000)]

describe('ReadAloudPanel', () => {
  const synth = {
    getVoices: vi.fn(() => [{ voiceURI: 'local-zh', name: '本地中文', lang: 'zh-CN', localService: true }]),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    speak: vi.fn((utterance: FakeUtterance) => {
      utterance.onstart?.({} as SpeechSynthesisEvent)
      utterance.onboundary?.({ charIndex: 5, charLength: 2 } as SpeechSynthesisEvent)
    }),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth })
    mocks.getReadAloudPreferences.mockResolvedValue({ projectId: 'p', voiceUri: 'local-zh', rate: 1, pitch: 1, updatedAt: '' })
    mocks.saveReadAloudPreferences.mockImplementation(async (_projectId: string, patch: Record<string, unknown>) => ({ projectId: 'p', voiceUri: 'local-zh', rate: 1, pitch: 1, updatedAt: '', ...patch }))
    mocks.getScene.mockResolvedValue({ nodeId: 'scene', contentJson: {}, plainText: '雨停了。林照推开窗。', contentHash: '', updatedAt: '' })
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  it('reads the current scene locally and supports position, pause, resume, speed and stop', async () => {
    const notify = vi.fn()
    render(<ReadAloudPanel projectId="p" nodes={nodes} currentNodeId="scene" onClose={vi.fn()} onSelectScene={vi.fn()} notify={notify} />)
    expect(await screen.findByRole('option', { name: '本地中文 · zh-CN' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '开始朗读' }))
    await waitFor(() => expect(synth.speak).toHaveBeenCalledTimes(1))
    expect(mocks.getScene).toHaveBeenCalledWith('scene')
    expect(synth.speak.mock.calls[0][0].text).toBe('雨停了。林照推开窗。')
    expect(screen.getByText('林照推开窗。')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '暂停' }))
    expect(synth.pause).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(synth.resume).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByLabelText('朗读语速'), { target: { value: '1.4' } })
    expect(screen.getByText('语速 1.4×')).toBeInTheDocument()
    await waitFor(() => expect(mocks.saveReadAloudPreferences).toHaveBeenCalledWith('p', { rate: 1.4 }))
    await userEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(synth.cancel).toHaveBeenCalled()
    expect(screen.getByText('开始后，这里会显示正在朗读的正文位置。')).toBeInTheDocument()
    expect(notify).not.toHaveBeenCalled()
  })
})

class FakeUtterance {
  text: string
  lang = ''
  rate = 1
  pitch = 1
  voice: SpeechSynthesisVoice | null = null
  onstart: ((event: SpeechSynthesisEvent) => void) | null = null
  onboundary: ((event: SpeechSynthesisEvent) => void) | null = null
  onend: ((event: SpeechSynthesisEvent) => void) | null = null
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null
  constructor(text: string) { this.text = text }
}

function node(id: string, title: string, parentId: string | null, sortKey: number): ManuscriptNode { return { id, projectId: 'p', parentId, type: id === 'book' ? 'book' : id === 'chapter' ? 'chapter' : 'scene', title, sortKey, status: 'draft', povEntityId: null, storyTime: null, deletedAt: null, wordCount: 0 } }
