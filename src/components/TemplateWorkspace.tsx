import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, Download, FileJson2, PackageCheck, PackageOpen, RotateCcw, ShieldCheck, ShieldOff, Trash2, Upload, XCircle } from 'lucide-react'
import type { Project, TemplateApplication, TemplateCapability, TemplateGrant, TemplateInstallation, TemplatePackageInspection, TemplatePreview } from '../../shared/types'
import { api } from '../lib/api'

type Props = {
  project: Project
  onBack: () => void
  onChanged: () => Promise<void>
  notify: (type: 'success' | 'error', message: string) => void
}

const capabilityLabels: Record<TemplateCapability, { title: string; detail: string }> = {
  'project.summary.read': { title: '读取所选项目摘要', detail: '仅书名、简介和章节/场景数量；不含正文。' },
  'plan.nodes.create': { title: '创建计划节点', detail: '只能新建空白章节与场景，不覆盖已有正文。' },
  'local.rules.run': { title: '运行本地规则', detail: '只运行协议内置的声明式计数与重复标题检查。' },
}

export function TemplateWorkspace({ project, onBack, onChanged, notify }: Props) {
  const [installations, setInstallations] = useState<TemplateInstallation[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [grants, setGrants] = useState<TemplateGrant[]>([])
  const [preview, setPreview] = useState<TemplatePreview | null>(null)
  const [applications, setApplications] = useState<TemplateApplication[]>([])
  const [pendingPackage, setPendingPackage] = useState<unknown>(null)
  const [inspection, setInspection] = useState<TemplatePackageInspection | null>(null)
  const [busy, setBusy] = useState(false)
  const [renameConflicts, setRenameConflicts] = useState(false)
  const active = useMemo(() => installations.find((item) => item.id === selectedId) ?? installations.find((item) => item.status !== 'uninstalled') ?? installations[0], [installations, selectedId])

  async function load() {
    const [nextInstallations, nextApplications] = await Promise.all([api.listTemplatePackages(), api.listTemplateApplications(project.id)])
    setInstallations(nextInstallations); setApplications(nextApplications)
    setSelectedId((current) => nextInstallations.some((item) => item.id === current) ? current : nextInstallations.find((item) => item.status !== 'uninstalled')?.id ?? nextInstallations[0]?.id ?? '')
  }

  useEffect(() => { void load().catch(handleError) }, [project.id])
  useEffect(() => {
    setPreview(null); setRenameConflicts(false)
    if (!active) { setGrants([]); return }
    void api.listTemplateGrants(project.id, active.id).then(setGrants).catch(handleError)
  }, [project.id, active?.id])

  function handleError(error: unknown) { notify('error', error instanceof Error ? error.message : '结构模板操作失败') }

  async function inspectFile(file: File) {
    setInspection(null); setPendingPackage(null)
    try {
      if (file.size > 512 * 1024) throw new Error('模板包不能超过 512 KiB')
      const parsed = JSON.parse(await file.text()) as unknown
      const result = await api.inspectTemplatePackage(parsed)
      setPendingPackage(parsed); setInspection(result)
    } catch (error) { handleError(error) }
  }

  async function installPending() {
    if (!pendingPackage || !inspection || inspection.collision) return
    setBusy(true)
    try {
      const installed = await api.installTemplatePackage(pendingPackage)
      await load(); setSelectedId(installed.id); setPendingPackage(null); setInspection(null)
      notify('success', inspection.duplicate ? '模板已存在，目录保持不变' : `已安装“${installed.manifest.name}”`)
    } catch (error) { handleError(error) } finally { setBusy(false) }
  }

  async function setStatus(status: 'enabled' | 'disabled' | 'uninstalled') {
    if (!active) return
    setBusy(true)
    try { await api.setTemplatePackageStatus(active.id, status); await load(); setPreview(null); notify('success', status === 'enabled' ? '模板已启用' : status === 'disabled' ? '模板已停用，既有应用记录不受影响' : '模板已从目录卸载，历史和已创建节点仍保留') }
    catch (error) { handleError(error) } finally { setBusy(false) }
  }

  async function toggleGrant(capability: TemplateCapability, granted: boolean) {
    if (!active) return
    try {
      await api.setTemplateGrant(project.id, active.id, capability, granted)
      setGrants(await api.listTemplateGrants(project.id, active.id)); setPreview(null)
      notify('success', granted ? `已授权：${capabilityLabels[capability].title}` : `已撤销：${capabilityLabels[capability].title}`)
    } catch (error) { handleError(error) }
  }

  async function buildPreview() {
    if (!active) return
    setBusy(true)
    try { const next = await api.previewTemplate(project.id, active.id); setPreview(next); setRenameConflicts(!next.conflicts.length); notify('success', `预览完成：计划新建 ${next.nodes.length} 个空白节点`) }
    catch (error) { handleError(error) } finally { setBusy(false) }
  }

  async function applyPreview() {
    if (!active || !preview) return
    setBusy(true)
    try {
      const result = await api.applyTemplate(project.id, active.id, preview.previewHash, preview.conflicts.length ? 'rename' : 'cancel')
      await Promise.all([load(), onChanged()]); setPreview(null)
      notify('success', `已创建 ${result.createdNodeIds.length} 个计划节点，可整批撤销`)
    } catch (error) { handleError(error); setPreview(null) } finally { setBusy(false) }
  }

  async function revert(application: TemplateApplication) {
    setBusy(true)
    try { await api.revertTemplateApplication(application.id); await Promise.all([load(), onChanged()]); notify('success', '模板节点已整批移入项目回收站，可单独恢复') }
    catch (error) { handleError(error) } finally { setBusy(false) }
  }

  async function exportPackage() {
    if (!active) return
    try {
      const templatePackage = await api.exportTemplatePackage(active.id)
      const blob = new Blob([JSON.stringify(templatePackage, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${active.manifest.packageId}-${active.manifest.version}.bbd-template.json`; anchor.click(); URL.revokeObjectURL(url)
    } catch (error) { handleError(error) }
  }

  return <section className="template-workspace">
    <header className="page-header template-header"><div><button className="back-link" onClick={onBack}><ArrowLeft size={15}/>返回交付台</button><span className="eyebrow">本地结构目录 · V2-P</span><h2>先预览，再把结构放进书稿</h2><p>这里只安装声明式结构数据，不执行第三方代码；作者标签和来源均为自述，不是官方认证。</p></div><label className="button primary template-import"><Upload size={15}/>导入本地包<input aria-label="选择结构模板包" type="file" accept="application/json,.json,.bbd-template" onChange={(event) => { const file = event.target.files?.[0]; if (file) void inspectFile(file); event.currentTarget.value = '' }}/></label></header>

    {inspection && <section className={`template-inspection ${inspection.collision ? 'invalid' : 'valid'}`}><div>{inspection.collision ? <XCircle size={22}/> : <PackageCheck size={22}/>}<span><strong>{inspection.manifest.name} · {inspection.manifest.version}</strong><small>{inspection.manifest.authorLabel} · {inspection.manifest.license} · {inspection.chapterCount} 章 / {inspection.sceneCount} 场 / {inspection.ruleCount} 条规则</small></span></div><p>{inspection.collision ? '同一包 ID 和版本已经存在不同内容，已阻止覆盖。' : inspection.duplicate ? '相同内容已在目录中，重复安装不会新增记录。' : '完整性校验通过；安装后仍需对当前项目逐项授权。'}</p><ul>{inspection.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><button className="button primary" disabled={busy || inspection.collision} onClick={() => void installPending()}>{inspection.duplicate ? '确认已有包' : '安装到本地目录'}</button></section>}

    <div className="template-layout">
      <aside className="template-catalog"><header><h3>本地目录</h3><span>{installations.filter((item) => item.status !== 'uninstalled').length} 个可见包</span></header>{installations.map((installation) => <button key={installation.id} className={`${active?.id === installation.id ? 'active' : ''} ${installation.status}`} onClick={() => setSelectedId(installation.id)}><PackageOpen size={18}/><span><strong>{installation.manifest.name}</strong><small>{installation.manifest.version} · {installation.builtIn ? '本地示例' : '本机导入'} · {statusLabel(installation.status)}</small></span></button>)}</aside>

      <main className="template-detail">{active ? <>
        <section className="template-package-card"><header><div><span className={`template-status ${active.status}`}>{statusLabel(active.status)}</span><h3>{active.manifest.name}</h3><p>{active.manifest.description}</p></div><code>{active.packageHash.slice(0, 16)}</code></header><div className="template-meta"><span>版本 {active.manifest.version}</span><span>{active.manifest.authorLabel}</span><span>{active.manifest.license}</span><span>{active.package.structure.nodes.filter((node) => node.type === 'chapter').length} 章 / {active.package.structure.nodes.filter((node) => node.type === 'scene').length} 场</span></div><p className="template-trust-note"><ShieldOff size={15}/>发布者身份未经认证；包已通过本地结构与 SHA-256 完整性校验，但不是数字签名。</p><div className="template-actions"><button className="button ghost compact" onClick={() => void exportPackage()}><Download size={14}/>导出包</button>{active.status === 'enabled' ? <button className="button ghost compact" disabled={busy} onClick={() => void setStatus('disabled')}>停用</button> : <button className="button ghost compact" disabled={busy} onClick={() => void setStatus('enabled')}>启用</button>}<button className="button ghost compact danger" disabled={busy || active.status === 'uninstalled'} onClick={() => void setStatus('uninstalled')}><Trash2 size={14}/>卸载</button></div></section>

        <section className="template-permissions"><header><div><h3>当前项目授权</h3><p>默认全部关闭；授权只作用于“{project.title}”。</p></div><ShieldCheck size={22}/></header>{active.manifest.capabilities.map((capability) => { const grant = grants.find((item) => item.capability === capability); return <label key={capability}><input type="checkbox" disabled={active.status !== 'enabled'} checked={Boolean(grant?.granted)} onChange={(event) => void toggleGrant(capability, event.target.checked)}/><span><strong>{capabilityLabels[capability].title}</strong><small>{capabilityLabels[capability].detail}</small><code>{capability}</code></span></label> })}<div className="template-denied"><strong>始终不可授权</strong><span>正文读取 · 网络访问 · 密钥与恢复短语 · 任意文件系统 · Node/系统命令</span></div></section>

        <section className="template-preview-card"><header><div><h3>应用预览</h3><p>预览哈希会绑定当前书稿树；预览后若结构变化，旧预览自动失效。</p></div><button className="button secondary" disabled={busy || active.status !== 'enabled'} onClick={() => void buildPreview()}><FileJson2 size={15}/>{busy ? '处理中…' : '生成预览'}</button></header>{preview && <><div className="template-preview-summary"><span>{preview.projectSummary ? `${preview.projectSummary.chapterCount} 章 / ${preview.projectSummary.sceneCount} 场` : '项目摘要未授权'}</span><span>新建 {preview.nodes.length} 个节点</span><span>{preview.ruleResults.length} 条本地规则结果</span></div>{preview.missingCapabilities.length > 0 && <div className="template-warning"><XCircle size={17}/>尚缺 {preview.missingCapabilities.length} 项授权，不能应用。</div>}{preview.conflicts.length > 0 && <label className="template-conflict"><input type="checkbox" checked={renameConflicts} onChange={(event) => setRenameConflicts(event.target.checked)}/><span><strong>同名章节自动加“（模板）”后缀</strong><small>{preview.conflicts.join(' ')}</small></span></label>}<div className="template-diff">{preview.nodes.map((node) => <article key={node.localId} className={node.type}><span>＋</span><div><strong>{node.title}</strong><small>{node.type === 'chapter' ? '章节' : `场景 · ${node.parentTitle}`} · {node.status === 'idea' ? '构想' : '计划中'} · 空白正文</small>{node.description && <p>{node.description}</p>}</div>{node.conflict === 'title' && <em>标题冲突</em>}</article>)}</div>{preview.ruleResults.length > 0 && <div className="template-rules">{preview.ruleResults.map((result) => <div key={result.ruleId} className={result.passed ? 'passed' : 'review'}>{result.passed ? <CheckCircle2 size={15}/> : <XCircle size={15}/>}<span><strong>{result.title}</strong><small>{result.message}</small></span></div>)}</div>}<button className="button primary full" disabled={busy || preview.missingCapabilities.length > 0 || (preview.conflicts.length > 0 && !renameConflicts)} onClick={() => void applyPreview()}>确认并单事务创建</button></>}</section>
      </> : <div className="template-empty">本地目录中还没有结构模板。</div>}</main>

      <aside className="template-history"><header><h3>应用与撤销</h3><span>{applications.length} 次</span></header>{applications.map((application) => <article key={application.id}><span className={application.status}>{application.status === 'applied' ? '已应用' : '已撤销'}</span><strong>{application.packageName}</strong><small>{application.packageVersion} · {application.createdNodeIds.length} 个节点</small><time>{new Date(application.appliedAt).toLocaleString('zh-CN')}</time>{application.status === 'applied' && <button className="button ghost compact" disabled={busy} onClick={() => void revert(application)}><RotateCcw size={13}/>整批移入回收站</button>}</article>)}{!applications.length && <p className="template-empty-history">尚未应用结构模板。</p>}</aside>
    </div>
  </section>
}

function statusLabel(status: TemplateInstallation['status']) { return status === 'enabled' ? '已启用' : status === 'disabled' ? '已停用' : '已卸载' }
