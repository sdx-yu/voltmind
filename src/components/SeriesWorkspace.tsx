import { useEffect, useState } from 'react'
import { BookCopy, Check, Layers3, Plus, Trash2, UsersRound } from 'lucide-react'
import type { EntityType, PrivacyLevel, Project, Series, SeriesCanonEntry, StyleSample } from '../../shared/types'
import { api } from '../lib/api'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState } from './EmptyState'
import { Modal } from './Modal'

type Notice = (type: 'success' | 'error', message: string) => void

export function SeriesWorkspace({ projectId, notify }: { projectId: string; notify: Notice }) {
  const [series, setSeries] = useState<Series | null>(null)
  const [allSeries, setAllSeries] = useState<Series[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [entries, setEntries] = useState<SeriesCanonEntry[]>([])
  const [samples, setSamples] = useState<StyleSample[]>([])
  const [tab, setTab] = useState<'canon' | 'style'>('canon')
  const [creatingSeries, setCreatingSeries] = useState(false)
  const [creatingCanon, setCreatingCanon] = useState(false)
  const [creatingSample, setCreatingSample] = useState(false)
  const [memberProjectId, setMemberProjectId] = useState('')
  const [confirmLeave, setConfirmLeave] = useState(false)

  async function load() {
    const [current, seriesList, projectList] = await Promise.all([api.getProjectSeries(projectId), api.listSeries(), api.listProjects()])
    setSeries(current); setAllSeries(seriesList); setProjects(projectList)
    if (current) {
      const [canon, style] = await Promise.all([api.listSeriesCanon(projectId), api.listStyleSamples(projectId)])
      setEntries(canon); setSamples(style)
    } else { setEntries([]); setSamples([]) }
  }
  useEffect(() => { void load().catch((error) => notify('error', error instanceof Error ? error.message : '系列数据加载失败')) }, [projectId])

  async function join(seriesId: string) {
    try { await api.addProjectToSeries(seriesId, projectId, projectId); await load(); notify('success', '本书已加入系列') }
    catch (error) { notify('error', error instanceof Error ? error.message : '加入失败') }
  }
  async function addMember() {
    if (!series || !memberProjectId) return
    try { await api.addProjectToSeries(series.id, memberProjectId, projectId); setMemberProjectId(''); await load(); notify('success', '作品已加入系列') }
    catch (error) { notify('error', error instanceof Error ? error.message : '加入失败') }
  }
  async function leave() {
    if (!series) return
    try { await api.removeProjectFromSeries(series.id, projectId, projectId); setConfirmLeave(false); await load(); notify('success', '本书已移出系列，书稿未受影响') }
    catch (error) { notify('error', error instanceof Error ? error.message : '移出失败') }
  }

  if (!series) return <div className="series-page">
    <header className="series-hero"><div><span className="eyebrow">系列共享</span><h2>让多部作品共用同一套世界事实</h2><p>共享内容有清晰来源；本书覆盖不会改写系列基线。</p></div><button className="button primary" onClick={() => setCreatingSeries(true)}><Plus size={15}/>创建系列</button></header>
    {allSeries.length ? <section className="canon-card"><header><div><h3>加入已有系列</h3><p>重新加入也会恢复本书原有的覆盖和样本偏好。</p></div></header><div className="series-join-list">{allSeries.map((item) => <button key={item.id} onClick={() => void join(item.id)}><Layers3 size={18}/><span><strong>{item.name}</strong><small>{item.description || `${item.members.length} 部作品`}</small></span><span>加入</span></button>)}</div></section> : <EmptyState title="还没有系列" description="建立系列后，可以把其他作品加入并共享地点、人物、规则和风格样本。" />}
    {creatingSeries && <CreateSeriesModal projectId={projectId} onClose={() => setCreatingSeries(false)} onCreated={async () => { setCreatingSeries(false); await load() }} notify={notify}/>} 
  </div>

  const unavailable = new Set(allSeries.flatMap((item) => item.members.map((member) => member.projectId)))
  const addableProjects = projects.filter((project) => !unavailable.has(project.id))
  return <div className="series-page">
    <header className="series-hero"><div><span className="eyebrow">系列共享 · {series.members.length} 部作品</span><h2>{series.name}</h2><p>{series.description || '系列简介尚未填写'}</p></div><button className="button ghost compact" onClick={() => setConfirmLeave(true)}>移出本书</button></header>
    <section className="series-member-bar"><UsersRound size={17}/><div>{series.members.map((member) => <span key={member.projectId} className={member.projectId === projectId ? 'current' : ''}>{member.title}{member.projectId === projectId ? '（本书）' : ''}</span>)}</div>{addableProjects.length > 0 && <><select aria-label="选择要加入系列的作品" value={memberProjectId} onChange={(event) => setMemberProjectId(event.target.value)}><option value="">添加另一部作品…</option>{addableProjects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select><button className="button secondary compact" disabled={!memberProjectId} onClick={() => void addMember()}>加入</button></>}</section>
    <nav className="series-tabs"><button className={tab === 'canon' ? 'active' : ''} onClick={() => setTab('canon')}><BookCopy size={15}/>共享正典</button><button className={tab === 'style' ? 'active' : ''} onClick={() => setTab('style')}><Layers3 size={15}/>风格样本</button></nav>
    {tab === 'canon' ? <section className="series-section"><header><div><h3>共享事实基线</h3><p>每本书都能读取；需要差异时建立本书覆盖。</p></div><button className="button primary compact" onClick={() => setCreatingCanon(true)}><Plus size={14}/>新增共享项</button></header>{entries.length ? <div className="series-card-grid">{entries.map((entry) => <SeriesCanonCard key={entry.id} entry={entry} projectId={projectId} onChanged={load} notify={notify}/>)}</div> : <EmptyState title="暂无共享正典" description="可以先建立一个跨作品稳定存在的人物、地点、物品或事件。"/>}</section> : <section className="series-section"><header><div><h3>作者授权的风格样本</h3><p>逐项显示来源、用途与开关，AI 不会在后台偷偷学习。</p></div><button className="button primary compact" onClick={() => setCreatingSample(true)}><Plus size={14}/>新增样本</button></header>{samples.length ? <div className="style-sample-list">{samples.map((sample) => <StyleSampleCard key={sample.id} sample={sample} projectId={projectId} onChanged={load} notify={notify}/>)}</div> : <EmptyState title="暂无风格样本" description="粘贴你有权使用的短样本，并写明希望 AI 参考什么。"/>}</section>}
    {creatingCanon && <CreateCanonModal seriesId={series.id} projectId={projectId} onClose={() => setCreatingCanon(false)} onCreated={async () => { setCreatingCanon(false); await load() }} notify={notify}/>} 
    {creatingSample && <CreateStyleSampleModal seriesId={series.id} projectId={projectId} onClose={() => setCreatingSample(false)} onCreated={async () => { setCreatingSample(false); await load() }} notify={notify}/>} 
    {confirmLeave && <ConfirmDialog title="移出本书" message="将本书移出系列？书稿与系列正典都不会删除，本书覆盖将保留以便重新加入。" confirmLabel="移出本书" danger onConfirm={() => void leave()} onClose={() => setConfirmLeave(false)} />}
  </div>
}

function CreateSeriesModal({ projectId, onClose, onCreated, notify }: { projectId: string; onClose: () => void; onCreated: () => Promise<void>; notify: Notice }) {
  const [name, setName] = useState(''); const [description, setDescription] = useState('')
  async function submit() { try { await api.createSeries(projectId, name, description); notify('success', '系列已创建，本书已加入'); await onCreated() } catch (error) { notify('error', error instanceof Error ? error.message : '创建失败') } }
  return <Modal title="创建系列" onClose={onClose}><div className="form-stack"><label>系列名称<input aria-label="系列名称" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：雾港纪事"/></label><label>系列简介<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="说明共同世界、时代或主题"/></label><div className="modal-actions"><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!name.trim()} onClick={() => void submit()}>创建并加入本书</button></div></div></Modal>
}

function CreateCanonModal({ seriesId, projectId, onClose, onCreated, notify }: { seriesId: string; projectId: string; onClose: () => void; onCreated: () => Promise<void>; notify: Notice }) {
  const [type, setType] = useState<EntityType>('location'); const [name, setName] = useState(''); const [summary, setSummary] = useState(''); const [aliases, setAliases] = useState('')
  async function submit() { try { await api.createSeriesCanon(seriesId, projectId, { type, canonicalName: name, summary, aliases: splitAliases(aliases), privacyLevel: 'normal' }); notify('success', '系列共享项已创建'); await onCreated() } catch (error) { notify('error', error instanceof Error ? error.message : '创建失败') } }
  return <Modal title="新增系列共享项" onClose={onClose}><div className="form-stack"><label>类型<select aria-label="共享项类型" value={type} onChange={(event) => setType(event.target.value as EntityType)}><option value="character">人物</option><option value="location">地点</option><option value="item">物品</option><option value="event">事件</option></select></label><label>名称<input aria-label="共享项名称" autoFocus value={name} onChange={(event) => setName(event.target.value)}/></label><label>别名<input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="用顿号分隔"/></label><label>系列基线<textarea aria-label="系列基线" value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="所有作品共同遵守的事实"/></label><div className="modal-actions"><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!name.trim()} onClick={() => void submit()}>保存共享基线</button></div></div></Modal>
}

function SeriesCanonCard({ entry, projectId, onChanged, notify }: { entry: SeriesCanonEntry; projectId: string; onChanged: () => Promise<void>; notify: Notice }) {
  const [editing, setEditing] = useState(Boolean(entry.override)); const [name, setName] = useState(entry.override?.canonicalName ?? entry.canonicalName); const [summary, setSummary] = useState(entry.override?.summary ?? entry.summary); const [aliases, setAliases] = useState((entry.override?.aliases ?? entry.aliases).join('、'))
  useEffect(() => { setEditing(Boolean(entry.override)); setName(entry.override?.canonicalName ?? entry.canonicalName); setSummary(entry.override?.summary ?? entry.summary); setAliases((entry.override?.aliases ?? entry.aliases).join('、')) }, [entry])
  async function save() { try { await api.saveSeriesCanonOverride(entry.id, projectId, { canonicalName: name, aliases: splitAliases(aliases), summary, privacyLevel: entry.override?.privacyLevel ?? entry.privacyLevel }); await onChanged(); notify('success', '本书覆盖已保存，系列基线未改变') } catch (error) { notify('error', error instanceof Error ? error.message : '保存失败') } }
  async function removeOverride() { await api.deleteSeriesCanonOverride(entry.id, projectId); await onChanged(); notify('success', '本书覆盖已移除，恢复使用系列基线') }
  const [confirmTrash, setConfirmTrash] = useState(false)
  async function trash() { await api.trashSeriesCanon(entry.id, projectId); await onChanged(); notify('success', '共享项已移入回收状态') }
  return <article className="series-canon-card"><header><div><span>{typeLabel(entry.type)} · 系列基线</span><h4>{entry.canonicalName}</h4></div><button className="icon-button" aria-label={`移除共享项 ${entry.canonicalName}`} onClick={() => setConfirmTrash(true)}><Trash2 size={14}/></button></header><p>{entry.summary || '暂无说明'}</p>{entry.aliases.length > 0 && <small>别名：{entry.aliases.join('、')}</small>}<div className="override-arrow">系列基线 <span>→</span> 本书覆盖</div>{editing ? <div className="override-form"><label>本书名称<input aria-label={`${entry.canonicalName}本书名称`} value={name} onChange={(event) => setName(event.target.value)}/></label><label>本书说明<textarea aria-label={`${entry.canonicalName}本书覆盖`} value={summary} onChange={(event) => setSummary(event.target.value)}/></label><label>本书别名<input value={aliases} onChange={(event) => setAliases(event.target.value)}/></label><div><button className="button primary compact" disabled={!name.trim()} onClick={() => void save()}><Check size={13}/>保存覆盖</button>{entry.override && <button className="button ghost compact" onClick={() => void removeOverride()}>移除覆盖</button>}</div></div> : <button className="button secondary compact" onClick={() => setEditing(true)}>建立本书覆盖</button>}
    {confirmTrash && <ConfirmDialog title="移除共享项" message={`移除系列共享项“${entry.canonicalName}”？`} confirmLabel="移出当前列表" danger onConfirm={() => void trash()} onClose={() => setConfirmTrash(false)} />}
  </article>
}

function CreateStyleSampleModal({ seriesId, projectId, onClose, onCreated, notify }: { seriesId: string; projectId: string; onClose: () => void; onCreated: () => Promise<void>; notify: Notice }) {
  const [scope, setScope] = useState<'series' | 'project'>('series'); const [title, setTitle] = useState(''); const [content, setContent] = useState(''); const [guidance, setGuidance] = useState(''); const [privacyLevel, setPrivacy] = useState<PrivacyLevel>('author_only')
  async function submit() { try { const input = { title, content, guidance, privacyLevel, enabled: true }; if (scope === 'series') await api.createSeriesStyleSample(seriesId, projectId, input); else await api.createProjectStyleSample(projectId, input); notify('success', scope === 'series' ? '系列样本已创建' : '本书样本已创建'); await onCreated() } catch (error) { notify('error', error instanceof Error ? error.message : '创建失败') } }
  return <Modal title="新增风格样本" onClose={onClose} wide><div className="form-stack"><label>作用范围<select aria-label="样本作用范围" value={scope} onChange={(event) => setScope(event.target.value as 'series' | 'project')}><option value="series">系列共享</option><option value="project">仅本书</option></select></label><label>样本标题<input aria-label="样本标题" autoFocus value={title} onChange={(event) => setTitle(event.target.value)}/></label><label>原文<textarea aria-label="样本原文" rows={8} value={content} onChange={(event) => setContent(event.target.value)} placeholder="只粘贴你有权使用的文本"/></label><label>使用指导<textarea aria-label="样本使用指导" value={guidance} onChange={(event) => setGuidance(event.target.value)} placeholder="例如：参考短句节奏，不复用专有名词"/></label><label>隐私<select value={privacyLevel} onChange={(event) => setPrivacy(event.target.value as PrivacyLevel)}><option value="normal">允许发送给已配置的 AI</option><option value="author_only">仅作者授权后发送</option><option value="local_private">仅本地，禁止发送</option></select></label><div className="modal-actions"><button className="button ghost" onClick={onClose}>取消</button><button className="button primary" disabled={!title.trim() || !content.trim()} onClick={() => void submit()}>保存并启用</button></div></div></Modal>
}

function StyleSampleCard({ sample, projectId, onChanged, notify }: { sample: StyleSample; projectId: string; onChanged: () => Promise<void>; notify: Notice }) {
  const [confirmTrash, setConfirmTrash] = useState(false)
  async function toggle() { try { if (sample.scope === 'series') await api.setStyleSamplePreference(sample.id, projectId, !sample.effectiveEnabled); else await api.updateStyleSample(sample.id, projectId, { enabled: !sample.enabled }); await onChanged(); notify('success', !sample.effectiveEnabled ? '本书已启用该样本' : '本书已停用该样本') } catch (error) { notify('error', error instanceof Error ? error.message : '更新失败') } }
  async function trash() { await api.trashStyleSample(sample.id, projectId); await onChanged(); notify('success', '风格样本已移除') }
  return <article className={`style-sample-card ${sample.effectiveEnabled ? '' : 'disabled'}`}><header><div><span className="source-pill">{sample.scope === 'series' ? '系列共享' : '仅本书'}</span><h4>{sample.title}</h4></div><div><label className="sample-toggle"><input aria-label={`${sample.title}在本书中启用`} type="checkbox" checked={sample.effectiveEnabled} onChange={() => void toggle()}/><span>{sample.effectiveEnabled ? '已启用' : '已停用'}</span></label><button className="icon-button" aria-label={`移除样本 ${sample.title}`} onClick={() => setConfirmTrash(true)}><Trash2 size={14}/></button></div></header><p>{sample.content.length > 180 ? `${sample.content.slice(0, 180)}…` : sample.content}</p><small>{sample.guidance ? `使用指导：${sample.guidance}` : '未填写使用指导'} · {privacyLabel(sample.privacyLevel)}</small>
    {confirmTrash && <ConfirmDialog title="移除风格样本" message={`移除风格样本“${sample.title}”？`} confirmLabel="移除样本" danger onConfirm={() => void trash()} onClose={() => setConfirmTrash(false)} />}
  </article>
}

function splitAliases(value: string) { return value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) }
function typeLabel(type: EntityType) { return ({ character: '人物', location: '地点', item: '物品', event: '事件' } as const)[type] }
function privacyLabel(level: PrivacyLevel) { return level === 'local_private' ? '仅本地' : level === 'author_only' ? '作者授权' : '可用于 AI' }
