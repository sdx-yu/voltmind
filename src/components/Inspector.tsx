import { useEffect, useMemo, useRef, useState } from 'react'
import { diffWords } from 'diff'
import { Bot, BrainCircuit, Check, ChevronDown, CircleAlert, Clock3, Eye, FileClock, Link2, LoaderCircle, LockKeyhole, MessageSquareText, PenLine, Plus, RotateCcw, ScanSearch, Sparkles, Square, Trash2, UserRound, WandSparkles, X } from 'lucide-react'
import type { AiContextItem, AiTaskResult, CanonDetection, CharacterVoiceKnobs, CharacterVoiceProfile, ContinuityIssue, EditorAiRequest, Entity, EntityState, KnowledgeFact, ManuscriptNode, Mention, Revision, SceneVoiceProfile, TextSelectionAnchor, VoiceConsistencyReport, VoiceKnobs, VoicePreferenceSummary } from '../../shared/types'
import { applyStyleFamily, compileVoiceContract, voiceKnobLabels, voiceSummary } from '../../shared/voice'
import { api } from '../lib/api'
import { candidateUnits, splitBrainstormDirections, splitSentenceCandidates } from '../lib/aiCandidates'
import { ConfirmDialog } from './ConfirmDialog'
import { Modal } from './Modal'
import { SceneVoiceControl } from './VoiceSettings'
import { StoryTimeControl } from './StoryTimeControl'
import { Badge, Button, IconButton, SelectControl, SelectField, Tabs, TextareaField, TextField } from '../ui'

type Tab = 'scene' | 'canon' | 'check' | 'ai'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'scene', label: '场景' },
  { id: 'canon', label: '正典' },
  { id: 'check', label: '检查' },
  { id: 'ai', label: 'AI' },
]

interface Props {
  projectId: string
  node: ManuscriptNode
  entities: Entity[]
  contentVersion?: number
  refreshEntities: () => Promise<void>
  onUpdateNode: (patch: Partial<ManuscriptNode>) => Promise<void>
  onRefreshTree: () => Promise<void>
  onReloadScene: () => void
  notify: (type: 'success' | 'error', message: string) => void
  onClose?: () => void
  onOpenVoiceSettings?: () => void
  onOpenTimeSettings?: () => void
}

export function Inspector({ projectId, node, entities, contentVersion = 0, refreshEntities, onUpdateNode, onRefreshTree, onReloadScene, notify, onClose, onOpenVoiceSettings, onOpenTimeSettings }: Props) {
  const [tab, setTab] = useState<Tab>('scene')
  const [pendingAiRequest, setPendingAiRequest] = useState<EditorAiRequest | null>(null)
  useEffect(() => {
    const openSelection = (event: Event) => {
      const request = (event as CustomEvent<EditorAiRequest>).detail
      if (!request?.selection || request.selection.nodeId !== node.id) return
      setPendingAiRequest(request); setTab('ai')
    }
    window.addEventListener('bbd:open-ai-selection', openSelection)
    return () => window.removeEventListener('bbd:open-ai-selection', openSelection)
  }, [node.id])
  return <aside className="inspector" aria-label="场景检查器">
    <div className="ui-inspector-tabbar"><Tabs items={TABS} value={tab} onChange={(value) => setTab(value as Tab)} label="检查器分页" />{onClose && <IconButton size="small" className="inspector-close" onClick={onClose} label="关闭检查器"><X size={16} /></IconButton>}</div>
    <div className="inspector-scroll">
      {tab === 'scene' && <ScenePanel projectId={projectId} node={node} entities={entities} onUpdateNode={onUpdateNode} onRefreshTree={onRefreshTree} onReloadScene={onReloadScene} onOpenTimeSettings={onOpenTimeSettings} notify={notify} />}
      {tab === 'canon' && <CanonPanel projectId={projectId} node={node} entities={entities} contentVersion={contentVersion} refreshEntities={refreshEntities} notify={notify} />}
      {tab === 'check' && <CheckPanel node={node} contentVersion={contentVersion} notify={notify} />}
      {tab === 'ai' && <AiPanel projectId={projectId} node={node} notify={notify} pendingRequest={pendingAiRequest} onRequestConsumed={() => setPendingAiRequest(null)} onOpenVoiceSettings={onOpenVoiceSettings} />}
    </div>
  </aside>
}

function ScenePanel({ projectId, node, entities, onUpdateNode, onRefreshTree, onReloadScene, onOpenTimeSettings, notify }: Pick<Props, 'projectId' | 'node' | 'entities' | 'onUpdateNode' | 'onRefreshTree' | 'onReloadScene' | 'onOpenTimeSettings' | 'notify'>) {
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [previewRevision, setPreviewRevision] = useState<Revision | null>(null)
  const [historyFilter, setHistoryFilter] = useState<'all' | 'human' | 'ai' | 'system'>('all')
  useEffect(() => { if (showHistory) void api.listRevisions(node.id).then(setRevisions) }, [showHistory, node.id])
  const visibleRevisions = revisions.filter((revision) => historyFilter === 'all' || revisionGroup(revision) === historyFilter)

  async function update(patch: Partial<ManuscriptNode>) {
    try { await onUpdateNode(patch) } catch (error) { notify('error', error instanceof Error ? error.message : '更新失败') }
  }

  async function restore(revision: Revision) {
    try { await api.restoreRevision(node.id, revision.id); notify('success', '已恢复为一个新版本，当前历史没有被覆盖'); await onRefreshTree(); onReloadScene(); setShowHistory(false) }
    catch (error) { notify('error', error instanceof Error ? error.message : '恢复失败') }
  }
  async function complete() { try { const result = await api.completeScene(node.id); await onRefreshTree(); notify('success', result.candidates.length ? `场景已完成，${result.candidates.length} 条事实变化等待确认` : '场景已完成，连续性检查已经运行') } catch (error) { notify('error', error instanceof Error ? error.message : '完成场景失败') } }
  const finalStatus = node.status === 'complete' || node.status === 'published'

  return <div className="panel-stack">
    <section className="inspector-section scene-status-section"><header><span className="section-icon"><MessageSquareText size={15} /></span><h3>场景状态</h3></header>
      <div className="scene-status-fields">
        {finalStatus ? <div className="scene-final-field"><span>进度</span><div className="scene-final-state" role="status"><div><Badge tone="success">{node.status === 'published' ? '已发布' : '已完成'}</Badge><small>{node.status === 'published' ? '历史发布标记；修改正文后自动进入修订。' : '完成检查已运行；修改正文后自动进入修订。'}</small></div><Button size="small" variant="ghost" onClick={() => void update({ status: 'revising' })}>进入修订</Button></div></div> : <SelectField label="进度" value={node.status} onValueChange={(value) => void update({ status: value as ManuscriptNode['status'] })}>
          <option value="idea">想法</option><option value="planned">计划</option><option value="draft">草稿</option><option value="revising">修订中</option>
        </SelectField>}
        <StoryTimeControl projectId={projectId} node={node} onUpdateNode={onUpdateNode} notify={notify} onOpenSettings={onOpenTimeSettings}/>
        <SelectField label="视角人物" value={node.povEntityId ?? ''} onValueChange={(value) => void update({ povEntityId: value || null })}><option value="">未指定</option>{entities.filter((entity) => entity.type === 'character').map((entity) => <option key={entity.id} value={entity.id}>{entity.canonicalName}</option>)}</SelectField>
      </div>
      {!finalStatus && <div className="scene-status-action"><Button variant="primary" full leadingIcon={<Check size={16} />} onClick={() => void complete()}>完成本场景并提取事实</Button></div>}
    </section>
    <section className="inspector-section"><button className="section-toggle" onClick={() => setShowHistory(!showHistory)}><span><FileClock size={15} />版本历史</span><ChevronDown className={showHistory ? 'rotated' : ''} size={16} /></button>
      {showHistory && <><div className="revision-filters" aria-label="版本来源筛选">{([['all','全部'],['human','人工'],['ai','AI'],['system','导入/恢复']] as const).map(([value,label]) => <button key={value} className={historyFilter === value ? 'active' : ''} onClick={() => setHistoryFilter(value)}>{label}</button>)}</div><div className="revision-list">{visibleRevisions.length === 0 ? <p className="muted">当前筛选下没有版本。</p> : visibleRevisions.map((revision) => <div key={revision.id} className="revision-item"><div><strong>{new Date(revision.createdAt).toLocaleString('zh-CN')}</strong><span>{sourceLabel(revision.provenanceLabel)} · {revision.plainText.length} 字符</span></div><span className="revision-actions"><button className="icon-button" onClick={() => setPreviewRevision(revision)} aria-label="预览版本差异"><Eye size={14}/></button><button className="icon-button" onClick={() => void restore(revision)} aria-label="恢复此版本"><RotateCcw size={14} /></button></span></div>)}</div></>}
      {previewRevision && <div className="revision-preview"><header><strong>与父版本的差异</strong><button onClick={() => setPreviewRevision(null)}>关闭</button></header><small>{sourceLabel(previewRevision.provenanceLabel)} · 内容哈希 {previewRevision.contentHash.slice(0, 12)}</small><p>{diffWords(revisions.find((item) => item.id === previewRevision.parentRevisionId)?.plainText ?? '', previewRevision.plainText).map((part, index) => <span key={index} className={part.added ? 'preview-added' : part.removed ? 'preview-removed' : ''}>{part.value}</span>)}</p><button className="button secondary full" onClick={() => void restore(previewRevision)}><RotateCcw size={14}/>恢复为新版本</button></div>}
    </section>
  </div>
}

function VoicePanel({ projectId, nodeId, entities, notify }: { projectId: string; nodeId: string; entities: Entity[]; notify: Props['notify'] }) {
  const [profile, setProfile] = useState<SceneVoiceProfile | null>(null)
  const [projectProfile, setProjectProfile] = useState<SceneVoiceProfile | null>(null)
  const [voiceScope, setVoiceScope] = useState<'book' | 'scene'>('scene')
  const [preferences, setPreferences] = useState<VoicePreferenceSummary[]>([])
  const [characterId, setCharacterId] = useState('')
  const [characterVoice, setCharacterVoice] = useState<CharacterVoiceProfile | null>(null)
  const labels = voiceKnobLabels()
  useEffect(() => {
    void Promise.all([api.getVoiceProfile(projectId, nodeId), api.getProjectVoiceProfile(projectId), api.listVoicePreferences(projectId)]).then(([next, nextProject, nextPreferences]) => { setProfile(next); setProjectProfile(nextProject); setPreferences(nextPreferences) }).catch((error) => notify('error', error instanceof Error ? error.message : '文风设置加载失败'))
  }, [projectId, nodeId, notify])
  async function patch(knobs: Partial<VoiceKnobs>) {
    try {
      if (voiceScope === 'book' && projectProfile) {
        const nextProject = await api.saveProjectVoiceDefault(projectId, { ...projectProfile, ...knobs, intents: [] })
        setProjectProfile(nextProject)
        if (profile?.inherited) setProfile(await api.getVoiceProfile(projectId, nodeId))
        return
      }
      setProfile(await api.saveVoiceProfile(projectId, nodeId, knobs))
    } catch (error) { notify('error', error instanceof Error ? error.message : '文风设置保存失败') }
  }
  async function resetSceneVoice() {
    try { setProfile(await api.resetVoiceProfile(projectId, nodeId)); notify('success', '本场已恢复继承全书文风') }
    catch (error) { notify('error', error instanceof Error ? error.message : '恢复全书文风失败') }
  }
  const activeProfile = voiceScope === 'book' ? projectProfile : profile
  async function chooseFamily(value: VoiceKnobs['family']) { if (activeProfile) await patch(applyStyleFamily(value, activeProfile)) }
  async function toggleIntent(value: VoiceKnobs['intents'][number]) {
    if (!profile) return
    const intents = profile.intents.includes(value) ? profile.intents.filter((item) => item !== value) : [...profile.intents, value].slice(-3)
    await patch({ intents })
  }
  function updateDraft(knobs: Partial<VoiceKnobs>) {
    if (voiceScope === 'book' && projectProfile) setProjectProfile({ ...projectProfile, ...knobs })
    else if (profile) setProfile({ ...profile, ...knobs })
  }
  async function loadCharacter(value: string) {
    setCharacterId(value)
    if (!value) { setCharacterVoice(null); return }
    try { setCharacterVoice(await api.getCharacterVoice(projectId, value)) } catch (error) { notify('error', error instanceof Error ? error.message : '人物口吻加载失败') }
  }
  async function patchCharacter(value: Partial<CharacterVoiceKnobs>) {
    if (!characterId) return
    try { setCharacterVoice(await api.saveCharacterVoice(projectId, characterId, value)) } catch (error) { notify('error', error instanceof Error ? error.message : '人物口吻保存失败') }
  }
  async function clearPreferences() { await api.clearVoicePreferences(projectId); setPreferences([]); notify('success', '本机文风偏好统计已清空') }
  if (!profile || !projectProfile || !activeProfile) return null
  const preview = compileVoiceContract(activeProfile).split('\n').filter((line) => line.startsWith('- ')).slice(0, 4)
  const preferenceTaskLabels: Record<string, string> = {
    brainstorm: '脑暴', continue: '续写', rewrite: '改写', cold_read: '冷读',
    idea_to_prose: '思路成文', style_rewrite: '按文风改写', word_inspiration: '词语灵感',
  }
  return <section className="inspector-section voice-panel"><header><span className="section-icon"><PenLine size={15} /></span><h3>文风设置</h3></header>
    <div className="voice-scope-switch" role="tablist" aria-label="文风作用范围"><button type="button" role="tab" aria-selected={voiceScope === 'book'} className={voiceScope === 'book' ? 'active' : ''} onClick={() => setVoiceScope('book')}>全书基准</button><button type="button" role="tab" aria-selected={voiceScope === 'scene'} className={voiceScope === 'scene' ? 'active' : ''} onClick={() => setVoiceScope('scene')}>本场调整</button></div>
    {voiceScope === 'book' ? <div className="voice-scope-status"><strong>控制整本作品</strong><span>{projectProfile.source === 'default' ? '尚未设置，当前使用中性默认。修改后，未单独覆盖的场景都会继承。' : `${voiceSummary(projectProfile)}。未单独覆盖的场景会自动跟随。`}</span></div> : <div className={`voice-scope-status${profile.inherited ? '' : ' is-override'}`}><strong>{profile.inherited ? `当前继承：${profile.sourceLabel}` : '本场已覆盖全书文风'}</strong><span>{profile.inherited ? '修改任一文风项会为本场建立单独设置。' : '后续修改全书基准不会影响这一场。'}</span>{!profile.inherited && <button type="button" onClick={() => void resetSceneVoice()}>恢复全书设置</button>}</div>}
    <SelectField label="主风格" value={activeProfile.family} onValueChange={(value) => void chooseFamily(value as VoiceKnobs['family'])}>{Object.entries(labels.family).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
    <div className="voice-primary-grid"><SelectField label="改写幅度" description="控制 AI 对措辞和句式的改动程度" value={activeProfile.intensity} onValueChange={(value) => void patch({ intensity: value as VoiceKnobs['intensity'] })}>{Object.entries(labels.intensity).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="节奏" value={activeProfile.pace} onValueChange={(value) => void patch({ pace: value as VoiceKnobs['pace'] })}>{Object.entries(labels.pace).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField></div>
    {voiceScope === 'scene' && <fieldset className="voice-intents"><legend>场景意图（最多 3 项，仅本场生效）</legend>{Object.entries(labels.intents).map(([value, label]) => <button type="button" key={value} className={profile.intents.includes(value as VoiceKnobs['intents'][number]) ? 'active' : ''} onClick={() => void toggleIntent(value as VoiceKnobs['intents'][number])}>{label}</button>)}</fieldset>}
    <details className="voice-advanced"><summary>表达维度</summary><div className="form-stack"><SelectField label="句长" value={activeProfile.sentence} onValueChange={(value) => void patch({ sentence: value as VoiceKnobs['sentence'] })}>{Object.entries(labels.sentence).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="叙事距离" value={activeProfile.distance} onValueChange={(value) => void patch({ distance: value as VoiceKnobs['distance'] })}>{Object.entries(labels.distance).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="心理描写" value={activeProfile.interiority} onValueChange={(value) => void patch({ interiority: value as VoiceKnobs['interiority'] })}>{Object.entries(labels.interiority).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="意象密度" value={activeProfile.imagery} onValueChange={(value) => void patch({ imagery: value as VoiceKnobs['imagery'] })}>{Object.entries(labels.imagery).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="语域" value={activeProfile.register} onValueChange={(value) => void patch({ register: value as VoiceKnobs['register'] })}>{Object.entries(labels.register).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="对白" value={activeProfile.dialogue} onValueChange={(value) => void patch({ dialogue: value as VoiceKnobs['dialogue'] })}>{Object.entries(labels.dialogue).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="用典" value={activeProfile.allusion} onValueChange={(value) => void patch({ allusion: value as VoiceKnobs['allusion'] })}>{Object.entries(labels.allusion).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="套话" value={activeProfile.slang} onValueChange={(value) => void patch({ slang: value as VoiceKnobs['slang'] })}>{Object.entries(labels.slang).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField></div></details>
    <TextareaField label={voiceScope === 'book' ? '全书文风说明（最优先）' : '本场文风说明（最优先）'} value={activeProfile.authorNote} onChange={(event) => updateDraft({ authorNote: event.target.value })} onBlur={(event) => void patch({ authorNote: event.target.value })} rows={3} placeholder={voiceScope === 'book' ? '例如：整体克制、少解释设定，以具体动作承载情绪。' : '例如：这场要冷、慢，不解释法术，沈砚少说话。'} />
    <div className="voice-contract-preview" aria-label="模型将读到的文风约束">{preview.map((line) => <small key={line}>{line.slice(2)}</small>)}</div>
    <details className="character-voice"><summary>人物对白口吻</summary>
      <SelectField label="人物" value={characterId} onValueChange={(value) => void loadCharacter(value)}><option value="">选择人物…</option>{entities.filter((entity) => entity.type === 'character').map((entity) => <option key={entity.id} value={entity.id}>{entity.canonicalName}</option>)}</SelectField>
      {characterVoice && <div className="form-stack">
        <SelectField label="口吻语域" value={characterVoice.register} onValueChange={(value) => void patchCharacter({ register: value as CharacterVoiceKnobs['register'] })}>{Object.entries(labels.register).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
        <SelectField label="句式习惯" value={characterVoice.sentence} onValueChange={(value) => void patchCharacter({ sentence: value as CharacterVoiceKnobs['sentence'] })}>{Object.entries(labels.sentence).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
        <SelectField label="表达直接度" value={characterVoice.directness} onValueChange={(value) => void patchCharacter({ directness: value as CharacterVoiceKnobs['directness'] })}><option value="indirect">含蓄回避</option><option value="balanced">适中</option><option value="direct">直接</option></SelectField>
        <SelectField label="情绪外露" value={characterVoice.emotion} onValueChange={(value) => void patchCharacter({ emotion: value as CharacterVoiceKnobs['emotion'] })}><option value="restrained">克制</option><option value="balanced">适中</option><option value="expressive">外放</option></SelectField>
        <TextField label="说话习惯" value={characterVoice.signature} onChange={(event) => setCharacterVoice({ ...characterVoice, signature: event.target.value })} onBlur={(event) => void patchCharacter({ signature: event.target.value })} placeholder="例如：回答前先反问，不说完整句"/>
        <TextField label="避免" value={characterVoice.avoid} onChange={(event) => setCharacterVoice({ ...characterVoice, avoid: event.target.value })} onBlur={(event) => void patchCharacter({ avoid: event.target.value })} placeholder="例如：不说网络词，不解释动机"/>
      </div>}
    </details>
    {preferences.length > 0 && <details className="voice-preferences"><summary>本机采用偏好 · {preferences.reduce((total, item) => total + item.accepted, 0)} 次接受</summary>
      <p>只统计接受、丢弃和撤销次数，不保存候选正文，也不会自动改文风。</p>
      <div className="voice-preference-list">{preferences.slice(0, 5).map((item) => <div key={`${item.family}-${item.taskType}`}><span>{labels.family[item.family]} · {preferenceTaskLabels[item.taskType] ?? item.taskType}</span><small>接受 {item.accepted} · 丢弃 {item.rejected} · 撤销 {item.undone}</small></div>)}</div>
      <button className="button ghost compact" onClick={() => void clearPreferences()}>清空偏好统计</button>
    </details>}
  </section>
}

function CanonPanel({ projectId, node, entities, contentVersion, refreshEntities, notify }: Pick<Props, 'projectId' | 'node' | 'entities' | 'contentVersion' | 'refreshEntities' | 'notify'>) {
  const [suggestions, setSuggestions] = useState<Array<Omit<Mention, 'id' | 'createdAt'>>>([])
  const [mentions, setMentions] = useState<Mention[]>([])
  const [currentStates, setCurrentStates] = useState<EntityState[]>([])
  const [name, setName] = useState('')
  const [type, setType] = useState<Entity['type']>('character')
  const entityMap = useMemo(() => new Map(entities.map((entity) => [entity.id, entity])), [entities])

  async function refresh() {
    const [nextMentions, nextSuggestions, nextStates] = await Promise.all([api.listMentions(node.id), api.suggestMentions(node.id), api.currentStates(node.id)])
    setMentions(nextMentions); setSuggestions(nextSuggestions); setCurrentStates(nextStates)
  }
  useEffect(() => { void refresh() }, [node.id, entities, contentVersion])

  async function addEntity() {
    if (!name.trim()) return
    try { await api.createEntity(projectId, { type, canonicalName: name.trim() }); setName(''); await refreshEntities(); notify('success', '已加入正典库') }
    catch (error) { notify('error', error instanceof Error ? error.message : '创建失败') }
  }

  async function confirmMention(suggestion: Omit<Mention, 'id' | 'createdAt'>) {
    try { await api.createMention(node.id, { ...suggestion, confirmed: true }); await refresh(); notify('success', `已确认“${suggestion.quote}”的正文反链`) }
    catch (error) { notify('error', error instanceof Error ? error.message : '确认失败') }
  }

  return <div className="panel-stack">
    <section className="inspector-section"><header><span className="section-icon"><UserRound size={15} /></span><h3>场景相关正典</h3></header>
      {mentions.length === 0 ? <p className="muted">正文中提到人物或设定后，可在这里建立反链。</p> : <div className="chip-list">{mentions.map((mention) => <button key={mention.id} className="entity-chip" onClick={() => window.dispatchEvent(new CustomEvent('bbd:locate-mention', { detail: mention }))}><Link2 size={12} />{entityMap.get(mention.entityId)?.canonicalName ?? mention.quote}</button>)}</div>}
      {suggestions.length > 0 && <div className="suggestion-box"><strong>发现 {suggestions.length} 个未确认提及</strong>{suggestions.slice(0, 8).map((suggestion, index) => <button key={`${suggestion.entityId}-${suggestion.startOffset}-${index}`} onClick={() => void confirmMention(suggestion)}><span>“{suggestion.quote}”</span><Check size={13} /></button>)}</div>}
      {currentStates.filter((state) => mentions.some((mention) => mention.entityId === state.entityId)).length > 0 && <div className="current-state-box"><strong>本场景时点状态</strong>{currentStates.filter((state) => mentions.some((mention) => mention.entityId === state.entityId)).map((state) => <div key={state.id}><span>{entityMap.get(state.entityId)?.canonicalName} · {state.attributeKey}</span><b>{String(state.value)}</b></div>)}</div>}
    </section>
    <section className="inspector-section"><header><span className="section-icon"><Sparkles size={15} /></span><h3>快速加入正典</h3></header>
      <div className="inline-form"><SelectControl aria-label="正典类型" value={type} onValueChange={(value) => setType(value as Entity['type'])}><option value="character">人物</option><option value="location">地点</option><option value="item">物品</option><option value="event">事件</option></SelectControl><input value={name} onChange={(event) => setName(event.target.value)} placeholder="名称" /><button className="button secondary" disabled={!name.trim()} onClick={() => void addEntity()}>加入</button></div>
    </section>
    <KnowledgePanel projectId={projectId} node={node} entities={entities} notify={notify} />
  </div>
}

function KnowledgePanel({ projectId, node, entities, notify }: Pick<Props, 'projectId' | 'node' | 'entities' | 'notify'>) {
  const [facts, setFacts] = useState<KnowledgeFact[]>([])
  const [nodes, setNodes] = useState<ManuscriptNode[]>([])
  const [creating, setCreating] = useState(false)
  const [granting, setGranting] = useState<KnowledgeFact | null>(null)
  const pov = entities.find((entity) => entity.id === node.povEntityId)
  async function refresh() { const [nextFacts, nextNodes] = await Promise.all([api.listKnowledge(projectId), api.listNodes(projectId)]); setFacts(nextFacts); setNodes(nextNodes) }
  useEffect(() => { void refresh().catch(() => notify('error', '角色知识范围加载失败')) }, [projectId, node.id])
  const [pendingTrash, setPendingTrash] = useState<KnowledgeFact | null>(null)
  async function remove() {
    if (!pendingTrash) return
    await api.trashKnowledge(pendingTrash.id)
    setPendingTrash(null)
    await refresh()
    notify('success', '知识事实已移出当前列表')
  }
  return <div className="panel-stack knowledge-stack"><section className="inspector-section"><header><span className="section-icon"><BrainCircuit size={15}/></span><h3>POV 知情范围</h3></header>{pov ? <p className="knowledge-pov">当前视角：<strong>{pov.canonicalName}</strong><span>{facts.filter((fact) => knownAt(fact, pov.id, node.id, nodes)).length} 条已知 · {facts.filter((fact) => !knownAt(fact, pov.id, node.id, nodes)).length} 条未知</span></p> : <p className="muted">先为场景指定视角人物，系统才会检查知识泄露。</p>}<button className="button secondary full" onClick={() => setCreating(true)}><Plus size={14}/>建立知识事实</button></section>
    {facts.map((fact) => { const known = Boolean(pov && knownAt(fact, pov.id, node.id, nodes)); const grant = pov ? fact.grants.find((item) => item.entityId === pov.id) : null; return <article key={fact.id} className={`knowledge-card ${known ? 'known' : 'unknown'}`}><header><span>{known ? '当前已知' : '当前未知'}</span><button className="icon-button" aria-label={`移除知识 ${fact.title}`} onClick={() => setPendingTrash(fact)}><Trash2 size={13}/></button></header><h4>{fact.title}</h4>{fact.detail && <p>{fact.detail}</p>}<small>识别词：{fact.keywords.join('、')}</small>{grant && <small>知情起点：{nodeName(nodes, grant.knownFromNodeId)}</small>}<button className="knowledge-grant" disabled={!pov} onClick={() => setGranting(fact)}>{grant ? '调整当前 POV 知情起点' : '让当前 POV 从某场景起知情'}</button></article> })}
    {creating && <CreateKnowledgeModal projectId={projectId} nodes={nodes} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await refresh() }} notify={notify}/>} {granting && pov && <GrantKnowledgeModal fact={granting} entity={pov} nodes={nodes} onClose={() => setGranting(null)} onSaved={async () => { setGranting(null); await refresh() }} notify={notify}/>}
    {pendingTrash && <ConfirmDialog title="移出知识事实" message={`把知识事实“${pendingTrash.title}”移出当前正典？`} confirmLabel="移出当前列表" danger onConfirm={() => void remove()} onClose={() => setPendingTrash(null)} />}
    </div>
}

function CreateKnowledgeModal({ projectId, nodes, onClose, onCreated, notify }: { projectId: string; nodes: ManuscriptNode[]; onClose: () => void; onCreated: () => void; notify: Props['notify'] }) {
  const [title, setTitle] = useState(''); const [detail, setDetail] = useState(''); const [keywords, setKeywords] = useState(''); const [reveal, setReveal] = useState('')
  async function submit() { try { await api.createKnowledge(projectId, { title, detail, keywords: keywords.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean), firstRevealedNodeId: reveal || null, privacyLevel: 'author_only' }); notify('success', '知识事实已建立，尚未自动授予任何角色'); onCreated() } catch (error) { notify('error', error instanceof Error ? error.message : '知识事实创建失败') } }
  return <Modal title="建立知识事实" onClose={onClose}><div className="form-stack"><TextField label="秘密或知识名称" required autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：凶手是沈砚"/><TextareaField label="作者说明" optional value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="只对作者可见的事实说明"/><TextField label="正文识别词" required value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="用顿号分隔，如：沈砚是凶手、真凶沈砚" description="至少填写一个不少于 2 个字的明确识别词。"/><SelectField label="首次对读者揭示" optional value={reveal} onValueChange={setReveal}><option value="">未指定</option>{sceneNodes(nodes).map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</SelectField><p className="form-hint">系统只按这些明确识别词检查，不会让 AI 猜测隐含含义。</p><div className="modal-actions"><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!title.trim() || keywords.split(/[、,，\n]/).every((item) => item.trim().length < 2)} onClick={() => void submit()}>建立</button></div></div></Modal>
}

function GrantKnowledgeModal({ fact, entity, nodes, onClose, onSaved, notify }: { fact: KnowledgeFact; entity: Entity; nodes: ManuscriptNode[]; onClose: () => void; onSaved: () => void; notify: Props['notify'] }) {
  const current = fact.grants.find((item) => item.entityId === entity.id); const [from, setFrom] = useState(current?.knownFromNodeId ?? ''); const [evidence, setEvidence] = useState(current?.evidence ?? ''); const [note, setNote] = useState(current?.note ?? '')
  async function submit() { try { await api.grantKnowledge(fact.id, entity.id, { knownFromNodeId: from, sourceNodeId: from, evidence, note }); notify('success', `${entity.canonicalName}的知情起点已更新`); onSaved() } catch (error) { notify('error', error instanceof Error ? error.message : '知情范围保存失败') } }
  return <Modal title={`${entity.canonicalName}何时知道“${fact.title}”`} onClose={onClose}><div className="form-stack"><SelectField label="从场景起知情" required value={from} onValueChange={setFrom}><option value="">请选择</option>{sceneNodes(nodes).map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}</SelectField><TextField label="知情证据" optional value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="例如：他亲眼看见密信落款"/><TextareaField label="作者备注" optional value={note} onChange={(event) => setNote(event.target.value)} /><div className="modal-actions"><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!from} onClick={() => void submit()}>保存知情起点</button></div></div></Modal>
}

function knownAt(fact: KnowledgeFact, entityId: string, nodeId: string, nodes: ManuscriptNode[]) { const scenes = sceneNodes(nodes); const order = new Map(scenes.map((scene, index) => [scene.id, index])); const grant = fact.grants.find((item) => item.entityId === entityId); return Boolean(grant && (order.get(grant.knownFromNodeId) ?? Number.MAX_SAFE_INTEGER) <= (order.get(nodeId) ?? -1)) }
function sceneNodes(nodes: ManuscriptNode[]) { const chapters = nodes.filter((node) => node.type === 'chapter' && !node.deletedAt).sort((a, b) => a.sortKey - b.sortKey); return chapters.flatMap((chapter) => nodes.filter((node) => node.type === 'scene' && node.parentId === chapter.id && !node.deletedAt).sort((a, b) => a.sortKey - b.sortKey)) }
function nodeName(nodes: ManuscriptNode[], id: string) { return nodes.find((node) => node.id === id)?.title ?? '未找到场景' }

function CheckPanel({ node, contentVersion, notify }: Pick<Props, 'node' | 'contentVersion' | 'notify'>) {
  const [issues, setIssues] = useState<ContinuityIssue[]>([])
  const [detections, setDetections] = useState<CanonDetection[]>([])
  const [loading, setLoading] = useState(false)
  const [voiceReport, setVoiceReport] = useState<VoiceConsistencyReport | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const detectionGroups = useMemo(() => groupCanonDetections(detections), [detections])
  async function runCheck() {
    setLoading(true)
    try {
      const [nextIssues, nextDetections, nextVoice] = await Promise.all([api.checkScene(node.id), api.detectSceneCanon(node.id), api.getVoiceConsistency(node.projectId, node.id)])
      setIssues(nextIssues); setDetections(nextDetections); setVoiceReport(nextVoice)
    } catch (error) { notify('error', error instanceof Error ? error.message : '检查失败') }
    finally { setLoading(false) }
  }
  useEffect(() => { void runCheck() }, [node.id, contentVersion])
  async function ignore(issue: ContinuityIssue) { try { await api.ignoreIssue(node.id, issue, '作者选择忽略本场景提示'); setIssues((current) => current.filter((item) => item.id !== issue.id)); notify('success', '已记录为本场景例外，后续检查不会重复提示') } catch (error) { notify('error', error instanceof Error ? error.message : '忽略失败') } }
  return <div className="panel-stack"><section className="inspector-section canon-detection-section"><header><span className="section-icon"><ScanSearch size={15} /></span><h3>正文正典识别</h3></header>
    {detectionGroups.length ? <><p className="canon-detection-summary"><strong>已识别 {detectionGroups.length} 个正典名称</strong><span>共 {detectionGroups.reduce((total, item) => total + item.occurrenceCount, 0)} 处正文提及</span></p><div className="canon-detection-list">{detectionGroups.map((item) => <div key={`${item.entityType}-${item.canonicalName}`} className={item.recordCount > 1 ? 'is-ambiguous' : ''}><span><strong>{item.canonicalName}</strong><small>{canonTypeLabel(item.entityType)} · 匹配 {item.matchedNames.join('、')} · {item.occurrenceCount} 处</small></span>{item.recordCount > 1 && <em>{item.recordCount} 份同名档案</em>}</div>)}</div>{detectionGroups.some((item) => item.recordCount > 1) && <p className="canon-detection-warning"><CircleAlert size={13}/>同名档案会同时命中。请在正典库保留正确档案，避免状态检查产生歧义。</p>}</> : !loading && <div className="canon-detection-empty"><strong>正文暂未匹配到已设正典</strong><span>系统按至少 2 个字的正典名称或别名精确识别；正文保存后会自动刷新。</span></div>}
  </section>{voiceReport && <section className="inspector-section voice-consistency"><header><span className="section-icon"><PenLine size={15}/></span><h3>文风一致性</h3><strong>{voiceReport.score}</strong></header><p>{voiceReport.summary}</p>{voiceReport.issues.map((issue) => <div key={issue.code}><strong>{issue.label}</strong><span>{issue.detail}</span><small>{issue.evidence}</small></div>)}</section>}<section className="inspector-section"><header><span className="section-icon"><Eye size={15} /></span><h3>连续性冲突</h3></header>
    <p className="muted">识别成功不等于存在冲突；这里只报告有证据的问题。</p><button className="button secondary full" disabled={loading} onClick={() => void runCheck()}>{loading ? '正在检查…' : '重新检查'}</button>
  </section>{issues.length === 0 && !loading ? <div className="all-clear"><Check size={20} /><strong>已完成冲突检查</strong><span>{detectionGroups.length ? '已识别正典，但暂未发现高置信度冲突。' : '正文尚未命中正典，也没有可报告的冲突。'}</span></div> : issues.map((issue) => <article key={issue.id} className={`issue-card issue-${issue.severity}`}><header><CircleAlert size={16} /><span>{issue.severity === 'risk' ? '错误风险' : '建议复核'}</span><small>{Math.round(issue.confidence * 100)}%</small></header><p>{issue.message}</p><blockquote>{issue.currentEvidence.quote}</blockquote>{expanded.has(issue.id) && issue.conflictingEvidence && <blockquote className="conflicting-evidence">冲突证据：{issue.conflictingEvidence.quote}</blockquote>}<div className="issue-actions"><button onClick={() => setExpanded((current) => { const next = new Set(current); next.has(issue.id) ? next.delete(issue.id) : next.add(issue.id); return next })}>查看证据</button><button onClick={() => void ignore(issue)}>忽略一次</button></div></article>)}</div>
}

function AiPanel({ projectId, node, notify, pendingRequest, onRequestConsumed, onOpenVoiceSettings }: Pick<Props, 'projectId' | 'node' | 'notify' | 'onOpenVoiceSettings'> & { pendingRequest: EditorAiRequest | null; onRequestConsumed: () => void }) {
  const [context, setContext] = useState<AiContextItem[]>([])
  const [provider, setProvider] = useState<{ kind: 'demo' | 'ollama' | 'blocked'; model: string } | null>(null)
  const [contextOpen, setContextOpen] = useState(false)
  const [task, setTask] = useState('idea_to_prose')
  const [selectionAnchor, setSelectionAnchor] = useState<TextSelectionAnchor | null>(null)
  const [instruction, setInstruction] = useState('')
  const [result, setResult] = useState<AiTaskResult | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('正在准备本地任务')
  const [streamOutput, setStreamOutput] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [runNotice, setRunNotice] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [selectedSegments, setSelectedSegments] = useState<Set<number>>(new Set())
  const runController = useRef<AbortController | null>(null)
  const processedRequest = useRef('')
  async function reloadContext() {
    try {
      const [nextContext, settings] = await Promise.all([api.getContext(projectId, node.id), api.getAiSettings()])
      setContext(nextContext); setProvider({ kind: settings.provider, model: settings.model })
      if (settings.provider === 'ollama') void api.warmAi().catch(() => {})
    } catch (error) { notify('error', error instanceof Error ? error.message : 'AI 配置与上下文加载失败') }
  }
  useEffect(() => {
    const reload = () => { void reloadContext() }
    void reloadContext(); window.addEventListener('bbd:ai-settings-changed', reload)
    setResult(null); setAccepted(false)
    return () => { window.removeEventListener('bbd:ai-settings-changed', reload); runController.current?.abort(); runController.current = null }
  }, [projectId, node.id])
  useEffect(() => {
    if (!running) return
    const started = Date.now(); setElapsed(0)
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1_000)), 1_000)
    return () => window.clearInterval(timer)
  }, [running])
  const selected = context.filter((item) => item.selected)
  const tokens = selected.reduce((total, item) => total + item.estimatedTokens, 0)
  const demoMode = provider?.kind !== 'ollama'
  const providerLabel = !provider ? '正在确认模型状态…' : provider.kind === 'ollama' ? `本地免费 · ${provider.model} · API 费用 ¥0` : provider.kind === 'blocked' ? '外网模型已停用 · 零费用保护生效' : '演示模式 · 固定候选 · 不联网'
  const instructionHint = ({
    word_inspiration: '还缺哪类词？例如：更具体的动作、潮湿环境的感官词。（可选）',
    style_rewrite: '补充改写倾向，例如：更冷、更轻、更少解释。（可选）',
    idea_to_prose: '写下情节思路或句子骨架，AI 会按本场文风写成一小段正文。',
    polish: '把思路或骨架贴在这里。事实不动，只按本场文风改词面。',
    beat: '写这一拍的思路，例如：他不解释，只把门关上。只往前走一步。',
    brainstorm: '你想围绕什么卡住的点脑暴？（可选）',
    rewrite: '改写方向，例如：更冷、少解释。',
    continue: '续写方向（可选）。更长的续写仍受本场文风档约束。',
    cold_read: '你想让冷读盯哪一段？（可选）',
  } as Record<string, string>)[task] ?? '补充你的要求（可选）'

  async function run(taskOverride?: string, selectionOverride?: TextSelectionAnchor | null) {
    const activeTask = taskOverride ?? task
    const activeSelection = selectionOverride === undefined ? selectionAnchor : selectionOverride
    const controller = new AbortController(); runController.current?.abort(); runController.current = controller
    setRunning(true); setResult(null); setAccepted(false); setStreamOutput(''); setRunNotice(''); setProgress('正在整理本地上下文')
    try {
      const next = await api.streamAiTask({ projectId, nodeId: node.id, taskType: activeTask, instruction, selectedContextIds: selected.map((item) => item.id), selectionAnchor: activeSelection ?? undefined }, (event) => {
        if (event.type === 'status') { if (event.resetOutput) setStreamOutput(''); setProgress(event.message) }
        if (event.type === 'delta') setStreamOutput((current) => current + event.delta)
      }, controller.signal)
      setResult(next)
      const units = candidateUnits(next.taskType, next.output)
      setSelectedSegments(isSingleChoiceTask(next.taskType) ? new Set(units.length ? [0] : []) : new Set(units.map((_, index) => index)))
      setStreamOutput('')
    }
    catch (error) {
      const message = controller.signal.aborted ? '已停止生成，未写入正文' : error instanceof Error ? error.message : 'AI 任务失败'
      setRunNotice(message); setStreamOutput(''); if (!controller.signal.aborted) notify('error', message)
    }
    finally { if (runController.current === controller) runController.current = null; setRunning(false) }
  }

  useEffect(() => {
    if (!pendingRequest || !provider || context.length === 0 || running) return
    const key = `${pendingRequest.taskType}:${pendingRequest.selection.sourceContentHash}:${pendingRequest.selection.startOffset}:${pendingRequest.selection.endOffset}`
    if (processedRequest.current === key) return
    processedRequest.current = key
    setTask(pendingRequest.taskType); setSelectionAnchor(pendingRequest.selection); onRequestConsumed()
    void run(pendingRequest.taskType, pendingRequest.selection)
  }, [pendingRequest, provider, context.length])

  function stop() { runController.current?.abort(); setProgress('正在停止本地生成') }

  function toggle(id: string) { setContext((items) => items.map((item) => item.id === id && item.type !== 'voice' && item.type !== 'time' && item.privacyLevel !== 'local_private' ? { ...item, selected: !item.selected } : item)) }
  async function accept() {
    if (!result || selectedSegments.size === 0) return
    let inserted = false
    try {
      const text = candidateUnits(result.taskType, result.output).filter((_, index) => selectedSegments.has(index)).join(result.taskType === 'brainstorm' ? '\n\n' : '')
      if (selectionAnchor && isSingleChoiceTask(result.taskType)) {
        const detail = { text, taskId: result.taskId, selection: selectionAnchor, applied: false }
        window.dispatchEvent(new CustomEvent('bbd:replace-ai', { detail })); inserted = detail.applied
        if (!inserted) return
      }
      await api.recordAiDecision(projectId, node.id, result.taskId, 'accepted')
      if (!selectionAnchor || !isSingleChoiceTask(result.taskType)) window.dispatchEvent(new CustomEvent('bbd:accept-ai', { detail: { text, taskId: result.taskId } }))
      setAccepted(true)
    } catch (error) { if (inserted) window.dispatchEvent(new Event('bbd:undo-ai')); notify('error', error instanceof Error ? error.message : 'AI 接受记录失败') }
  }
  async function reject() {
    if (!result) return
    try { await api.recordAiDecision(projectId, node.id, result.taskId, 'rejected'); setResult(null) }
    catch (error) { notify('error', error instanceof Error ? error.message : 'AI 丢弃记录失败') }
  }
  async function undoAccept() {
    if (!result) return
    try { await api.recordAiDecision(projectId, node.id, result.taskId, 'undone'); window.dispatchEvent(new Event('bbd:undo-ai')); setAccepted(false) }
    catch (error) { notify('error', error instanceof Error ? error.message : 'AI 撤销记录失败') }
  }
  return <div className="panel-stack">
    <section className="context-capsule"><button onClick={() => setContextOpen(!contextOpen)}><span><LockKeyhole size={14} />本次上下文</span><strong>{selected.length} 项 · 约 {tokens} token</strong><ChevronDown className={contextOpen ? 'rotated' : ''} size={15} /></button>
      {contextOpen && <div className="context-items">{context.map((item) => <label key={`${item.type}-${item.id}`} className={item.privacyLevel === 'local_private' ? 'private' : ''}><input type="checkbox" checked={item.selected} disabled={item.type === 'voice' || item.type === 'time' || item.privacyLevel === 'local_private'} onChange={() => toggle(item.id)} /><span><strong>{item.title}</strong><small>{item.privacyLevel === 'local_private' ? '仅本地，不会发送' : item.type === 'voice' || item.type === 'time' ? `${item.reason} · 始终带上` : `${item.reason} · ${item.estimatedTokens} token`}</small></span></label>)}</div>}
    </section>
    <section className="inspector-section"><header><span className="section-icon"><Bot size={15} /></span><h3>创作助手</h3></header>
      <p className={`ai-provider-status ${provider?.kind === 'ollama' ? 'is-live' : 'is-demo'}`}>{providerLabel}</p>
      <SceneVoiceControl projectId={projectId} nodeId={node.id} notify={notify} onOpenBookSettings={onOpenVoiceSettings} onChanged={() => void reloadContext()} />
      {selectionAnchor && <div className="ai-selection-chip"><strong>{task === 'word_inspiration' ? '词语灵感' : '按文风改写'}</strong><span>“{selectionAnchor.originalText.slice(0, 42)}{selectionAnchor.originalText.length > 42 ? '…' : ''}”</span><button type="button" onClick={() => { setSelectionAnchor(null); setTask('idea_to_prose'); setResult(null) }} aria-label="取消选区任务"><X size={13}/></button></div>}
      <div className="task-grid">{(selectionAnchor ? [['word_inspiration','词语灵感'],['style_rewrite','文风改写'],['idea_to_prose','思路成文'],['brainstorm','剧情脑暴']] : [['idea_to_prose','思路成文'],['brainstorm','剧情脑暴'],['continue','续写'],['cold_read','冷读']]).map(([value,label]) => <button key={value} className={task === value ? 'active' : ''} onClick={() => setTask(value)}>{label}</button>)}</div>
      <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={instructionHint} rows={3} />
      <button className="button primary full" disabled={running || selected.length === 0 || provider?.kind === 'blocked'} onClick={() => void run()}><WandSparkles size={16} />{running ? '正在生成…' : provider?.kind === 'blocked' ? '请先启用本地模型' : demoMode ? '生成演示候选' : '生成候选'}</button>
    </section>
    {running && <section className="ai-progress" role="status" aria-live="polite"><header><LoaderCircle className="ui-spin" size={16}/><div><strong>{progress}</strong><span>{elapsed} 秒 · 已生成 {streamOutput.length} 字</span></div><button type="button" onClick={stop}><Square size={12}/>停止</button></header>{streamOutput && <div className="ai-stream-output">{streamOutput}<span className="ai-stream-cursor" /></div>}</section>}
    {runNotice && !running && <p className="ai-run-notice"><CircleAlert size={14}/>{runNotice}</p>}
    {result && <section className="ai-result"><header><span><Sparkles size={15} />{result.model}</span><small>{result.inputTokens} → {result.outputTokens} token</small></header>{result.taskType === 'brainstorm' ? <BrainstormChoices value={result.output} accepted={accepted} selected={selectedSegments} onToggle={(index) => setSelectedSegments((current) => { const next = new Set(current); next.has(index) ? next.delete(index) : next.add(index); return next })} /> : isSingleChoiceTask(result.taskType) ? <CandidateChoices original={selectionAnchor?.originalText ?? ''} taskType={result.taskType} value={result.output} accepted={accepted} selected={selectedSegments} onSelect={(index) => setSelectedSegments(new Set([index]))}/> : <DiffText original={result.taskType === 'rewrite' || result.taskType === 'polish' ? context.find((item) => item.type === 'scene')?.content ?? '' : ''} value={result.output} accepted={accepted} selected={selectedSegments} onToggle={(index) => setSelectedSegments((current) => { const next = new Set(current); next.has(index) ? next.delete(index) : next.add(index); return next })} />}
      <div className="candidate-actions">{accepted ? <><span className="accepted-label"><Check size={14} />{isSingleChoiceTask(result.taskType) ? '候选已精确替换原选区' : `所选${result.taskType === 'brainstorm' ? '方向' : '句子'}已插入正文`}，并已记录来源</span><button className="reject" onClick={() => void undoAccept()}><RotateCcw size={14}/>撤销接受</button></> : <><button className="reject" onClick={() => void reject()}><X size={14} />丢弃</button><button className="accept" disabled={selectedSegments.size === 0} onClick={() => void accept()}><Check size={14} />{isSingleChoiceTask(result.taskType) ? '用此候选替换' : `接受所选 ${selectedSegments.size} ${result.taskType === 'brainstorm' ? '个方向' : '句'}`}</button></>}</div>
    </section>}
  </div>
}

function BrainstormChoices({ value, accepted, selected, onToggle }: { value: string; accepted: boolean; selected: Set<number>; onToggle: (index: number) => void }) {
  const directions = splitBrainstormDirections(value)
  if (!directions.length) return <DiffText original="" value={value} accepted={accepted} selected={selected} onToggle={onToggle} />
  return <div className={`brainstorm-choices ${accepted ? 'accepted' : ''}`}>{directions.map((direction, index) => <label className={`brainstorm-choice ${selected.has(index) ? 'selected' : ''}`} key={`${direction.title}-${index}`}>
    <header><input type="checkbox" aria-label={`选择${direction.title}`} checked={selected.has(index)} disabled={accepted} onChange={() => onToggle(index)} /><span>{direction.title}</span></header>
    {direction.premise && <strong>{direction.premise}</strong>}
    <div className="brainstorm-choice-details">
      {direction.opportunity && <p><span>机会</span>{direction.opportunity}</p>}
      {direction.risk && <p className="risk"><span>风险</span>{direction.risk}</p>}
      {!direction.opportunity && !direction.risk && <p>{direction.text.replace(/^方向[^：:]+[：:]\s*/, '')}</p>}
    </div>
  </label>)}</div>
}

function isSingleChoiceTask(taskType: string) { return taskType === 'word_inspiration' || taskType === 'style_rewrite' }

function CandidateChoices({ original, taskType, value, accepted, selected, onSelect }: { original: string; taskType: string; value: string; accepted: boolean; selected: Set<number>; onSelect: (index: number) => void }) {
  const choices = candidateUnits(taskType, value)
  return <div className={`candidate-choice-list ${accepted ? 'accepted' : ''}`}>
    {original && <div className="candidate-original"><small>原选区</small><p>{original}</p></div>}
    {choices.map((choice, index) => <label key={`${choice}-${index}`} className={selected.has(index) ? 'selected' : ''}>
      <input type="radio" name="ai-candidate" checked={selected.has(index)} disabled={accepted} onChange={() => onSelect(index)} />
      <span><small>{taskType === 'word_inspiration' ? `灵感 ${index + 1}` : `候选 ${index + 1}`}</small>{choice}</span>
    </label>)}
  </div>
}

function DiffText({ original, value, accepted, selected, onToggle }: { original: string; value: string; accepted: boolean; selected: Set<number>; onToggle: (index: number) => void }) {
  const segments = splitSentenceCandidates(value)
  return <div className={`diff-output ${accepted ? 'accepted' : ''}`}>{original && <div className="diff-comparison"><small>原文 ↔ 候选</small><p>{diffWords(original, value).map((part, index) => <span key={index} className={part.added ? 'diff-added' : part.removed ? 'diff-removed' : ''}>{part.value}</span>)}</p></div>}{segments.map((segment, index) => <label className="diff-segment" key={index}><input type="checkbox" checked={selected.has(index)} disabled={accepted} onChange={() => onToggle(index)} /><span>{diffWords('', segment).map((part, partIndex) => <span key={partIndex} className={part.added ? 'diff-added' : ''}>{part.value}</span>)}</span></label>)}</div>
}

function groupCanonDetections(detections: CanonDetection[]) {
  const groups = new Map<string, { canonicalName: string; entityType: Entity['type']; matchedNames: string[]; occurrenceCount: number; recordCount: number }>()
  for (const detection of detections) {
    const key = `${detection.entityType}:${detection.canonicalName.trim().toLocaleLowerCase('zh-CN')}`
    const current = groups.get(key)
    if (!current) {
      groups.set(key, { canonicalName: detection.canonicalName, entityType: detection.entityType, matchedNames: [...detection.matchedNames], occurrenceCount: detection.occurrenceCount, recordCount: 1 })
      continue
    }
    current.recordCount += 1
    current.occurrenceCount = Math.max(current.occurrenceCount, detection.occurrenceCount)
    current.matchedNames = [...new Set([...current.matchedNames, ...detection.matchedNames])]
  }
  return [...groups.values()]
}

function canonTypeLabel(type: Entity['type']) { return ({ character: '人物', location: '地点', item: '物品', event: '事件' } as const)[type] }
function sourceLabel(source: Revision['provenanceLabel']) { return ({ human: '人工编辑', human_after_ai: 'AI 后人工修订', import: '导入', ai_accepted: 'AI 建议后接受', restore: '恢复', merge: '合并' } as const)[source] }
function revisionGroup(revision: Revision): 'human' | 'ai' | 'system' { return revision.provenanceLabel === 'ai_accepted' ? 'ai' : ['human','human_after_ai'].includes(revision.provenanceLabel) ? 'human' : 'system' }
