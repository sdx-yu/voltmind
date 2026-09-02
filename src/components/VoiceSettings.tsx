import { useEffect, useState } from 'react'
import { ChevronDown, PenLine, RotateCcw } from 'lucide-react'
import type { CharacterVoiceKnobs, CharacterVoiceProfile, Entity, SceneVoiceProfile, VoiceKnobs, VoicePreferenceSummary } from '../../shared/types'
import { applyStyleFamily, compileVoiceContract, voiceKnobLabels } from '../../shared/voice'
import { api } from '../lib/api'
import { Popover, SelectField, TextareaField, TextField } from '../ui'

type Notify = (type: 'success' | 'error', message: string) => void

function VoiceKnobFields({ profile, scope, onPatch, onDraft }: { profile: SceneVoiceProfile; scope: 'book' | 'scene'; onPatch: (patch: Partial<VoiceKnobs>) => Promise<void>; onDraft: (patch: Partial<VoiceKnobs>) => void }) {
  const labels = voiceKnobLabels()
  const preview = compileVoiceContract(profile).split('\n').filter((line) => line.startsWith('- ')).slice(0, 4)
  async function chooseFamily(value: VoiceKnobs['family']) { await onPatch(applyStyleFamily(value, profile)) }
  async function toggleIntent(value: VoiceKnobs['intents'][number]) {
    const intents = profile.intents.includes(value) ? profile.intents.filter((item) => item !== value) : [...profile.intents, value].slice(-3)
    await onPatch({ intents })
  }

  return <div className="voice-editor-fields">
    <SelectField label="主风格" value={profile.family} onValueChange={(value) => void chooseFamily(value as VoiceKnobs['family'])}>{Object.entries(labels.family).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>
    <div className="voice-primary-grid"><SelectField label="改写幅度" description="控制 AI 对措辞和句式的改动程度" value={profile.intensity} onValueChange={(value) => void onPatch({ intensity: value as VoiceKnobs['intensity'] })}>{Object.entries(labels.intensity).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="节奏" value={profile.pace} onValueChange={(value) => void onPatch({ pace: value as VoiceKnobs['pace'] })}>{Object.entries(labels.pace).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField></div>
    {scope === 'scene' && <fieldset className="voice-intents"><legend>场景意图（最多 3 项，仅本场生效）</legend>{Object.entries(labels.intents).map(([value, label]) => <button type="button" key={value} className={profile.intents.includes(value as VoiceKnobs['intents'][number]) ? 'active' : ''} onClick={() => void toggleIntent(value as VoiceKnobs['intents'][number])}>{label}</button>)}</fieldset>}
    <details className="voice-advanced"><summary>表达维度</summary><div className="form-stack"><SelectField label="句长" value={profile.sentence} onValueChange={(value) => void onPatch({ sentence: value as VoiceKnobs['sentence'] })}>{Object.entries(labels.sentence).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="叙事距离" value={profile.distance} onValueChange={(value) => void onPatch({ distance: value as VoiceKnobs['distance'] })}>{Object.entries(labels.distance).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="心理描写" value={profile.interiority} onValueChange={(value) => void onPatch({ interiority: value as VoiceKnobs['interiority'] })}>{Object.entries(labels.interiority).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="意象密度" value={profile.imagery} onValueChange={(value) => void onPatch({ imagery: value as VoiceKnobs['imagery'] })}>{Object.entries(labels.imagery).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="语域" value={profile.register} onValueChange={(value) => void onPatch({ register: value as VoiceKnobs['register'] })}>{Object.entries(labels.register).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="对白" value={profile.dialogue} onValueChange={(value) => void onPatch({ dialogue: value as VoiceKnobs['dialogue'] })}>{Object.entries(labels.dialogue).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="用典" value={profile.allusion} onValueChange={(value) => void onPatch({ allusion: value as VoiceKnobs['allusion'] })}>{Object.entries(labels.allusion).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="套话" value={profile.slang} onValueChange={(value) => void onPatch({ slang: value as VoiceKnobs['slang'] })}>{Object.entries(labels.slang).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField></div></details>
    <TextareaField label={scope === 'book' ? '全书文风说明（最优先）' : '本场文风说明（最优先）'} value={profile.authorNote} onChange={(event) => onDraft({ authorNote: event.target.value })} onBlur={(event) => void onPatch({ authorNote: event.target.value })} rows={3} placeholder={scope === 'book' ? '例如：整体克制、少解释设定，以具体动作承载情绪。' : '例如：这场要冷、慢，不解释法术，沈砚少说话。'} />
    <div className="voice-contract-preview" aria-label="模型将读到的文风约束">{preview.map((line) => <small key={line}>{line.slice(2)}</small>)}</div>
  </div>
}

export function SceneVoiceControl({ projectId, nodeId, notify, onOpenBookSettings, onChanged }: { projectId: string; nodeId: string; notify: Notify; onOpenBookSettings?: () => void; onChanged?: () => void }) {
  const [profile, setProfile] = useState<SceneVoiceProfile | null>(null)
  const [open, setOpen] = useState(false)
  const labels = voiceKnobLabels()
  async function load() {
    try { setProfile(await api.getVoiceProfile(projectId, nodeId)) }
    catch (error) { notify('error', error instanceof Error ? error.message : '本场文风加载失败') }
  }
  useEffect(() => {
    const refresh = () => { void load() }
    void load(); window.addEventListener('bbd:project-voice-changed', refresh)
    return () => window.removeEventListener('bbd:project-voice-changed', refresh)
  }, [projectId, nodeId])
  async function patch(knobs: Partial<VoiceKnobs>) {
    try { setProfile(await api.saveVoiceProfile(projectId, nodeId, knobs)); onChanged?.() }
    catch (error) { notify('error', error instanceof Error ? error.message : '本场文风保存失败') }
  }
  async function reset() {
    try { setProfile(await api.resetVoiceProfile(projectId, nodeId)); onChanged?.(); notify('success', '本场已恢复继承全书文风') }
    catch (error) { notify('error', error instanceof Error ? error.message : '恢复全书文风失败') }
  }
  if (!profile) return <div className="scene-voice-loading">正在读取文风…</div>
  const scopeLabel = profile.inherited ? '继承全书' : '本场覆盖'
  const summary = `${scopeLabel} · ${labels.family[profile.family]} · ${labels.intensity[profile.intensity]} · ${labels.pace[profile.pace]}`
  return <Popover align="start" open={open} onOpenChange={setOpen} trigger={<button type="button" className={`scene-voice-trigger${profile.inherited ? '' : ' is-override'}`} aria-label={`文风：${summary}`}><span><PenLine size={14}/><strong>文风</strong></span><span>{summary}</span><ChevronDown size={14}/></button>}>
    <div className="scene-voice-popover">
      <header><div><strong>本场文风</strong><span>{profile.inherited ? '默认跟随全书；修改任一项后仅覆盖本场。' : '当前场景使用单独设置，不受全书后续修改影响。'}</span></div>{!profile.inherited && <button type="button" className="voice-reset" onClick={() => void reset()}><RotateCcw size={13}/>恢复全书</button>}</header>
      <VoiceKnobFields profile={profile} scope="scene" onPatch={patch} onDraft={(knobs) => setProfile({ ...profile, ...knobs })}/>
      {onOpenBookSettings && <button type="button" className="button ghost full voice-book-link" onClick={() => { setOpen(false); onOpenBookSettings() }}>编辑全书基准文风</button>}
    </div>
  </Popover>
}

export function ProjectVoiceSettings({ projectId, notify }: { projectId: string; notify: Notify }) {
  const [profile, setProfile] = useState<SceneVoiceProfile | null>(null)
  const [entities, setEntities] = useState<Entity[]>([])
  const [preferences, setPreferences] = useState<VoicePreferenceSummary[]>([])
  const [characterId, setCharacterId] = useState('')
  const [characterVoice, setCharacterVoice] = useState<CharacterVoiceProfile | null>(null)
  const labels = voiceKnobLabels()
  useEffect(() => {
    void Promise.all([api.getProjectVoiceProfile(projectId), api.listEntities(projectId), api.listVoicePreferences(projectId)])
      .then(([nextProfile, nextEntities, nextPreferences]) => { setProfile(nextProfile); setEntities(nextEntities); setPreferences(nextPreferences) })
      .catch((error) => notify('error', error instanceof Error ? error.message : '全书文风加载失败'))
  }, [projectId])
  async function patch(knobs: Partial<VoiceKnobs>) {
    if (!profile) return
    try {
      const next = await api.saveProjectVoiceDefault(projectId, { ...profile, ...knobs, intents: [] })
      setProfile(next); window.dispatchEvent(new Event('bbd:project-voice-changed'))
    } catch (error) { notify('error', error instanceof Error ? error.message : '全书文风保存失败') }
  }
  async function loadCharacter(value: string) {
    setCharacterId(value)
    if (!value) { setCharacterVoice(null); return }
    try { setCharacterVoice(await api.getCharacterVoice(projectId, value)) }
    catch (error) { notify('error', error instanceof Error ? error.message : '人物口吻加载失败') }
  }
  async function patchCharacter(value: Partial<CharacterVoiceKnobs>) {
    if (!characterId) return
    try { setCharacterVoice(await api.saveCharacterVoice(projectId, characterId, value)) }
    catch (error) { notify('error', error instanceof Error ? error.message : '人物口吻保存失败') }
  }
  async function clearPreferences() {
    try { await api.clearVoicePreferences(projectId); setPreferences([]); notify('success', '本机文风偏好统计已清空') }
    catch (error) { notify('error', error instanceof Error ? error.message : '偏好统计清理失败') }
  }
  const taskLabels: Record<string, string> = { brainstorm: '脑暴', continue: '续写', rewrite: '改写', cold_read: '冷读', idea_to_prose: '思路成文', style_rewrite: '按文风改写', word_inspiration: '词语灵感' }
  return <>
    <span className="eyebrow">写作偏好</span><h3>全书基准文风</h3><p className="muted">通常在开始写作前设置一次。没有单独覆盖的场景会自动继承；场景意图仍只在当前场景设置。</p>
    {profile ? <div className="project-voice-settings"><div className="project-voice-status"><PenLine size={17}/><div><strong>{profile.source === 'default' ? '尚未设置，使用中性默认' : `${labels.family[profile.family]} · ${labels.intensity[profile.intensity]} · ${labels.pace[profile.pace]}`}</strong><span>修改后自动保存到本书，不会影响其他作品。</span></div></div><VoiceKnobFields profile={profile} scope="book" onPatch={patch} onDraft={(knobs) => setProfile({ ...profile, ...knobs })}/></div> : <p className="muted">正在读取全书文风…</p>}
    <details className="settings-voice-section"><summary>人物对白口吻</summary><div className="form-stack"><SelectField label="人物" value={characterId} onValueChange={(value) => void loadCharacter(value)}><option value="">选择人物…</option>{entities.filter((entity) => entity.type === 'character').map((entity) => <option key={entity.id} value={entity.id}>{entity.canonicalName}</option>)}</SelectField>{characterVoice && <><SelectField label="口吻语域" value={characterVoice.register} onValueChange={(value) => void patchCharacter({ register: value as CharacterVoiceKnobs['register'] })}>{Object.entries(labels.register).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="句式习惯" value={characterVoice.sentence} onValueChange={(value) => void patchCharacter({ sentence: value as CharacterVoiceKnobs['sentence'] })}>{Object.entries(labels.sentence).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="表达直接度" value={characterVoice.directness} onValueChange={(value) => void patchCharacter({ directness: value as CharacterVoiceKnobs['directness'] })}><option value="indirect">含蓄回避</option><option value="balanced">适中</option><option value="direct">直接</option></SelectField><SelectField label="情绪外露" value={characterVoice.emotion} onValueChange={(value) => void patchCharacter({ emotion: value as CharacterVoiceKnobs['emotion'] })}><option value="restrained">克制</option><option value="balanced">适中</option><option value="expressive">外放</option></SelectField><TextField label="说话习惯" value={characterVoice.signature} onChange={(event) => setCharacterVoice({ ...characterVoice, signature: event.target.value })} onBlur={(event) => void patchCharacter({ signature: event.target.value })} placeholder="例如：回答前先反问，不说完整句"/><TextField label="避免" value={characterVoice.avoid} onChange={(event) => setCharacterVoice({ ...characterVoice, avoid: event.target.value })} onBlur={(event) => void patchCharacter({ avoid: event.target.value })} placeholder="例如：不说网络词，不解释动机"/></>}</div></details>
    {preferences.length > 0 && <details className="settings-voice-section"><summary>本机采用偏好 · {preferences.reduce((total, item) => total + item.accepted, 0)} 次接受</summary><p>只统计接受、丢弃和撤销次数，不保存候选正文，也不会自动改变文风。</p><div className="voice-preference-list">{preferences.slice(0, 5).map((item) => <div key={`${item.family}-${item.taskType}`}><span>{labels.family[item.family]} · {taskLabels[item.taskType] ?? item.taskType}</span><small>接受 {item.accepted} · 丢弃 {item.rejected} · 撤销 {item.undone}</small></div>)}</div><button type="button" className="button ghost compact" onClick={() => void clearPreferences()}>清空偏好统计</button></details>}
  </>
}
