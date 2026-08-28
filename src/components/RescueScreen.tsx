import { useEffect, useState } from 'react'
import { AlertTriangle, DatabaseBackup, HardDrive, RefreshCcw, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import { Button, PageHeader, WorkflowSteps, WorkflowTemplate } from '../ui'

interface Snapshot { fileName: string; createdAt: string; byteSize: number; integrity: 'ok' | 'failed' }

export function RescueScreen({ onRecovered, notify }: { onRecovered: () => void; notify: (type: 'success' | 'error', message: string) => void }) {
  const [reason, setReason] = useState('数据库完整性检查失败')
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    void api.rescueStatus().then((status) => {
      setReason(status.reason)
      setSnapshots(status.snapshots)
      setSelected(status.snapshots.find((snapshot) => snapshot.integrity === 'ok')?.fileName ?? '')
    }).catch((error) => notify('error', error instanceof Error ? error.message : '无法读取救援信息'))
  }, [])

  async function restore() {
    if (!selected) return
    setBusy(true)
    try {
      const result = await api.restoreDatabaseSnapshot(selected)
      notify('success', `已从 ${result.restoredFrom} 恢复，损坏原件已隔离保留`)
      onRecovered()
    } catch (error) { notify('error', error instanceof Error ? error.message : '恢复失败') }
    finally { setBusy(false) }
  }

  return <main className="rescue-page"><WorkflowTemplate className="rescue-card">
    <div className="rescue-icon"><AlertTriangle size={30} /></div>
    <PageHeader eyebrow="安全救援模式" title="稿件库没有被继续写入" description="检测到主数据库异常，笔不怠已停止常规读写。你可以从校验通过的本地快照恢复；损坏原件不会被覆盖。" />
    <WorkflowSteps label="恢复步骤" items={[{ id: 'inspect', label: '检查快照', description: '只选择校验完整的副本', state: confirming ? 'complete' : 'current' }, { id: 'restore', label: '确认恢复', description: '异常原件会隔离保留', state: confirming ? 'current' : 'upcoming' }]} />
    <div className="rescue-reason"><HardDrive size={17} /><span><strong>检测结果</strong><small>{reason}</small></span></div>
    <div className="snapshot-list" aria-label="可恢复快照">
      {snapshots.length === 0 ? <div className="snapshot-empty"><DatabaseBackup size={24} /><span>没有找到可用快照。请保留数据目录并联系支持，不要反复启动或覆盖文件。</span></div> : snapshots.map((snapshot) => <label key={snapshot.fileName} className={snapshot.integrity === 'ok' ? '' : 'invalid'}>
        <input type="radio" name="snapshot" value={snapshot.fileName} checked={selected === snapshot.fileName} disabled={snapshot.integrity !== 'ok'} onChange={() => setSelected(snapshot.fileName)} />
        <span><strong>{new Date(snapshot.createdAt).toLocaleString('zh-CN')}</strong><small>{snapshot.fileName} · {(snapshot.byteSize / 1024 / 1024).toFixed(1)} MB</small></span>
        <em>{snapshot.integrity === 'ok' ? <><ShieldCheck size={14} />完整</> : '校验失败'}</em>
      </label>)}
    </div>
    {confirming && <div className="rescue-confirm" role="alert"><strong>确认替换异常主库？</strong><p>将从 <code>{selected}</code> 恢复；当前损坏数据库及 WAL/SHM 会移入 recovery 目录，不会被删除。</p><div><Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>返回检查</Button><Button variant="primary" loading={busy} onClick={() => void restore()}>{busy ? '正在校验并恢复…' : '确认恢复并重新打开'}</Button></div></div>}
    {!confirming && <div className="rescue-actions"><Button variant="secondary" leadingIcon={<RefreshCcw size={16} />} onClick={() => window.location.reload()}>重新检测</Button><Button variant="primary" leadingIcon={<DatabaseBackup size={16} />} disabled={!selected} onClick={() => setConfirming(true)}>恢复所选快照</Button></div>}
    <small className="rescue-footnote">恢复会生成独立的损坏文件留档；不会上传正文或诊断数据。</small>
  </WorkflowTemplate></main>
}
