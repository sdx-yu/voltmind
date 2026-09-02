export type VoiceRegister = 'literary' | 'balanced' | 'vernacular'
export type VoiceSentence = 'short' | 'mixed' | 'long'
export type VoiceDialogue = 'sparse' | 'balanced' | 'heavy'
export type VoiceAllusion = 'none' | 'light' | 'dense'
export type VoiceSlang = 'avoid' | 'light' | 'ok'
export type StyleFamily = 'natural' | 'restrained' | 'bright' | 'delicate' | 'hard' | 'classical' | 'uncanny' | 'poetic'
export type StyleIntensity = 'light' | 'standard' | 'vivid'
export type VoicePace = 'slow' | 'balanced' | 'fast'
export type VoiceImagery = 'low' | 'medium' | 'high'
export type VoiceDistance = 'close' | 'medium' | 'distant'
export type VoiceInteriority = 'light' | 'medium' | 'deep'
export type SceneIntent = 'advance_conflict' | 'build_pressure' | 'ease_pace' | 'deepen_emotion' | 'build_suspense' | 'strengthen_image' | 'drive_dialogue' | 'stay_objective'
export type VoiceSource = 'scene' | 'previous' | 'project' | 'default'

export interface VoiceKnobs {
  family: StyleFamily
  intensity: StyleIntensity
  pace: VoicePace
  imagery: VoiceImagery
  distance: VoiceDistance
  interiority: VoiceInteriority
  intents: SceneIntent[]
  register: VoiceRegister
  sentence: VoiceSentence
  dialogue: VoiceDialogue
  allusion: VoiceAllusion
  slang: VoiceSlang
  authorNote: string
}

export interface SceneVoiceProfile extends VoiceKnobs {
  nodeId: string
  projectId: string
  inherited: boolean
  source: VoiceSource
  sourceLabel: string
  contract: string
  updatedAt: string | null
}

export const DEFAULT_VOICE_KNOBS: VoiceKnobs = {
  family: 'natural',
  intensity: 'standard',
  pace: 'balanced',
  imagery: 'medium',
  distance: 'medium',
  interiority: 'medium',
  intents: [],
  register: 'balanced',
  sentence: 'mixed',
  dialogue: 'balanced',
  allusion: 'light',
  slang: 'avoid',
  authorNote: '',
}

export interface StyleMetrics {
  characters: number
  sentences: number
  paragraphs: number
  averageSentenceLength: number
  averageParagraphLength: number
  dialogueRatio: number
  shortSentenceRatio: number
  classicalMarkerRatio: number
  sensoryMarkerCount: number
}

export interface StyleAnalysisResult {
  metrics: StyleMetrics
  suggested: VoiceKnobs
  evidence: string[]
  warnings: string[]
}

export interface StyleAnalysisRun extends StyleAnalysisResult {
  id: string
  projectId: string
  sampleIds: string[]
  confirmedAt: string | null
  createdAt: string
}

export interface VoiceConsistencyIssue {
  code: string
  label: string
  detail: string
  evidence: string
}

export interface VoiceConsistencyReport {
  score: number
  metrics: StyleMetrics
  issues: VoiceConsistencyIssue[]
  summary: string
}

export type CharacterDirectness = 'indirect' | 'balanced' | 'direct'
export type CharacterEmotion = 'restrained' | 'balanced' | 'expressive'

export interface CharacterVoiceKnobs {
  register: VoiceRegister
  sentence: VoiceSentence
  directness: CharacterDirectness
  emotion: CharacterEmotion
  signature: string
  avoid: string
}

export interface CharacterVoiceProfile extends CharacterVoiceKnobs {
  entityId: string
  projectId: string
  entityName: string
  updatedAt: string | null
}

export interface VoicePreferenceSummary {
  family: StyleFamily
  taskType: string
  accepted: number
  rejected: number
  undone: number
  updatedAt: string
}

export interface TextSelectionAnchor {
  nodeId: string
  sourceContentHash: string
  startOffset: number
  endOffset: number
  originalText: string
  contextBefore: string
  contextAfter: string
}

export interface EditorAiRequest {
  taskType: 'word_inspiration' | 'style_rewrite'
  selection: TextSelectionAnchor
}

const REGISTER: Record<VoiceRegister, { must: string; mustNot: string }> = {
  literary: { must: '语域偏书面：叙述克制，少解释，少把内心独白说满。', mustNot: '不要用口语聊天腔、网络梗或解说体。' },
  balanced: { must: '语域中正：书面与口语可交替，以场景需要为准。', mustNot: '不要突然从书面跳到段子腔，或反过来。' },
  vernacular: { must: '语域偏白话：句子好读，对白像人在说话。', mustNot: '不要堆砌文言套语或空形容。' },
}

const SENTENCE: Record<VoiceSentence, { must: string; mustNot: string }> = {
  short: { must: '短句为主，一行一事，节奏干脆。', mustNot: '不要用一连串长定语把动作埋进去。' },
  mixed: { must: '短句推进，长句只在收束或转折时用。', mustNot: '不要整段都是同样长度的句子。' },
  long: { must: '句子可以铺开，允许从句和停顿，但每句仍要落在一个意识上。', mustNot: '不要切成电报式碎片。' },
}

const DIALOGUE: Record<VoiceDialogue, { must: string; mustNot: string }> = {
  sparse: { must: '对白少，动作和叙述承担信息。', mustNot: '不要用对白交代设定或复述刚才发生的事。' },
  balanced: { must: '对白与叙述交替，对白只说人物此刻会说的话。', mustNot: '不要让每个人都变成解说员。' },
  heavy: { must: '这场以对白推进，叙述只给必要的眼神、停顿和动作。', mustNot: '不要用大段环境描写冲掉说话的节奏。' },
}

const ALLUSION: Record<VoiceAllusion, { must: string; mustNot: string }> = {
  none: { must: '不用典故、成语堆砌或仿古套话。', mustNot: '不要为了文气而掉书袋。' },
  light: { must: '典故或文言词最多点到即止，且必须服务眼前这一拍。', mustNot: '不要连续用典或解释典故。' },
  dense: { must: '允许较密的文言肌理和互文，但仍要让人物站得住。', mustNot: '不要写成与情节无关的美文练习。' },
}

const SLANG: Record<VoiceSlang, { must: string; mustNot: string }> = {
  avoid: { must: '避开网文套话和万能金句。', mustNot: '不要使用「清光流转」「气机震荡」「嘴角微扬」这类空转形容，除非作者样本里已经这样写。' },
  light: { must: '类型套语极省着用，只在类型读者需要锚点时出现一次。', mustNot: '不要把套语连用当成文采。' },
  ok: { must: '允许该类型读者熟悉的套语，但仍要落到具体感官。', mustNot: '不要只用套语推进叙述。' },
}

const FAMILY: Record<StyleFamily, { label: string; must: string; mustNot: string; defaults: Partial<VoiceKnobs> }> = {
  natural: { label: '自然流畅', must: '表达清楚、顺滑、准确，不过度展示修辞。', mustNot: '不要为了显得有文采而改复杂。', defaults: { register: 'balanced', sentence: 'mixed', pace: 'balanced', imagery: 'medium' } },
  restrained: { label: '冷峻克制', must: '少评价、少解释，让动作、停顿和具体细节承担情绪。', mustNot: '不要直接替人物说出全部感受。', defaults: { register: 'literary', sentence: 'short', pace: 'balanced', imagery: 'low', interiority: 'light' } },
  bright: { label: '明快轻盈', must: '阅读负担轻，句式灵活，反应及时，保持清爽节奏。', mustNot: '不要拖长解释或堆积沉重意象。', defaults: { register: 'vernacular', sentence: 'mixed', pace: 'fast', dialogue: 'heavy', imagery: 'low' } },
  delicate: { label: '细腻抒情', must: '贴近人物感受，捕捉细小变化，让情绪逐层发生。', mustNot: '不要用空泛抒情代替具体感受。', defaults: { register: 'literary', sentence: 'long', pace: 'slow', imagery: 'medium', distance: 'close', interiority: 'deep' } },
  hard: { label: '硬朗利落', must: '动词优先、因果直接、短句推进，动作落到具体结果。', mustNot: '不要用长定语和华丽形容冲淡动作。', defaults: { register: 'balanced', sentence: 'short', pace: 'fast', imagery: 'low', interiority: 'light' } },
  classical: { label: '古雅含蓄', must: '词汇典雅而准确，表达含蓄，保留时代语感。', mustNot: '不要混入现代网络口吻，也不要为了古意连续掉书袋。', defaults: { register: 'literary', sentence: 'mixed', pace: 'balanced', allusion: 'light', slang: 'avoid' } },
  uncanny: { label: '诡谲氛围', must: '用感官错位、信息延迟和不确定细节制造不安。', mustNot: '不要过早解释异常来源或直接宣布恐怖。', defaults: { register: 'literary', sentence: 'mixed', pace: 'slow', imagery: 'high', distance: 'close' } },
  poetic: { label: '诗性意象', must: '让意象、节奏和含蓄比喻互相照应，同时保持可读。', mustNot: '不要写成脱离情节的辞藻陈列。', defaults: { register: 'literary', sentence: 'long', pace: 'slow', imagery: 'high', allusion: 'light' } },
}

const INTENSITY: Record<StyleIntensity, string> = {
  light: '只做轻微文风调整，尽量保留作者原句结构。',
  standard: '清楚体现目标文风，但事实和表达意图保持不变。',
  vivid: '鲜明体现目标文风，允许重组句式，但不得改变事实、视角或时态。',
}

const PACE: Record<VoicePace, string> = { slow: '节奏舒缓，允许停顿和观察。', balanced: '快慢有层次，以当前事件为准。', fast: '推进迅速，减少解释和回顾。' }
const IMAGERY: Record<VoiceImagery, string> = { low: '意象密度低，优先具体动作和事实。', medium: '适量使用服务场景的意象。', high: '用较丰富但彼此关联的意象形成氛围。' }
const DISTANCE: Record<VoiceDistance, string> = { close: '叙事贴近当前人物的感知边界。', medium: '在人物感知和客观叙述之间保持平衡。', distant: '叙事距离较远，减少即时内心独白。' }
const INTERIORITY: Record<VoiceInteriority, string> = { light: '少写直接心理，优先外部表现。', medium: '心理与行动交替，不重复解释。', deep: '深入呈现意识和情绪变化，但不脱离当前刺激。' }
const INTENT: Record<SceneIntent, string> = {
  advance_conflict: '推进冲突', build_pressure: '营造压迫', ease_pace: '放松节奏', deepen_emotion: '深化情感',
  build_suspense: '制造悬念', strengthen_image: '突出画面', drive_dialogue: '强化对白', stay_objective: '保持客观',
}

export function normalizeVoiceKnobs(input: Partial<VoiceKnobs> | null | undefined): VoiceKnobs {
  const value = input ?? {}
  return {
    family: value.family && value.family in FAMILY ? value.family : DEFAULT_VOICE_KNOBS.family,
    intensity: value.intensity && value.intensity in INTENSITY ? value.intensity : DEFAULT_VOICE_KNOBS.intensity,
    pace: value.pace && value.pace in PACE ? value.pace : DEFAULT_VOICE_KNOBS.pace,
    imagery: value.imagery && value.imagery in IMAGERY ? value.imagery : DEFAULT_VOICE_KNOBS.imagery,
    distance: value.distance && value.distance in DISTANCE ? value.distance : DEFAULT_VOICE_KNOBS.distance,
    interiority: value.interiority && value.interiority in INTERIORITY ? value.interiority : DEFAULT_VOICE_KNOBS.interiority,
    intents: Array.isArray(value.intents) ? [...new Set(value.intents.filter((item): item is SceneIntent => item in INTENT))].slice(0, 3) : [],
    register: value.register && value.register in REGISTER ? value.register : DEFAULT_VOICE_KNOBS.register,
    sentence: value.sentence && value.sentence in SENTENCE ? value.sentence : DEFAULT_VOICE_KNOBS.sentence,
    dialogue: value.dialogue && value.dialogue in DIALOGUE ? value.dialogue : DEFAULT_VOICE_KNOBS.dialogue,
    allusion: value.allusion && value.allusion in ALLUSION ? value.allusion : DEFAULT_VOICE_KNOBS.allusion,
    slang: value.slang && value.slang in SLANG ? value.slang : DEFAULT_VOICE_KNOBS.slang,
    authorNote: (value.authorNote ?? '').trim().slice(0, 400),
  }
}

export function compileVoiceContract(knobs: VoiceKnobs, excerpts: string[] = []): string {
  const voice = normalizeVoiceKnobs(knobs)
  const must = [
    `主风格「${FAMILY[voice.family].label}」：${FAMILY[voice.family].must}`,
    INTENSITY[voice.intensity],
    PACE[voice.pace],
    IMAGERY[voice.imagery],
    DISTANCE[voice.distance],
    INTERIORITY[voice.interiority],
    REGISTER[voice.register].must,
    SENTENCE[voice.sentence].must,
    DIALOGUE[voice.dialogue].must,
    ALLUSION[voice.allusion].must,
    SLANG[voice.slang].must,
  ]
  const mustNot = [
    FAMILY[voice.family].mustNot,
    REGISTER[voice.register].mustNot,
    SENTENCE[voice.sentence].mustNot,
    DIALOGUE[voice.dialogue].mustNot,
    ALLUSION[voice.allusion].mustNot,
    SLANG[voice.slang].mustNot,
    '不要新增未经上下文支持的人物、势力、秘密或重大设定。',
    '不要模仿任何在世作者的名字或作品标题。',
  ]
  const samples = excerpts.map((item) => item.trim()).filter(Boolean).slice(0, 2)
  const parts = [
    `当前场景生效的文风：${voiceSummary(voice)}。这是作者确认的文笔约束，优先于你自己的表达习惯。`,
    '',
    '必须做到：',
    ...must.map((item) => `- ${item}`),
    '',
    '禁止：',
    ...mustNot.map((item) => `- ${item}`),
  ]
  if (voice.intents.length) parts.push('', '这一场的阅读意图：', ...voice.intents.map((item) => `- ${INTENT[item]}`))
  if (voice.authorNote) {
    parts.push('', '作者原话（最高优先级，比上面的旋钮更重要）：', `「${voice.authorNote}」`)
  }
  if (samples.length) {
    parts.push('', '像这样写（学节奏、用词和呼吸，不要抄情节或专有名词）：')
    for (const sample of samples) parts.push('---', sample, '---')
  }
  return parts.join('\n')
}

export function voiceSourceLabel(source: VoiceSource): string {
  return ({ scene: '本场单独设置', previous: '旧版场景继承', project: '继承全书文风', default: '全书尚未设置，使用中性默认' })[source]
}

export function voiceKnobLabels() {
  return {
    family: Object.fromEntries(Object.entries(FAMILY).map(([key, value]) => [key, value.label])) as Record<StyleFamily, string>,
    intensity: { light: '轻微', standard: '标准', vivid: '鲜明' },
    pace: { slow: '舒缓', balanced: '平衡', fast: '快速' },
    imagery: { low: '低意象', medium: '适量意象', high: '高意象' },
    distance: { close: '贴近人物', medium: '中等距离', distant: '远观' },
    interiority: { light: '少心理', medium: '心理适中', deep: '心理深入' },
    intents: INTENT,
    register: { literary: '书面克制', balanced: '中正', vernacular: '白话好读' },
    sentence: { short: '短句', mixed: '长短交错', long: '长句铺开' },
    dialogue: { sparse: '对白少', balanced: '对白适中', heavy: '对白推进' },
    allusion: { none: '不用典', light: '轻点', dense: '肌理较密' },
    slang: { avoid: '避开套话', light: '套语极省', ok: '允许类型套语' },
  } as const
}

export function applyStyleFamily(family: StyleFamily, current: VoiceKnobs = DEFAULT_VOICE_KNOBS): VoiceKnobs {
  return normalizeVoiceKnobs({ ...current, family, ...FAMILY[family].defaults })
}

export function voiceSummary(input: VoiceKnobs): string {
  const voice = normalizeVoiceKnobs(input)
  const labels = voiceKnobLabels()
  return [labels.family[voice.family], labels.intensity[voice.intensity], labels.sentence[voice.sentence], labels.pace[voice.pace], labels.imagery[voice.imagery], labels.distance[voice.distance], ...voice.intents.map((item) => labels.intents[item])].join(' · ')
}

export function measureStyle(text: string): StyleMetrics {
  const normalized = text.replace(/\r/g, '').trim()
  const characters = normalized.replace(/\s/g, '').length
  const sentenceParts = normalized.split(/[。！？!?]+/).map((item) => item.trim()).filter(Boolean)
  const paragraphs = normalized.split(/\n+/).map((item) => item.trim()).filter(Boolean)
  const dialogueCharacters = [...normalized.matchAll(/[“「『"]([^”」』"]+)[”」』"]/g)].reduce((total, match) => total + (match[1]?.replace(/\s/g, '').length ?? 0), 0)
  const shortSentences = sentenceParts.filter((item) => item.replace(/\s/g, '').length <= 14).length
  const classicalMarkers = normalized.match(/(?:其|亦|乃|未曾|不曾|却道|便是|只消|何须|莫非|于此|如此|罢了)/g)?.length ?? 0
  const sensoryMarkers = normalized.match(/(?:看见|望见|听见|声音|响|气味|闻到|触|冷|热|疼|苦|甜|光|暗|风|雨)/g)?.length ?? 0
  return {
    characters,
    sentences: sentenceParts.length,
    paragraphs: paragraphs.length,
    averageSentenceLength: sentenceParts.length ? round(characters / sentenceParts.length) : 0,
    averageParagraphLength: paragraphs.length ? round(characters / paragraphs.length) : 0,
    dialogueRatio: characters ? round(dialogueCharacters / characters) : 0,
    shortSentenceRatio: sentenceParts.length ? round(shortSentences / sentenceParts.length) : 0,
    classicalMarkerRatio: characters ? round(classicalMarkers * 10 / characters) : 0,
    sensoryMarkerCount: sensoryMarkers,
  }
}

export function analyzeStyleSamples(samples: Array<{ title: string; content: string; guidance?: string }>): StyleAnalysisResult {
  const source = samples.map((item) => item.content.trim()).filter(Boolean).join('\n')
  const guidance = samples.map((item) => item.guidance ?? '').join(' ')
  const metrics = measureStyle(source)
  let suggested = normalizeVoiceKnobs(null)
  if (metrics.averageSentenceLength && metrics.averageSentenceLength <= 15) suggested.sentence = 'short'
  else if (metrics.averageSentenceLength >= 28) suggested.sentence = 'long'
  if (metrics.dialogueRatio >= 0.32) suggested.dialogue = 'heavy'
  else if (metrics.dialogueRatio <= 0.08) suggested.dialogue = 'sparse'
  suggested.imagery = metrics.sensoryMarkerCount >= Math.max(5, metrics.sentences * .5) ? 'high' : metrics.sensoryMarkerCount <= 1 ? 'low' : 'medium'
  if (metrics.classicalMarkerRatio >= 0.08 || /古雅|古风|文言|武侠|仙侠/.test(guidance)) suggested = applyStyleFamily('classical', suggested)
  else if (/诡谲|惊悚|怪谈|不安|悬疑/.test(guidance)) suggested = applyStyleFamily('uncanny', suggested)
  else if (/诗性|意象|抒情|梦境/.test(guidance) || (suggested.imagery === 'high' && suggested.sentence === 'long')) suggested = applyStyleFamily('poetic', suggested)
  else if (/细腻|情感|内心|心理/.test(guidance) || suggested.sentence === 'long') suggested = applyStyleFamily('delicate', suggested)
  else if (/硬朗|动作|利落|战斗/.test(guidance) || (suggested.sentence === 'short' && suggested.dialogue !== 'heavy')) suggested = applyStyleFamily('hard', suggested)
  else if (/轻松|明快|喜剧|白话/.test(guidance) || suggested.dialogue === 'heavy') suggested = applyStyleFamily('bright', suggested)
  else if (/克制|冷峻|留白|少解释/.test(guidance)) suggested = applyStyleFamily('restrained', suggested)
  suggested = normalizeVoiceKnobs({ ...suggested, authorNote: guidance.trim().slice(0, 400) })
  const evidence = [
    `共分析 ${metrics.characters} 字、${metrics.sentences} 个句子、${metrics.paragraphs} 个段落。`,
    `平均句长 ${metrics.averageSentenceLength} 字，短句比例 ${Math.round(metrics.shortSentenceRatio * 100)}%。`,
    `对白约占 ${Math.round(metrics.dialogueRatio * 100)}%，感官标记 ${metrics.sensoryMarkerCount} 处。`,
    `建议主风格：${voiceKnobLabels().family[suggested.family]}。`,
  ]
  const warnings: string[] = []
  if (metrics.characters < 500) warnings.push('样本少于 500 字，结论只适合作为起点。')
  if (samples.length < 2) warnings.push('只有一份样本，无法判断这是稳定文风还是单场特例。')
  return { metrics, suggested, evidence, warnings }
}

export function evaluateVoiceConsistency(text: string, target: VoiceKnobs): VoiceConsistencyReport {
  const voice = normalizeVoiceKnobs(target)
  const metrics = measureStyle(text)
  const issues: VoiceConsistencyIssue[] = []
  const add = (code: string, label: string, detail: string, evidence: string) => issues.push({ code, label, detail, evidence })
  if (voice.sentence === 'short' && metrics.averageSentenceLength > 24) add('sentence_too_long', '句长偏离', '目标是短句，但当前平均句长明显偏长。', `平均 ${metrics.averageSentenceLength} 字/句`)
  if (voice.sentence === 'long' && metrics.averageSentenceLength > 0 && metrics.averageSentenceLength < 14) add('sentence_too_short', '句长偏离', '目标是长句铺开，但当前句子过于碎短。', `平均 ${metrics.averageSentenceLength} 字/句`)
  if (voice.dialogue === 'heavy' && metrics.dialogueRatio < .18) add('dialogue_too_low', '对白不足', '目标以对白推进，但当前对白占比较低。', `对白约 ${Math.round(metrics.dialogueRatio * 100)}%`)
  if (voice.dialogue === 'sparse' && metrics.dialogueRatio > .35) add('dialogue_too_high', '对白过多', '目标以动作和叙述承担信息，但当前对白占比较高。', `对白约 ${Math.round(metrics.dialogueRatio * 100)}%`)
  if (voice.imagery === 'high' && metrics.sensoryMarkerCount < Math.max(2, metrics.sentences * .2)) add('imagery_too_low', '画面不足', '目标意象密度较高，但当前感官细节偏少。', `感官标记 ${metrics.sensoryMarkerCount} 处`)
  if (metrics.characters < 80) add('too_short', '样本过短', '正文过短，当前一致性结论不稳定。', `${metrics.characters} 字`)
  const score = Math.max(0, 100 - issues.filter((item) => item.code !== 'too_short').length * 18 - (issues.some((item) => item.code === 'too_short') ? 8 : 0))
  return { score, metrics, issues, summary: issues.length ? `发现 ${issues.length} 项可复核的文风偏离。` : '当前正文与文风档的可测特征一致。' }
}

export const DEFAULT_CHARACTER_VOICE: CharacterVoiceKnobs = { register: 'balanced', sentence: 'mixed', directness: 'balanced', emotion: 'balanced', signature: '', avoid: '' }

export function normalizeCharacterVoice(input: Partial<CharacterVoiceKnobs> | null | undefined): CharacterVoiceKnobs {
  const value = input ?? {}
  return {
    register: value.register && value.register in REGISTER ? value.register : 'balanced',
    sentence: value.sentence && value.sentence in SENTENCE ? value.sentence : 'mixed',
    directness: ['indirect', 'balanced', 'direct'].includes(value.directness ?? '') ? value.directness! : 'balanced',
    emotion: ['restrained', 'balanced', 'expressive'].includes(value.emotion ?? '') ? value.emotion! : 'balanced',
    signature: (value.signature ?? '').trim().slice(0, 200),
    avoid: (value.avoid ?? '').trim().slice(0, 200),
  }
}

export function compileCharacterVoiceContract(name: string, input: CharacterVoiceKnobs): string {
  const voice = normalizeCharacterVoice(input)
  const directness = ({ indirect: '倾向绕开直说，用停顿、反问或动作表达。', balanced: '该直说时直说，重要情绪仍保留人物自己的回避。', direct: '表达直接，少绕弯，不用解说腔。' } as const)[voice.directness]
  const emotion = ({ restrained: '情绪外露少，避免大喊大叫和自我剖白。', balanced: '情绪强度随场景变化，不过量。', expressive: '允许明显情绪和更强反应，但不能脱离人物动机。' } as const)[voice.emotion]
  return [`人物对白口吻：${name}`, REGISTER[voice.register].must, SENTENCE[voice.sentence].must, directness, emotion, voice.signature ? `习惯：${voice.signature}` : '', voice.avoid ? `避免：${voice.avoid}` : ''].filter(Boolean).join('\n')
}

function round(value: number) { return Math.round(value * 100) / 100 }
