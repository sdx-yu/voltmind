import { Maximize2, Minimize2 } from 'lucide-react'
import { Badge, IconButton } from '../ui'

export type EditorSaveState = 'loading' | 'dirty' | 'saving' | 'saved' | 'error'

export function SaveSyncStatus({ state }: { state: EditorSaveState }) {
  const label = { loading: '正在读取', dirty: '有未保存修改', saving: '正在保存', saved: '已保存到本机', error: '保存失败' }[state]
  return <span className={`ui-save-status ui-save-status-${state}`} role="status" aria-live="polite">{label}</span>
}

export function SceneHeader({ title, status, words, saveState, focusMode, onFocusMode }: { title: string; status: string; words: number; saveState: EditorSaveState; focusMode: boolean; onFocusMode: (value: boolean) => void }) {
  return <header className="ui-scene-header">
    <div className="ui-scene-header-copy"><Badge tone="neutral">{status}</Badge><h1>{title}</h1></div>
    <div className="ui-scene-header-meta"><span>{words.toLocaleString('zh-CN')} 字</span><SaveSyncStatus state={saveState} /><IconButton size="small" onClick={() => onFocusMode(!focusMode)} label={focusMode ? '退出专注模式' : '进入专注模式'}>{focusMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</IconButton></div>
  </header>
}
