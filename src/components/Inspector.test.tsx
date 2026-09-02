import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entity, KnowledgeFact, ManuscriptNode } from '../../shared/types'
import { Inspector } from './Inspector'

const mocks = vi.hoisted(() => ({
  listKnowledge: vi.fn(), listNodes: vi.fn(), createKnowledge: vi.fn(), trashKnowledge: vi.fn(), grantKnowledge: vi.fn(),
  listMentions: vi.fn(), suggestMentions: vi.fn(), currentStates: vi.fn(), detectSceneCanon: vi.fn(), checkScene: vi.fn(), ignoreIssue: vi.fn(),
  getContext: vi.fn(), getAiSettings: vi.fn(), streamAiTask: vi.fn(), warmAi: vi.fn(), recordAiDecision: vi.fn(),
  getVoiceProfile: vi.fn(), saveVoiceProfile: vi.fn(), resetVoiceProfile: vi.fn(), getProjectVoiceProfile: vi.fn(), saveProjectVoiceDefault: vi.fn(), listVoicePreferences: vi.fn(), clearVoicePreferences: vi.fn(),
  getVoiceConsistency: vi.fn(), getCharacterVoice: vi.fn(), saveCharacterVoice: vi.fn(),
  getSetting: vi.fn(), setSetting: vi.fn(),
}))
vi.mock('../lib/api', () => ({ api: mocks }))

const character: Entity = { id: 'lin', projectId: 'p', type: 'character', canonicalName: '林照', aliases: [], summary: '', privacyLevel: 'normal', createdAt: '', updatedAt: '', deletedAt: null }
const nodes = [node('book', 'book', null, 1000), node('chapter', '第一章', 'book', 1000), { ...node('s1', '场景 1', 'chapter', 1000), povEntityId: 'lin' }, { ...node('s2', '场景 2', 'chapter', 2000), povEntityId: 'lin' }]

describe('Inspector knowledge panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listNodes.mockResolvedValue(nodes)
    mocks.listKnowledge.mockResolvedValue([fact()])
    mocks.createKnowledge.mockResolvedValue(fact())
    mocks.listMentions.mockResolvedValue([])
    mocks.suggestMentions.mockResolvedValue([])
    mocks.currentStates.mockResolvedValue([])
    mocks.detectSceneCanon.mockResolvedValue([])
    mocks.checkScene.mockResolvedValue([])
    mocks.ignoreIssue.mockResolvedValue({ ok: true })
    mocks.getContext.mockResolvedValue([
      { id: 's1', type: 'scene', title: '当前场景', content: '雨落在窗前。', selected: true, privacyLevel: 'normal', estimatedTokens: 8, reason: '当前正文' },
      { id: 'voice:s1', type: 'voice', title: '本场景文风档 · 全书尚未设置，使用中性默认', content: '本场景文风档', selected: true, privacyLevel: 'normal', estimatedTokens: 40, reason: '本场文笔契约；在场景页可以改档' },
    ])
    mocks.getAiSettings.mockResolvedValue({ baseUrl: 'mock://local', model: '笔不怠演示模型', hasApiKey: false, credentialStore: 'protected_file', provider: 'demo', costPolicy: 'local_only' })
    mocks.warmAi.mockResolvedValue({ ok: true, message: '已预热' })
    mocks.recordAiDecision.mockResolvedValue(undefined)
    mocks.getVoiceProfile.mockResolvedValue(voiceProfile())
    mocks.getProjectVoiceProfile.mockResolvedValue({ ...voiceProfile(), nodeId: 'p', source: 'default', sourceLabel: '全书尚未设置，使用中性默认' })
    mocks.listVoicePreferences.mockResolvedValue([])
    mocks.getVoiceConsistency.mockResolvedValue({ score: 96, metrics: {}, issues: [], summary: '与本场文风档基本一致' })
    mocks.getCharacterVoice.mockResolvedValue({ entityId: 'lin', projectId: 'p', entityName: '林照', register: 'balanced', sentence: 'mixed', directness: 'balanced', emotion: 'balanced', signature: '', avoid: '', updatedAt: null })
    mocks.saveCharacterVoice.mockImplementation(async (_projectId: string, _entityId: string, patch: Record<string, unknown>) => ({ entityId: 'lin', projectId: 'p', entityName: '林照', register: 'balanced', sentence: 'mixed', directness: 'balanced', emotion: 'balanced', signature: '', avoid: '', updatedAt: 'now', ...patch }))
    mocks.saveVoiceProfile.mockImplementation(async (_projectId: string, _nodeId: string, knobs: Record<string, unknown>) => ({ ...voiceProfile(), ...knobs, inherited: false, source: 'scene', sourceLabel: '本场单独设置' }))
    mocks.resetVoiceProfile.mockResolvedValue({ ...voiceProfile(), source: 'project', sourceLabel: '继承全书文风' })
    mocks.saveProjectVoiceDefault.mockResolvedValue({ ...voiceProfile(), source: 'project', sourceLabel: '本书默认', inherited: true })
    mocks.getSetting.mockResolvedValue({ value: { defaultMode: 'custom', customEra: '承平' } })
    mocks.setSetting.mockResolvedValue({ ok: true })
  })
  afterEach(cleanup)

  it('shows the current POV boundary and creates facts only from explicit keywords', async () => {
    render(<Inspector projectId="p" node={nodes[2]} entities={[character]} refreshEntities={vi.fn()} onUpdateNode={vi.fn()} onRefreshTree={vi.fn()} onReloadScene={vi.fn()} notify={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: '正典' }))
    expect(await screen.findByText('当前视角：')).toBeInTheDocument()
    expect(screen.getByText('0 条已知 · 1 条未知')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '建立知识事实' }))
    await userEvent.type(screen.getByRole('textbox', { name: '秘密或知识名称' }), '凶手身份')
    await userEvent.type(screen.getByRole('textbox', { name: '正文识别词' }), '沈砚是凶手、真凶沈砚')
    await userEvent.click(screen.getByRole('combobox', { name: /首次对读者揭示/ }))
    await userEvent.click(screen.getByRole('option', { name: '场景 2' }))
    await userEvent.click(screen.getByRole('button', { name: '建立' }))
    await waitFor(() => expect(mocks.createKnowledge).toHaveBeenCalledWith('p', expect.objectContaining({ title: '凶手身份', keywords: ['沈砚是凶手', '真凶沈砚'], firstRevealedNodeId: 's2' })))
  })

  it('labels the default AI provider as a non-networked demo before generation', async () => {
    render(<Inspector projectId="p" node={nodes[2]} entities={[character]} refreshEntities={vi.fn()} onUpdateNode={vi.fn()} onRefreshTree={vi.fn()} onReloadScene={vi.fn()} notify={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: 'AI' }))
    expect(await screen.findByText('演示模式 · 固定候选 · 不联网')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '生成演示候选' })).toBeInTheDocument()
  })

  it('uses the book time system to save an ancient-style date as structured data', async () => {
    const update = vi.fn().mockResolvedValue(undefined); const notify = vi.fn(); const openSettings = vi.fn()
    render(<Inspector projectId="p" node={nodes[2]} entities={[character]} refreshEntities={vi.fn()} onUpdateNode={update} onRefreshTree={vi.fn()} onReloadScene={vi.fn()} onOpenTimeSettings={openSettings} notify={notify} />)
    await userEvent.click(screen.getByRole('button', { name: '编辑故事时间：时间未定' }))
    expect(await screen.findByRole('combobox', { name: '时间方式' })).toHaveTextContent('古风／自定义纪年')
    await userEvent.type(screen.getByRole('spinbutton', { name: '年' }), '12')
    await userEvent.type(screen.getByRole('textbox', { name: /作者显示文字/ }), '承平十二年腊月廿三子时')
    await userEvent.click(screen.getByRole('button', { name: '保存故事时间' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ storyTime: '承平十二年腊月廿三子时', storyTimeSpec: expect.objectContaining({ mode: 'custom', era: '承平', year: 12 }) })))
    expect(notify).toHaveBeenCalledWith('success', '故事时间已结构化保存')
  })

  it('shows recognized preset canon separately from continuity conflicts and refreshes after save', async () => {
    mocks.detectSceneCanon.mockResolvedValue([
      { entityId: 'lin', canonicalName: '林照', entityType: 'character', matchedNames: ['林照'], occurrenceCount: 2 },
      { entityId: 'lin-copy', canonicalName: '林照', entityType: 'character', matchedNames: ['林照'], occurrenceCount: 2 },
    ])
    const props = { projectId: 'p', node: nodes[2], entities: [character], refreshEntities: vi.fn(), onUpdateNode: vi.fn(), onRefreshTree: vi.fn(), onReloadScene: vi.fn(), notify: vi.fn() }
    const view = render(<Inspector {...props} contentVersion={0} />)
    await userEvent.click(screen.getByRole('tab', { name: '检查' }))
    expect(await screen.findByText('已识别 1 个正典名称')).toBeInTheDocument()
    expect(screen.getByText('2 份同名档案')).toBeInTheDocument()
    expect(screen.getByText('已完成冲突检查')).toBeInTheDocument()
    expect(screen.getByText('已识别正典，但暂未发现高置信度冲突。')).toBeInTheDocument()

    mocks.detectSceneCanon.mockResolvedValue([])
    view.rerender(<Inspector {...props} contentVersion={1} />)
    expect(await screen.findByText('正文暂未匹配到已设正典')).toBeInTheDocument()
    expect(mocks.detectSceneCanon).toHaveBeenCalledTimes(2)
  })

  it('shows streamed local output and lets the author stop without accepting partial text', async () => {
    mocks.getAiSettings.mockResolvedValue({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3.5:4b', hasApiKey: false, credentialStore: 'protected_file', provider: 'ollama', costPolicy: 'local_only' })
    mocks.streamAiTask.mockImplementation(async (_input, onEvent, signal: AbortSignal) => {
      onEvent({ type: 'status', stage: 'generating', message: '本地模型正在逐句生成' })
      onEvent({ type: 'delta', delta: '正在形成候选。' })
      await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
    })
    render(<Inspector projectId="p" node={nodes[2]} entities={[character]} refreshEntities={vi.fn()} onUpdateNode={vi.fn()} onRefreshTree={vi.fn()} onReloadScene={vi.fn()} notify={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: 'AI' }))
    await userEvent.click(await screen.findByRole('button', { name: '生成候选' }))
    expect(await screen.findByText('本地模型正在逐句生成')).toBeInTheDocument()
    expect(screen.getByText('正在形成候选。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(await screen.findByText('已停止生成，未写入正文')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /接受所选/ })).not.toBeInTheDocument()
  })

  it('selects a brainstorm direction together with its opportunity and risk', async () => {
    mocks.streamAiTask.mockResolvedValue({
      taskId: 'ai-1', taskType: 'brainstorm', model: '笔不怠演示模型', inputTokens: 30, outputTokens: 60, estimatedCost: null,
      output: `方向一：资源争夺。\n机会：掠夺崖壁稀有矿产；风险：触发岩层崩塌。\n\n方向二：秘境探险。\n机会：发现上古遗迹入口；风险：陷入致命陷阱。\n\n方向三：危机求生。\n机会：获取关键生存物资；风险：暴露自身位置。`,
    })
    const accepted = vi.fn()
    window.addEventListener('bbd:accept-ai', accepted as EventListener, { once: true })
    render(<Inspector projectId="p" node={nodes[2]} entities={[character]} refreshEntities={vi.fn()} onUpdateNode={vi.fn()} onRefreshTree={vi.fn()} onReloadScene={vi.fn()} notify={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: 'AI' }))
    await userEvent.click(await screen.findByRole('button', { name: '剧情脑暴' }))
    await userEvent.click(await screen.findByRole('button', { name: '生成演示候选' }))

    expect(await screen.findAllByRole('checkbox', { name: /选择方向/ })).toHaveLength(3)
    expect(screen.getAllByText('机会')).toHaveLength(3)
    expect(screen.getAllByText('风险')).toHaveLength(3)
    expect(screen.getByRole('button', { name: '接受所选 3 个方向' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: '选择方向二' }))
    await userEvent.click(screen.getByRole('button', { name: '接受所选 2 个方向' }))
    await waitFor(() => expect(mocks.recordAiDecision).toHaveBeenCalledWith('p', 's1', 'ai-1', 'accepted'))
    const detail = (accepted.mock.calls[0][0] as CustomEvent<{ text: string }>).detail
    expect(detail.text).toContain('方向一：资源争夺。')
    expect(detail.text).toContain('机会：掠夺崖壁稀有矿产')
    expect(detail.text).not.toContain('方向二：秘境探险。')
    expect(detail.text).toContain('方向三：危机求生。')
  })

  it('lets the author set a scene voice and defaults AI to idea-to-prose against that contract', async () => {
    const openBookSettings = vi.fn()
    render(<Inspector projectId="p" node={nodes[2]} entities={[character]} refreshEntities={vi.fn()} onUpdateNode={vi.fn()} onRefreshTree={vi.fn()} onReloadScene={vi.fn()} onOpenVoiceSettings={openBookSettings} notify={vi.fn()} />)
    expect(screen.queryByRole('heading', { name: '文风设置' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'AI' }))
    const compactVoice = await screen.findByRole('button', { name: /文风：继承全书 · 自然流畅 · 标准 · 平衡/ })
    await userEvent.click(compactVoice)
    await userEvent.type(screen.getByRole('textbox', { name: '本场文风说明（最优先）' }), '这场要冷、慢，不解释法术。')
    await userEvent.tab()
    await waitFor(() => expect(mocks.saveVoiceProfile).toHaveBeenCalledWith('p', 's1', { authorNote: '这场要冷、慢，不解释法术。' }))
    await userEvent.click(screen.getByRole('button', { name: '编辑全书基准文风' }))
    expect(openBookSettings).toHaveBeenCalledOnce()

    mocks.streamAiTask.mockResolvedValue({
      taskId: 'ai-polish', taskType: 'polish', model: '笔不怠演示模型', inputTokens: 20, outputTokens: 30, estimatedCost: null,
      output: '雨落在窗前，灯还没亮。',
    })
    expect(screen.getByRole('button', { name: '思路成文' })).toHaveClass('active')
    expect(screen.getByPlaceholderText(/写下情节思路或句子骨架/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '生成演示候选' }))
    await waitFor(() => expect(mocks.streamAiTask).toHaveBeenCalledWith(expect.objectContaining({ taskType: 'idea_to_prose' }), expect.any(Function), expect.any(AbortSignal)))
    expect(await screen.findByText('雨落在窗前，灯还没亮。')).toBeInTheDocument()
  })

  it('marks a scene override and can restore inheritance from the compact control', async () => {
    const notify = vi.fn()
    mocks.getVoiceProfile.mockResolvedValue({ ...voiceProfile(), inherited: false, source: 'scene', sourceLabel: '本场单独设置', family: 'restrained' })
    render(<Inspector projectId="p" node={nodes[2]} entities={[character]} refreshEntities={vi.fn()} onUpdateNode={vi.fn()} onRefreshTree={vi.fn()} onReloadScene={vi.fn()} notify={notify} />)

    await userEvent.click(screen.getByRole('tab', { name: 'AI' }))
    await userEvent.click(await screen.findByRole('button', { name: /文风：本场覆盖 · 冷峻克制/ }))
    expect(screen.getByText('当前场景使用单独设置，不受全书后续修改影响。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '恢复全书' }))
    await waitFor(() => expect(mocks.resetVoiceProfile).toHaveBeenCalledWith('p', 's1'))
    expect(notify).toHaveBeenCalledWith('success', '本场已恢复继承全书文风')
  })

  it('opens from an exact editor selection and accepts one replacement candidate', async () => {
    mocks.streamAiTask.mockResolvedValue({
      taskId: 'ai-selection', taskType: 'style_rewrite', model: '笔不怠演示模型', inputTokens: 20, outputTokens: 25, estimatedCost: null,
      output: '候选一：他把手拢进袖中。\n候选二：他的指节隐入袖口。\n候选三：他慢慢收回手。',
    })
    const replaced = vi.fn((event: Event) => { (event as CustomEvent<{ applied?: boolean }>).detail.applied = true })
    window.addEventListener('bbd:replace-ai', replaced, { once: true })
    render(<Inspector projectId="p" node={nodes[2]} entities={[character]} refreshEntities={vi.fn()} onUpdateNode={vi.fn()} onRefreshTree={vi.fn()} onReloadScene={vi.fn()} notify={vi.fn()} />)
    const selection = { nodeId: 's1', sourceContentHash: 'hash-1', startOffset: 6, endOffset: 13, originalText: '只把手收回袖中', contextBefore: '他没有回答，', contextAfter: '。' }
    window.dispatchEvent(new CustomEvent('bbd:open-ai-selection', { detail: { taskType: 'style_rewrite', selection } }))

    expect(await screen.findByText('“只把手收回袖中”')).toBeInTheDocument()
    await waitFor(() => expect(mocks.streamAiTask).toHaveBeenCalledWith(expect.objectContaining({ taskType: 'style_rewrite', selectionAnchor: selection }), expect.any(Function), expect.any(AbortSignal)))
    expect(await screen.findAllByRole('radio')).toHaveLength(3)
    await userEvent.click(screen.getAllByRole('radio')[1])
    await userEvent.click(screen.getByRole('button', { name: '用此候选替换' }))
    const detail = (replaced.mock.calls[0][0] as CustomEvent<{ text: string; selection: typeof selection }>).detail
    expect(detail).toMatchObject({ text: '他的指节隐入袖口。', selection })
  })

  it('keeps scene voice consistency explicit in the check panel', async () => {
    render(<Inspector projectId="p" node={nodes[2]} entities={[character]} refreshEntities={vi.fn()} onUpdateNode={vi.fn()} onRefreshTree={vi.fn()} onReloadScene={vi.fn()} notify={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: '检查' }))
    expect(await screen.findByRole('heading', { name: '文风一致性' })).toBeInTheDocument()
    expect(screen.getByText('与本场文风档基本一致')).toBeInTheDocument()
  })
})

function node(id: string, title: string, parentId: string | null, sortKey: number): ManuscriptNode { return { id, projectId: 'p', parentId, type: id === 'book' ? 'book' : id === 'chapter' ? 'chapter' : 'scene', title, sortKey, status: 'draft', povEntityId: null, storyTime: null, deletedAt: null, wordCount: 0 } }
function fact(): KnowledgeFact { return { id: 'k', projectId: 'p', title: '凶手身份', detail: '凶手是沈砚', keywords: ['沈砚是凶手'], firstRevealedNodeId: 's2', privacyLevel: 'author_only', createdAt: '', updatedAt: '', deletedAt: null, grants: [{ id: 'g', knowledgeId: 'k', entityId: 'lin', knownFromNodeId: 's2', sourceNodeId: 's2', evidence: '', note: '', createdAt: '' }] } }
function voiceProfile() {
  return {
    nodeId: 's1', projectId: 'p', inherited: true, source: 'default' as const, sourceLabel: '全书尚未设置，使用中性默认',
    family: 'natural' as const, intensity: 'standard' as const, pace: 'balanced' as const, imagery: 'medium' as const,
    distance: 'medium' as const, interiority: 'medium' as const, intents: [],
    register: 'balanced' as const, sentence: 'mixed' as const, dialogue: 'balanced' as const, allusion: 'light' as const, slang: 'avoid' as const,
    authorNote: '', contract: '本场景文风档', updatedAt: null,
  }
}
