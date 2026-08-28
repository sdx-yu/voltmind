import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, CloudOff, Download, KeyRound, RefreshCw, ShieldCheck, Upload, XCircle } from 'lucide-react'
import type { Project, SyncConflict, SyncDrillResult, SyncPackageInspection, SyncProjectStatus, SyncTransferPackage } from '../../shared/types'
import { api } from '../lib/api'
import { Modal } from './Modal'
import { Badge, Button, InlineNotice, PageHeader, WorkflowSteps, WorkflowTemplate } from '../ui'

type Props = {
  project: Project
  onSynced: () => Promise<void>
  onBack?: () => void
  notify: (type: 'success' | 'error', message: string) => void
}

export function SyncWorkspace({ project, onSynced, onBack, notify }: Props) {
  const [status, setStatus] = useState<SyncProjectStatus | null>(null)
  const [conflicts, setConflicts] = useState<SyncConflict[]>([])
  const [deviceName, setDeviceName] = useState('我的电脑')
  const [recoveryPhrase, setRecoveryPhrase] = useState('')
  const [shownPhrase, setShownPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [drill, setDrill] = useState<SyncDrillResult | null>(null)
  const [pendingImport, setPendingImport] = useState<{ value: unknown; inspection: SyncPackageInspection; fileName: string } | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    const nextStatus = await api.getSyncStatus(project.id)
    setStatus(nextStatus)
    setConflicts(nextStatus.initialized ? await api.listSyncConflicts(project.id) : [])
  }
  useEffect(() => { void refresh().catch((error) => notify('error', message(error, '同步状态加载失败'))) }, [project.id])

  async function initialize() {
    setBusy(true)
    try {
      const result = await api.initializeSync(project.id, deviceName)
      setStatus(result.status); setShownPhrase(result.recoveryPhrase); setRecoveryPhrase(result.recoveryPhrase)
    } catch (error) { notify('error', message(error, '初始化失败')) }
    finally { setBusy(false) }
  }

  async function exportPackage() {
    setBusy(true)
    try {
      const result = await api.exportSyncPackage(project.id, recoveryPhrase)
      downloadPackage(result, `${safeName(project.title)}-${result.sequence}.bbd-sync`)
      await refresh(); notify('success', `接力包已加密导出 · 序号 ${result.sequence}`)
    } catch (error) { notify('error', message(error, '接力包导出失败')) }
    finally { setBusy(false) }
  }

  async function previewImport(file: File) {
    setBusy(true)
    try {
      const value = JSON.parse(await file.text()) as unknown
      const inspection = await api.inspectSyncPackage(value, recoveryPhrase)
      setPendingImport({ value, inspection, fileName: file.name })
    } catch (error) { notify('error', message(error, '接力包无法解密或已损坏')) }
    finally { setBusy(false); if (importRef.current) importRef.current.value = '' }
  }

  async function applyImport() {
    if (!pendingImport) return
    setBusy(true)
    try {
      const result = await api.importSyncPackage(pendingImport.value, recoveryPhrase, status?.deviceName || deviceName)
      setPendingImport(null); await Promise.all([refresh(), onSynced()])
      notify('success', result.duplicate ? '该接力包已处理过，没有重复写入' : `已接力：合并 ${result.mergedScenes} 个场景，新增 ${result.conflictsCreated} 个待决冲突`)
    } catch (error) { notify('error', message(error, '接力包应用失败')) }
    finally { setBusy(false) }
  }

  async function resolve(conflict: SyncConflict, resolution: 'keep_local' | 'use_remote' | 'acknowledge_remote') {
    setBusy(true)
    try { await api.resolveSyncConflict(project.id, conflict.id, resolution); await Promise.all([refresh(), onSynced()]); notify('success', '冲突决定已记录到来源链') }
    catch (error) { notify('error', message(error, '冲突处理失败')) }
    finally { setBusy(false) }
  }

  async function runDrill() {
    setBusy(true)
    try { const result = await api.runSyncDrill(); setDrill(result); notify(result.ok ? 'success' : 'error', result.ok ? '接力自检全部通过' : '接力自检存在失败项') }
    catch (error) { notify('error', message(error, '演练执行失败')) }
    finally { setBusy(false) }
  }

  async function copyRecoveryPhrase() {
    try { await navigator.clipboard.writeText(shownPhrase); notify('success', '恢复短语已复制，请妥善保存') }
    catch { notify('error', '复制失败，请手动选中恢复短语并复制') }
  }

  if (!status) return <WorkflowTemplate className="sync-workspace"><p className="muted">正在读取设备接力状态…</p></WorkflowTemplate>
  const pending = conflicts.filter((conflict) => conflict.status === 'pending')

  return <WorkflowTemplate className="sync-workspace">
    <PageHeader eyebrow="设备接力" title="加密接力，不托管你的故事" description="用本地文件在两台设备间接力；正文、正典与来源记录先加密，再离开本机。" backAction={onBack ? <Button variant="ghost" size="small" leadingIcon={<ArrowLeft size={15}/>} onClick={onBack}>返回上一页</Button> : undefined} actions={<Badge tone="info"><CloudOff size={13}/> 本地文件 · 暂无云服务</Badge>} />
    <WorkflowSteps label="设备接力步骤" items={[
      { id: 'identity', label: '建立设备身份', description: '保存恢复短语', state: status.initialized ? 'complete' : 'current' },
      { id: 'transfer', label: '导出或导入', description: '先加密，再传递', state: status.initialized ? 'current' : 'upcoming' },
      { id: 'resolve', label: '决定冲突', description: '关键分叉由作者选择', state: pending.length ? 'current' : status.initialized ? 'complete' : 'upcoming' },
    ]} />
    <InlineNotice className="sync-disclaimer" tone="warning" title="这不是在线云盘">需要手动传递 .bbd-sync 文件；丢失恢复短语将无法解密。系统会校验分块、合并双副本，并把业务冲突留给作者决定。</InlineNotice>

    {!status.initialized ? <section className="sync-onboarding sync-card">
      <KeyRound size={27}/><div><h3>为这个项目建立同步身份</h3><p>初始化后会生成一条只显示一次的恢复短语。应用只保存验证信息，不保存短语本身。</p><label>设备名称<input value={deviceName} maxLength={80} onChange={(event) => setDeviceName(event.target.value)} /></label><button className="button primary" disabled={busy || !deviceName.trim()} onClick={() => void initialize()}><ShieldCheck size={15}/>{busy ? '正在建立…' : '建立同步身份'}</button></div>
    </section> : <>
      <div className="sync-summary">
        <SyncStat label="本机设备" value={status.deviceName}/><SyncStat label="本机序号" value={status.sequence}/><SyncStat label="待处理冲突" value={status.unresolvedConflicts}/><SyncStat label="版本向量" value={vectorLabel(status.vector)} code/>
      </div>
      <div className="sync-layout">
        <section className="sync-card"><header><div><h3>加密接力包</h3><small>bbd-sync-v1 · AES-256-GCM · 64 KB 分块</small></div></header><label>恢复短语<input type="password" autoComplete="off" value={recoveryPhrase} onChange={(event) => setRecoveryPhrase(event.target.value)} placeholder="在本机输入，不会写入数据库" /></label><div className="sync-package-actions"><button className="button primary" disabled={busy || recoveryPhrase.length < 20} onClick={() => void exportPackage()}><Download size={15}/>导出接力包</button><input ref={importRef} hidden type="file" accept=".bbd-sync,application/json" onChange={(event) => event.target.files?.[0] && void previewImport(event.target.files[0])}/><button className="button secondary" disabled={busy || recoveryPhrase.length < 20} onClick={() => importRef.current?.click()}><Upload size={15}/>导入并预检</button></div><p className="sync-hint">接力包可经网盘、U 盘或局域网传递。中转方只能看到包序号、设备代号、分块和密文。</p></section>
        <section className="sync-card"><header><div><h3>接力自检</h3><small>使用临时样本，不读取当前书稿</small></div><button className="button ghost compact" disabled={busy} onClick={() => void runDrill()}><RefreshCw size={14}/>运行五项自检</button></header>{drill ? <div className="sync-drill">{drill.checks.map((check) => <article key={check.code} className={check.passed ? 'passed' : 'failed'}>{check.passed ? <CheckCircle2 size={16}/> : <XCircle size={16}/>}<span><strong>{check.label}</strong><small>{check.detail}</small></span></article>)}</div> : <p className="sync-hint">检查密文保护、错误短语、乱序接力、缺块和并发版本。</p>}</section>
      </div>
      <section className="sync-card sync-conflicts"><header><div><h3>需要作者决定的冲突</h3><small>正文并发编辑自动合并；删除/编辑、正典并发和来源链分叉必须显式决定。</small></div><span>{pending.length} 项待处理</span></header>{pending.length ? <div>{pending.map((conflict) => <article key={conflict.id}><AlertTriangle size={17}/><div><strong>{conflictLabel(conflict)}</strong><p>{summary(conflict.localSummary, '本机')} · {summary(conflict.remoteSummary, '接力包')}</p><code>{vectorLabel(conflict.localVector)} ↔ {vectorLabel(conflict.remoteVector)}</code></div><aside>{conflict.objectType === 'provenance' ? <><button className="button secondary compact" disabled={busy} onClick={() => void resolve(conflict, 'keep_local')}>保留本机链</button><button className="button ghost compact" disabled={busy} onClick={() => void resolve(conflict, 'acknowledge_remote')}>知悉远端分叉</button></> : <><button className="button secondary compact" disabled={busy} onClick={() => void resolve(conflict, 'keep_local')}>保留本机</button><button className="button ghost compact" disabled={busy} onClick={() => void resolve(conflict, 'use_remote')}>采用接力包</button></>}</aside></article>)}</div> : <div className="sync-empty"><CheckCircle2 size={18}/>没有需要人工决定的冲突</div>}</section>
    </>}

    {shownPhrase && <Modal title="仅显示这一次：恢复短语" onClose={() => setShownPhrase('')}><div className="recovery-phrase"><AlertTriangle size={22}/><p>请立即抄写到密码管理器或离线纸张。关闭后应用无法再次显示，也无法替你找回。</p><code>{shownPhrase}</code><button className="button primary" onClick={() => void copyRecoveryPhrase()}>复制恢复短语</button><label><input type="checkbox" onChange={(event) => { if (event.target.checked) setShownPhrase('') }}/><span>我已安全保存，关闭此提示</span></label></div></Modal>}
    {pendingImport && <Modal title="接力包预检" onClose={() => setPendingImport(null)}><div className="sync-preview"><ShieldCheck size={23}/><h3>{pendingImport.inspection.projectTitle}</h3><p>{pendingImport.fileName} 已通过分块哈希、认证标签和恢复短语校验。</p><dl><div><dt>发送设备</dt><dd>{pendingImport.inspection.senderDeviceName}</dd></div><div><dt>序号</dt><dd>{pendingImport.inspection.sequence}</dd></div><div><dt>场景 / 正典</dt><dd>{pendingImport.inspection.sceneCount} / {pendingImport.inspection.entityCount}</dd></div><div><dt>移动收集项</dt><dd>{pendingImport.inspection.mobileItemCount}</dd></div><div><dt>内容寻址附件</dt><dd>{pendingImport.inspection.attachmentCount}</dd></div><div><dt>来源事件</dt><dd>{pendingImport.inspection.provenanceEventCount}</dd></div></dl><button className="button primary" disabled={busy} onClick={() => void applyImport()}>{busy ? '正在合并…' : '确认应用到当前项目'}</button></div></Modal>}
  </WorkflowTemplate>
}

function SyncStat({ label, value, code = false }: { label: string; value: string | number; code?: boolean }) { return <article><small>{label}</small><strong className={code ? 'hash-value' : ''}>{value}</strong></article> }
function vectorLabel(vector: Record<string, number>) { const entries = Object.entries(vector); return entries.length ? entries.map(([id, sequence]) => `${id.slice(0, 5)}:${sequence}`).join(' · ') : '尚无版本' }
function conflictLabel(conflict: SyncConflict) { return conflict.kind === 'provenance_fork' ? '创作来源链出现分叉' : conflict.kind === 'delete_edit' ? '删除与编辑同时发生' : conflict.objectType === 'entity' ? '正典项在两端同时修改' : '结构化内容同时修改' }
function summary(value: Record<string, unknown>, fallback: string) { return String(value.name ?? value.title ?? value.chainHead ?? fallback).slice(0, 70) }
function message(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback }
function safeName(value: string) { return value.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '笔不怠' }
function downloadPackage(value: SyncTransferPackage, fileName: string) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; anchor.click(); URL.revokeObjectURL(url) }
