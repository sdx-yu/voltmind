import { useEffect, useState } from 'react'
import { Replace, RotateCcw, Search } from 'lucide-react'
import type { ReplaceBatch, ReplaceMatch, ReplaceScope, SearchResult } from '../../shared/types'
import { api } from '../lib/api'
import { Modal } from './Modal'

export function SearchModal({ projectId, initialMode = 'search', onClose, onSelect, onChanged, notify }: { projectId: string; initialMode?: 'search' | 'replace'; onClose: () => void; onSelect: (id: string) => void; onChanged: () => Promise<void>; notify: (type: 'success' | 'error', message: string) => void }) {
  const [mode, setMode] = useState<'search' | 'replace'>(initialMode)
  const [query, setQuery] = useState(''); const [replacement, setReplacement] = useState('')
  const [results, setResults] = useState<SearchResult[]>([]); const [matches, setMatches] = useState<ReplaceMatch[]>([])
  const [scopes, setScopes] = useState<ReplaceScope[]>(['body']); const [loading, setLoading] = useState(false); const [lastBatch, setLastBatch] = useState<ReplaceBatch | null>(null)
  useEffect(() => { if (mode !== 'search') return; const timer = setTimeout(() => { if (!query.trim()) { setResults([]); return } setLoading(true); void api.search(projectId, query).then(setResults).finally(() => setLoading(false)) }, 250); return () => clearTimeout(timer) }, [query, projectId, mode])
  useEffect(() => { setMatches([]); setLastBatch(null) }, [query, replacement, scopes])
  function toggleScope(scope: ReplaceScope) { setScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]) }
  async function preview() { setLoading(true); try { setMatches(await api.previewReplace(projectId, query, replacement, scopes)) } catch (error) { notify('error', error instanceof Error ? error.message : '预览失败') } finally { setLoading(false) } }
  async function apply() { setLoading(true); try { const batch = await api.applyReplace(projectId, query, replacement, scopes); setLastBatch(batch); await onChanged(); notify('success', `已原子替换 ${batch.changes.reduce((sum, item) => sum + item.occurrences, 0)} 处，可整体撤销`) } catch (error) { notify('error', error instanceof Error ? error.message : '替换失败') } finally { setLoading(false) } }
  async function undo() { if (!lastBatch) return; setLoading(true); try { await api.undoReplace(lastBatch.id); setLastBatch(null); await onChanged(); setMatches(await api.previewReplace(projectId, query, replacement, scopes)); notify('success', '本次全局替换已整体撤销') } catch (error) { notify('error', error instanceof Error ? error.message : '撤销失败') } finally { setLoading(false) } }
  return <Modal title="全局搜索与替换" onClose={onClose} wide><div className="search-tabs"><button className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}><Search size={15} />搜索</button><button className={mode === 'replace' ? 'active' : ''} onClick={() => setMode('replace')}><Replace size={15} />替换</button></div>
    <div className="search-box"><Search size={19} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={mode === 'search' ? '搜索正文中的一句话…' : '查找内容'} /></div>
    {mode === 'replace' && <><div className="search-box replace-input"><Replace size={19} /><input value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder="替换为（可留空以删除）" /></div><div className="scope-row">{([['body','正文'],['title','标题'],['canon','正典']] as const).map(([value,label]) => <label key={value}><input type="checkbox" checked={scopes.includes(value)} onChange={() => toggleScope(value)} />{label}</label>)}<span className="toolbar-spacer" /><button className="button secondary compact" disabled={!query || !scopes.length || loading} onClick={() => void preview()}>预览命中</button></div></>}
    <div className="search-results">{loading ? <p className="muted">正在处理…</p> : mode === 'search' ? (results.length ? results.map((result) => <button key={result.nodeId} onClick={() => { onSelect(result.nodeId); onClose() }}><strong>{result.title}</strong><p dangerouslySetInnerHTML={{ __html: result.snippet }} /></button>) : query ? <p className="muted">没有找到匹配内容。</p> : <p className="muted">支持中文全文搜索，结果会定位到场景。</p>) : (matches.length ? matches.map((match, index) => <article className="replace-match" key={`${match.objectId}-${match.field}-${index}`}><header><strong>{match.title}</strong><small>{scopeLabel(match.objectType)} · {match.occurrences} 处</small></header><div><del>{clip(match.before)}</del><span>→</span><ins>{clip(match.after)}</ins></div></article>) : <p className="muted">设置范围后先预览；确认时会在一个事务中完成。</p>)}</div>
    {mode === 'replace' && matches.length > 0 && <div className="modal-actions">{lastBatch ? <button className="button secondary" disabled={loading} onClick={() => void undo()}><RotateCcw size={15} />整体撤销本次替换</button> : <button className="button primary" disabled={loading} onClick={() => void apply()}>确认替换 {matches.reduce((sum, item) => sum + item.occurrences, 0)} 处</button>}</div>}
  </Modal>
}

function clip(value: string) { return value.length > 100 ? `${value.slice(0, 100)}…` : value }
function scopeLabel(value: ReplaceMatch['objectType']) { return value === 'scene' ? '正文' : value === 'node' ? '标题' : '正典' }
