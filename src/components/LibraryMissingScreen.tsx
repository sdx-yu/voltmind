import { AlertTriangle, DatabaseBackup, RefreshCcw } from 'lucide-react'
import { Button, PageHeader, WorkflowTemplate } from '../ui'

export function LibraryMissingScreen({ reason, onRetry = () => window.location.reload() }: { reason: string; onRetry?: () => void }) {
  return <main className="rescue-page"><WorkflowTemplate className="rescue-card library-missing-card">
    <div className="rescue-icon"><AlertTriangle size={30} /></div>
    <PageHeader eyebrow="资料库保护已启动" title="本地稿件库文件不见了" description="笔不怠已停止常规读写，避免把当前状态误认为一个新的空书架。你的自动快照没有被覆盖。" />
    <div className="rescue-reason"><DatabaseBackup size={18}/><span><strong>检测结果</strong><small>{reason}</small></span></div>
    <ol className="library-missing-steps">
      <li><strong>先不要新建作品</strong><span>当前服务已经阻止所有写入。</span></li>
      <li><strong>关闭并重新打开笔不怠</strong><span>重新启动后会进入安全救援模式。</span></li>
      <li><strong>选择最近的完整快照</strong><span>确认后恢复书架，异常原件会单独保留。</span></li>
    </ol>
    <div className="rescue-actions"><Button variant="secondary" leadingIcon={<RefreshCcw size={16}/>} onClick={onRetry}>重新检测</Button></div>
    <small className="rescue-footnote">恢复过程只在本机进行，不会上传正文。</small>
  </WorkflowTemplate></main>
}
