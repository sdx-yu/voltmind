import { useEffect, useMemo, useRef, useState } from 'react'
import { Gauge, LocateFixed, Pause, Play, Square, Volume2, X } from 'lucide-react'
import type { ManuscriptNode, ReadAloudPreferences } from '../../shared/types'
import { api } from '../lib/api'

type Notice = (type: 'success' | 'error', message: string) => void
type Status = 'idle' | 'loading' | 'speaking' | 'paused' | 'error'
type Segment = { nodeId: string; title: string; text: string; start: number; end: number }
type Position = { nodeId: string; title: string; startOffset: number; endOffset: number; quote: string }

export function ReadAloudPanel({ projectId, nodes, currentNodeId, onClose, onSelectScene, notify }: { projectId: string; nodes: ManuscriptNode[]; currentNodeId: string | null; onClose: () => void; onSelectScene: (id: string) => void; notify: Notice }) {
  const [scope, setScope] = useState<'selection' | 'scene' | 'chapters'>('scene')
  const [selectedChapters, setSelectedChapters] = useState<string[]>([])
  const [preferences, setPreferences] = useState<ReadAloudPreferences>({ projectId, voiceUri: '', rate: 1, pitch: 1, updatedAt: '' })
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [position, setPosition] = useState<Position | null>(null)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const segmentsRef = useRef<Segment[]>([])
  const chapters = nodes.filter((node) => node.type === 'chapter' && !node.deletedAt)
  const scenes = nodes.filter((node) => node.type === 'scene' && !node.deletedAt)
  const currentChapterId = scenes.find((node) => node.id === currentNodeId)?.parentId ?? null
  const engineAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
  const engineLabel = (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ ? '桌面系统语音' : '浏览器系统语音'
  const localVoices = useMemo(() => voices.filter((voice) => voice.localService !== false), [voices])

  useEffect(() => {
    void api.getReadAloudPreferences(projectId).then(setPreferences).catch(() => undefined)
    if (currentChapterId) setSelectedChapters([currentChapterId])
  }, [projectId])
  useEffect(() => {
    if (!engineAvailable) return
    const load = () => setVoices(window.speechSynthesis.getVoices())
    load(); window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load)
  }, [engineAvailable])
  useEffect(() => () => stopSpeech(), [currentNodeId])

  async function start() {
    if (!engineAvailable) { setStatus('error'); notify('error', '当前环境不支持系统本地朗读'); return }
    setStatus('loading')
    try {
      const segments = await buildSegments()
      if (!segments.length || !segments.some((item) => item.text.trim())) throw new Error(scope === 'selection' ? '请先在正文中选择要朗读的文字' : '所选范围没有可朗读正文')
      const text = segments.map((item) => item.text).join('\n\n')
      let offset = 0
      segmentsRef.current = segments.map((item) => { const start = offset; const end = start + item.text.length; offset = end + 2; return { ...item, start, end } })
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'zh-CN'; utterance.rate = preferences.rate; utterance.pitch = preferences.pitch
      const voice = localVoices.find((item) => item.voiceURI === preferences.voiceUri)
      if (voice) utterance.voice = voice
      utterance.onstart = () => setStatus('speaking')
      utterance.onboundary = (event) => updatePosition(event.charIndex, Math.max(1, event.charLength || 1), text)
      utterance.onend = () => { setStatus('idle'); utteranceRef.current = null }
      utterance.onerror = (event) => { if (event.error !== 'canceled' && event.error !== 'interrupted') { setStatus('error'); notify('error', `本地朗读失败：${event.error}`) } }
      utteranceRef.current = utterance
      updatePosition(0, Math.min(24, text.length), text)
      await api.saveReadAloudPreferences(projectId, { voiceUri: preferences.voiceUri, rate: preferences.rate, pitch: preferences.pitch })
      window.speechSynthesis.speak(utterance)
    } catch (error) { setStatus('error'); notify('error', error instanceof Error ? error.message : '朗读启动失败') }
  }

  async function buildSegments(): Promise<Array<Omit<Segment, 'start' | 'end'>>> {
    if (scope === 'selection') {
      const text = window.getSelection()?.toString().trim() ?? ''
      return currentNodeId && text ? [{ nodeId: currentNodeId, title: scenes.find((item) => item.id === currentNodeId)?.title ?? '当前选区', text }] : []
    }
    if (scope === 'scene') {
      if (!currentNodeId) return []
      const document = await api.getScene(currentNodeId)
      return [{ nodeId: currentNodeId, title: scenes.find((item) => item.id === currentNodeId)?.title ?? '当前场景', text: document.plainText }]
    }
    const chapterSet = new Set(selectedChapters)
    const ordered = scenes.filter((scene) => scene.parentId && chapterSet.has(scene.parentId)).sort((a, b) => a.sortKey - b.sortKey)
    return Promise.all(ordered.map(async (scene) => ({ nodeId: scene.id, title: scene.title, text: (await api.getScene(scene.id)).plainText })))
  }

  function updatePosition(charIndex: number, charLength: number, fullText: string) {
    const segment = segmentsRef.current.find((item) => charIndex >= item.start && charIndex <= item.end) ?? segmentsRef.current[0]
    if (!segment) return
    const local = Math.max(0, charIndex - segment.start)
    const sentence = sentenceRange(segment.text, local, charLength)
    const next = { nodeId: segment.nodeId, title: segment.title, startOffset: sentence.start, endOffset: sentence.end, quote: sentence.quote }
    setPosition(next)
    if (segment.nodeId === currentNodeId) window.dispatchEvent(new CustomEvent('bbd:read-position', { detail: next }))
    void fullText
  }

  function pauseResume() {
    if (status === 'speaking') { window.speechSynthesis.pause(); setStatus('paused') }
    else if (status === 'paused') { window.speechSynthesis.resume(); setStatus('speaking') }
  }
  function stopSpeech() { if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel(); utteranceRef.current = null; setStatus('idle'); setPosition(null) }
  function close() { stopSpeech(); onClose() }
  function updatePreferences(patch: Partial<ReadAloudPreferences>) {
    setPreferences((current) => ({ ...current, ...patch }))
    void api.saveReadAloudPreferences(projectId, patch).catch((error) => notify('error', error instanceof Error ? error.message : '朗读偏好保存失败'))
  }
  function locate() { if (!position) return; if (position.nodeId !== currentNodeId) onSelectScene(position.nodeId); window.setTimeout(() => window.dispatchEvent(new CustomEvent('bbd:read-position', { detail: position })), 120) }

  return <aside className="read-aloud-panel" aria-label="本地朗读控制"><header><div><Volume2 size={18}/><span><strong>本地朗读</strong><small>{engineAvailable ? `${engineLabel} · 正文不上传` : '当前环境不可用'}</small></span></div><button className="icon-button" aria-label="关闭朗读" onClick={close}><X size={16}/></button></header>
    <div className="read-scope"><button className={scope === 'selection' ? 'active' : ''} onClick={() => setScope('selection')}>当前选区</button><button className={scope === 'scene' ? 'active' : ''} onClick={() => setScope('scene')}>当前场景</button><button className={scope === 'chapters' ? 'active' : ''} onClick={() => setScope('chapters')}>章节范围</button></div>
    {scope === 'chapters' && <div className="read-chapters"><small>选择章节</small>{chapters.map((chapter) => <label key={chapter.id}><input type="checkbox" checked={selectedChapters.includes(chapter.id)} onChange={(event) => setSelectedChapters((current) => event.target.checked ? [...current, chapter.id] : current.filter((id) => id !== chapter.id))}/>{chapter.title}</label>)}</div>}
    <div className="read-settings"><label><Gauge size={14}/>语速 {preferences.rate.toFixed(1)}×<input aria-label="朗读语速" type="range" min="0.5" max="2" step="0.1" value={preferences.rate} onChange={(event) => void updatePreferences({ rate: Number(event.target.value) })}/></label><label>系统声音<select aria-label="朗读声音" value={preferences.voiceUri} onChange={(event) => void updatePreferences({ voiceUri: event.target.value })}><option value="">系统默认</option>{localVoices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}</select></label></div>
    <div className={`read-position read-${status}`} aria-live="polite"><small>{statusLabel(status)}{position ? ` · ${position.title}` : ''}</small><p>{position?.quote || '开始后，这里会显示正在朗读的正文位置。'}</p>{position && <button className="button ghost compact" onClick={locate}><LocateFixed size={13}/>定位正文</button>}</div>
    <footer><button className="button primary" disabled={!engineAvailable || status === 'loading'} onClick={() => void start()}><Play size={15}/>{status === 'loading' ? '正在准备…' : status === 'paused' || status === 'speaking' ? '重新开始' : '开始朗读'}</button><button className="button secondary" disabled={!['speaking','paused'].includes(status)} onClick={pauseResume}>{status === 'paused' ? <Play size={15}/> : <Pause size={15}/>}<span>{status === 'paused' ? '继续' : '暂停'}</span></button><button className="button ghost" disabled={!['speaking','paused','loading'].includes(status)} onClick={stopSpeech}><Square size={14}/>停止</button></footer>
  </aside>
}

function sentenceRange(text: string, offset: number, charLength: number) {
  const before = Math.max(text.lastIndexOf('。', Math.max(0, offset - 1)), text.lastIndexOf('！', Math.max(0, offset - 1)), text.lastIndexOf('？', Math.max(0, offset - 1)), text.lastIndexOf('\n', Math.max(0, offset - 1))) + 1
  const endings = ['。','！','？','\n'].map((mark) => text.indexOf(mark, offset + charLength)).filter((index) => index >= 0)
  const end = endings.length ? Math.min(...endings) + 1 : Math.min(text.length, Math.max(offset + charLength, offset + 40))
  return { start: before, end, quote: text.slice(before, end).trim() }
}

function statusLabel(status: Status) { return ({ idle: '未开始', loading: '正在准备', speaking: '正在朗读', paused: '已暂停', error: '需要处理' } as const)[status] }
