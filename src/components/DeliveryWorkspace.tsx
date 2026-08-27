import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CloudCog, Download, ExternalLink, FileArchive, FileCheck2, Fingerprint, GalleryHorizontalEnd, Goal, LocateFixed, MessageSquareText, PackageOpen, RefreshCw, ShieldAlert, TimerReset } from 'lucide-react'
import type { DeliveryCheckResult, DeliveryCheckRun, DeliveryRule, DeliveryTemplate, Foreshadow, ManuscriptNode, Project } from '../../shared/types'
import { api, downloadUrl } from '../lib/api'

type Props = {
  project: Project
  nodes: ManuscriptNode[]
  onSelectScene: (id: string) => void
  onOpenTool?: (tool: 'provenance' | 'sync' | 'review' | 'sprint' | 'template' | 'visual') => void
  notify: (type: 'success' | 'error', message: string) => void
}

export function DeliveryWorkspace({ project, nodes, onSelectScene, onOpenTool, notify }: Props) {
  const [stats, setStats] = useState<{ todayNet: number; dailyGoal: number; projectGoal: number } | null>(null)
  const [foreshadows, setForeshadows] = useState<Foreshadow[]>([])
  const [templates, setTemplates] = useState<DeliveryTemplate[]>([])
  const [templateId, setTemplateId] = useState('')
  const [checkRun, setCheckRun] = useState<DeliveryCheckRun | null>(null)
  const [checking, setChecking] = useState(false)
  const [exportTemplate, setExportTemplate] = useState('standard')
  const chapters = useMemo(() => nodes.filter((node) => node.type === 'chapter' && !node.deletedAt), [nodes])
  const scenes = useMemo(() => nodes.filter((node) => node.type === 'scene' && !node.deletedAt), [nodes])
  const [selectedChapters, setSelectedChapters] = useState<string[]>(() => chapters.map((chapter) => chapter.id))

  async function loadTemplates() {
    const next = await api.listDeliveryTemplates(project.id)
    setTemplates(next)
    setTemplateId((current) => next.some((template) => template.id === current) ? current : next[0]?.id ?? '')
    return next
  }

  useEffect(() => {
    void Promise.all([
      api.stats(project.id).then(setStats),
      api.listForeshadows(project.id).then(setForeshadows),
      loadTemplates(),
      api.listDeliveryChecks(project.id).then((runs) => setCheckRun(runs[0] ?? null)),
    ]).catch((error) => notify('error', error instanceof Error ? error.message : '交付台加载失败'))
  }, [project.id, nodes])

  useEffect(() => {
    setSelectedChapters((current) => {
      const valid = current.filter((id) => chapters.some((chapter) => chapter.id === id))
      return valid.length || !chapters.length ? valid : chapters.map((chapter) => chapter.id)
    })
  }, [chapters])

  const activeTemplate = templates.find((template) => template.id === templateId) ?? templates[0]
  const activeRuleIds = new Set(activeTemplate?.rules.filter((rule) => rule.effectiveEnabled).map((rule) => rule.id) ?? [])
  const visibleResults = checkRun && activeTemplate && checkRun.templateId === activeTemplate.id
    ? checkRun.results.filter((result) => activeRuleIds.has(result.ruleId))
    : []
  const totalWords = scenes.reduce((sum, scene) => sum + scene.wordCount, 0)
  const incomplete = scenes.filter((scene) => !['complete', 'published'].includes(scene.status))
  const empty = scenes.filter((scene) => scene.wordCount === 0)
  const unresolved = foreshadows.filter((item) => item.status !== 'resolved')

  async function runCheck(nextTemplateId = activeTemplate?.id) {
    if (!nextTemplateId || !selectedChapters.length) return
    setChecking(true)
    try {
      const run = await api.runDeliveryCheck(project.id, nextTemplateId, selectedChapters)
      setCheckRun(run)
      notify('success', run.results.length ? `检查完成，发现 ${run.results.length} 条提醒` : '检查完成，没有发现自动规则风险')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '交付检查失败')
    } finally {
      setChecking(false)
    }
  }

  async function toggleRule(rule: DeliveryRule, enabled: boolean) {
    try {
      await api.setDeliveryRule(project.id, rule.id, enabled, rule.config)
      await loadTemplates()
      if (checkRun?.templateId === activeTemplate?.id) await runCheck(activeTemplate.id)
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '规则设置失败')
    }
  }

  function locate(result: DeliveryCheckResult) {
    if (!result.nodeId) return
    const node = nodes.find((item) => item.id === result.nodeId)
    const sceneId = node?.type === 'scene'
      ? node.id
      : nodes.find((item) => item.type === 'scene' && item.parentId === node?.id && !item.deletedAt)?.id
    if (!sceneId) {
      notify('error', '这条提醒没有可定位的正文场景')
      return
    }
    onSelectScene(sceneId)
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('bbd:read-position', { detail: {
      nodeId: sceneId,
      startOffset: result.startOffset,
      endOffset: result.endOffset,
    } })), 80)
  }

  return <section className="delivery-workspace">
    <header className="page-header"><div><span className="eyebrow">交付台</span><h2>把故事安全地带出去</h2><p>平台规则逐条可关闭；检查只提供有出处的提醒，不会阻止导出，也不会替你投稿。</p></div>{onOpenTool && <div className="page-header-tools"><button className="button ghost compact" onClick={() => onOpenTool('visual')}><GalleryHorizontalEnd size={15} />视觉故事板</button><button className="button ghost compact" onClick={() => onOpenTool('template')}><PackageOpen size={15} />结构模板</button><button className="button ghost compact" onClick={() => onOpenTool('sprint')}><TimerReset size={15} />安静冲刺</button><button className="button ghost compact" onClick={() => onOpenTool('review')}><MessageSquareText size={15} />角色审阅</button><button className="button ghost compact" onClick={() => onOpenTool('provenance')}><Fingerprint size={15} />创作来源</button><button className="button ghost compact" onClick={() => onOpenTool('sync')}><CloudCog size={15} />加密接力</button></div>}</header>
    <div className="delivery-summary">
      <article><span><FileCheck2 size={20} /></span><div><strong>{totalWords.toLocaleString('zh-CN')}</strong><small>全书字数{stats ? ` / ${stats.projectGoal.toLocaleString('zh-CN')}` : ''}</small></div></article>
      <article><span><Goal size={20} /></span><div><strong>{stats?.todayNet.toLocaleString('zh-CN') ?? '—'}</strong><small>今日净新增{stats ? ` / ${stats.dailyGoal}` : ''}</small></div></article>
      <article><span><Check size={20} /></span><div><strong>{scenes.length - incomplete.length}/{scenes.length}</strong><small>完成场景</small></div></article>
      <article><span><ShieldAlert size={20} /></span><div><strong>{empty.length + incomplete.length + unresolved.length}</strong><small>基础建议复核</small></div></article>
    </div>

    <div className="delivery-columns">
      <section className="delivery-card delivery-check-card">
        <header><h3>渠道规则检查</h3><span>{visibleResults.length ? `${visibleResults.length} 条提醒` : checkRun && activeTemplate && checkRun.templateId === activeTemplate.id ? '本次无自动风险' : '尚未检查'}</span></header>
        <div className="delivery-template-picker">
          <label>检查模板<select aria-label="检查模板" value={activeTemplate?.id ?? ''} onChange={(event) => setTemplateId(event.target.value)}>{templates.map((template) => <option key={template.id} value={template.id}>{template.channel} · {template.name}</option>)}</select></label>
          {activeTemplate && <div className="template-provenance">
            <div><strong>{activeTemplate.version}</strong><span>核验 {activeTemplate.verifiedAt || '不适用'}</span>{isStale(activeTemplate) && <em><AlertTriangle size={12}/>建议重新核验</em>}</div>
            <p>{activeTemplate.sourceNote}</p>
            {activeTemplate.sourceUrl ? <a href={activeTemplate.sourceUrl} target="_blank" rel="noreferrer">查看官方来源 <ExternalLink size={12}/></a> : <span>通用本地示例，无平台来源</span>}
          </div>}
        </div>
        <div className="delivery-rule-list">
          {activeTemplate?.rules.map((rule) => <label key={rule.id} className={rule.effectiveEnabled ? '' : 'disabled'}>
            <input type="checkbox" checked={rule.effectiveEnabled} onChange={(event) => void toggleRule(rule, event.target.checked)} />
            <span><strong>{rule.code} · {rule.title}</strong><small>{rule.description}</small></span>
            <em className={`rule-severity ${rule.severity}`}>{rule.manual ? '人工确认' : severityLabel(rule.severity)}</em>
          </label>)}
        </div>
        <button className="button primary full" disabled={checking || !activeTemplate || !selectedChapters.length} onClick={() => void runCheck()}><RefreshCw size={15} className={checking ? 'spinning' : ''}/>{checking ? '正在检查…' : '按所选范围检查'}</button>
        <div className="delivery-results">
          {visibleResults.map((result) => <article key={result.id}>
            <span className={`result-mark ${result.severity}`}>!</span>
            <div><header><strong>{result.ruleCode} · {result.ruleTitle}</strong><em>{severityLabel(result.severity)}</em></header><p>{result.message}</p>{result.quote && <blockquote>“{result.quote}”</blockquote>}</div>
            {result.nodeId && <button className="button ghost compact" onClick={() => locate(result)}><LocateFixed size={13}/>定位</button>}
          </article>)}
          {checkRun && activeTemplate && checkRun.templateId === activeTemplate.id && !visibleResults.length && <div className="delivery-no-results"><Check size={18}/><span>当前启用的自动规则没有发现风险；“人工确认”项仍需作者判断。</span></div>}
        </div>
      </section>

      <section className="delivery-card"><header><h3>范围、导出与备份</h3></header>
        <div className="export-options">
          <label>文稿模板<select value={exportTemplate} onChange={(event) => setExportTemplate(event.target.value)}><option value="standard">标准章节</option><option value="submission">投稿版（含书名页）</option></select></label>
          <div><small>检查与导出范围</small>{chapters.map((chapter) => <label key={chapter.id}><input type="checkbox" checked={selectedChapters.includes(chapter.id)} onChange={(event) => setSelectedChapters((current) => event.target.checked ? [...current, chapter.id] : current.filter((id) => id !== chapter.id))} />{chapter.title}</label>)}</div>
        </div>
        <div className="check-list compact-check-list">
          <CheckItem count={empty.length} title="空场景" message={empty.length ? `${empty.length} 个场景没有正文` : '没有空场景'} />
          <CheckItem count={incomplete.length} title="场景状态" message={incomplete.length ? `${incomplete.length} 个场景尚未标记完成` : '所有场景均已完成'} />
          <CheckItem count={unresolved.length} title="未回收伏笔" message={unresolved.length ? `${unresolved.length} 条尚未回收（提醒，不阻断导出）` : '所有登记伏笔均已回收'} />
        </div>
        <div className="export-list">
          {(['txt', 'md', 'docx'] as const).map((format) => <a key={format} className={`export-row ${selectedChapters.length ? '' : 'disabled'}`} aria-disabled={!selectedChapters.length} href={selectedChapters.length ? downloadUrl(`/api/projects/${project.id}/export?format=${format}&template=${exportTemplate}&chapters=${selectedChapters.join(',')}`) : undefined} onClick={() => selectedChapters.length && notify('success', `已开始导出 ${format.toUpperCase()}`)}><span className="format-icon">{format.toUpperCase()}</span><div><strong>{format === 'txt' ? '纯文本' : format === 'md' ? 'Markdown' : 'Word 文稿'}</strong><small>保留所选章序与标题</small></div><Download size={17} /></a>)}
          <a className="export-row backup" href={downloadUrl(`/api/projects/${project.id}/backup`)} onClick={() => notify('success', '已开始下载完整离线备份')}><span className="format-icon"><FileArchive size={18} /></span><div><strong>完整离线备份</strong><small>含朗读偏好、模板覆盖、检查记录及完整性校验</small></div><Download size={17} /></a>
        </div>
      </section>
    </div>
  </section>
}

function CheckItem({ count, title, message }: { count: number; title: string; message: string }) {
  return <div className={count ? 'warning' : 'passed'}><span>{count ? '!' : '✓'}</span><div><strong>{title}</strong><p>{message}</p></div></div>
}

function severityLabel(severity: DeliveryRule['severity']) {
  return severity === 'risk' ? '风险' : severity === 'review' ? '复核' : '提示'
}

function isStale(template: DeliveryTemplate) {
  if (!template.verifiedAt || !template.staleAfterDays) return false
  const verified = new Date(`${template.verifiedAt}T00:00:00Z`).getTime()
  return Date.now() - verified > template.staleAfterDays * 86_400_000
}
