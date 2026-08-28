import { FileCheck2, Fingerprint, MessageSquareText } from 'lucide-react'
import type { ManuscriptNode } from '../../shared/types'
import { Badge, Button, Card, PageHeader, WorkflowTemplate } from '../ui'

export function RevisionWorkspace({ nodes, onOpenTool }: { nodes: ManuscriptNode[]; onOpenTool: (tool: 'write' | 'review' | 'provenance') => void }) {
  const scenes = nodes.filter((node) => node.type === 'scene' && !node.deletedAt)
  const revising = scenes.filter((node) => node.status === 'revising').length
  const complete = scenes.filter((node) => node.status === 'complete' || node.status === 'published').length

  return <WorkflowTemplate className="revision-workspace">
    <PageHeader eyebrow="修订台" title="把发现变成决定" description="检查、外部意见和创作来源使用同一条路径：看证据，做决定，留下记录。" />
    <div className="revision-summary"><Badge tone="info">{scenes.length} 个场景</Badge><Badge tone={revising ? 'warning' : 'neutral'}>{revising} 个修订中</Badge><Badge tone="success">{complete} 个已完成</Badge></div>
    <div className="revision-grid">
      <Card className="revision-card" title="连续性与事实候选" description="当前场景 · 作者逐条确认">
        <FileCheck2 size={28} aria-hidden="true" />
        <p>回到写作检查器查看冲突证据、人物当前状态与事实变化候选。系统不会直接改正文或正典。</p>
        <Button variant="primary" onClick={() => onOpenTool('write')}>打开场景检查器</Button>
      </Card>
      <Card className="revision-card" title="角色化审阅" description="编辑、试读者与合著者">
        <MessageSquareText size={28} aria-hidden="true" />
        <p>建立隔离任务包，把意见带回来；作者按锚点逐条采纳、暂缓或拒绝，不交出项目权限。</p>
        <Button variant="secondary" onClick={() => onOpenTool('review')}>处理审阅任务</Button>
      </Card>
      <Card className="revision-card" title="创作来源" description="人写、AI 候选与作者改写">
        <Fingerprint size={28} aria-hidden="true" />
        <p>按版本查看来源标签、哈希和接受关系；只有明确选择时，导出报告才包含正文摘录。</p>
        <Button variant="secondary" onClick={() => onOpenTool('provenance')}>查看来源记录</Button>
      </Card>
    </div>
  </WorkflowTemplate>
}
