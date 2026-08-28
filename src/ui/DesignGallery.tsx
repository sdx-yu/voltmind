import { BookOpenText, Bold, ChevronDown, FileText, Italic, MoreHorizontal, Plus, Search, Settings, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  CheckboxField,
  Drawer,
  DropdownMenu,
  EmptyState,
  ErrorState,
  IconButton,
  InlineNotice,
  ListRow,
  LoadingState,
  ModalDialog,
  PageHeader,
  Pane,
  Popover,
  SegmentedControl,
  SelectField,
  Skeleton,
  SwitchField,
  Tabs,
  TextareaField,
  TextField,
  ToastNotice,
  Toolbar,
  ToolGroup,
  TreeRow,
} from './index'

type GalleryTheme = 'paper' | 'night' | 'high-contrast'
type GalleryDensity = 'comfortable' | 'compact' | 'touch'

const themeItems = [
  { id: 'paper', label: '宣纸' },
  { id: 'night', label: '夜间' },
  { id: 'high-contrast', label: '高对比' },
]
const densityItems = [
  { id: 'comfortable', label: '舒适' },
  { id: 'compact', label: '紧凑' },
  { id: 'touch', label: '触控' },
]

export function DesignGallery() {
  const [theme, setTheme] = useState<GalleryTheme>('paper')
  const [density, setDensity] = useState<GalleryDensity>('comfortable')
  const [tab, setTab] = useState('scene')
  const [segment, setSegment] = useState('narrative')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [toastOpen, setToastOpen] = useState(true)
  const [switchOn, setSwitchOn] = useState(true)

  useEffect(() => {
    const root = document.documentElement
    const previousTheme = root.dataset.theme
    const previousDensity = root.dataset.density
    root.dataset.theme = theme
    root.dataset.density = density
    return () => {
      if (previousTheme) root.dataset.theme = previousTheme
      else delete root.dataset.theme
      if (previousDensity) root.dataset.density = previousDensity
      else delete root.dataset.density
    }
  }, [theme, density])

  return <main className="ui-gallery">
    <header className="ui-gallery-topbar">
      <div className="ui-gallery-brand"><span>笔</span><div><strong>笔不怠 UI System</strong><small>UI-A～UI-E · 2.1.0 · 笔耕不怠，写尽所思。</small></div></div>
      <div className="ui-gallery-controls">
        <SegmentedControl items={themeItems} value={theme} onChange={(value) => setTheme(value as GalleryTheme)} label="主题" />
        <SegmentedControl items={densityItems} value={density} onChange={(value) => setDensity(value as GalleryDensity)} label="密度" />
      </div>
    </header>

    <div className="ui-gallery-main">
      <PageHeader eyebrow="DESIGN FOUNDATION" title="温润纸感，克制工具感" description="正文是主角，复杂能力按任务出现。这里是新组件、主题、密度与交互状态的唯一开发基线。" actions={<><Button variant="ghost" leadingIcon={<Search size={16} />}>检查组件</Button><Button variant="primary" leadingIcon={<Plus size={16} />}>新故事</Button></>} />

      <GallerySection title="设计变量" description="三层表面、固定字体阶梯和语义状态不依赖具体页面。">
        <div className="ui-gallery-grid">
          <Sample title="表面层级"><div className="ui-gallery-swatches"><span className="ui-gallery-swatch ui-gallery-swatch-canvas">Canvas</span><span className="ui-gallery-swatch ui-gallery-swatch-paper">Paper</span><span className="ui-gallery-swatch ui-gallery-swatch-sunken">Tool</span><span className="ui-gallery-swatch ui-gallery-swatch-selected">Selected</span></div></Sample>
          <Sample title="字体阶梯"><div className="ui-gallery-type-scale"><p className="ui-type-display">写尽所思</p><p className="ui-type-title">章节与工作台标题</p><p className="ui-type-heading">内容分区标题</p><p className="ui-type-body">常规界面正文保持清楚、安静、可长时间阅读。</p><p className="ui-type-label">字段与操作标签</p><p className="ui-type-caption">辅助信息最小使用 12px</p></div></Sample>
        </div>
      </GallerySection>

      <GallerySection title="按钮与工具栏" description="四种动作权重、三种尺寸和统一图标按钮。">
        <div className="ui-gallery-grid">
          <Sample title="动作层级"><div className="ui-gallery-stack"><div className="ui-gallery-row"><Button variant="primary">接受候选</Button><Button variant="secondary">保存草稿</Button><Button variant="ghost">暂不处理</Button><Button variant="danger">删除场景</Button></div><div className="ui-gallery-row"><Button size="small">小按钮</Button><Button size="large">大按钮</Button><Button loading>正在处理</Button><Button disabled>不可用</Button></div></div></Sample>
          <Sample title="编辑工具"><Toolbar label="正文格式"><ToolGroup label="格式"><IconButton label="粗体" selected><Bold size={18} /></IconButton><IconButton label="斜体"><Italic size={18} /></IconButton></ToolGroup><ToolGroup label="查找与设置"><IconButton label="搜索"><Search size={18} /></IconButton><IconButton label="设置"><Settings size={18} /></IconButton></ToolGroup></Toolbar></Sample>
        </div>
      </GallerySection>

      <GallerySection title="字段与选择" description="标签、帮助、错误、禁用和触控状态共用同一结构。">
        <div className="ui-gallery-grid">
          <Sample title="表单字段"><div className="ui-gallery-stack"><TextField label="故事名称" defaultValue="雾港来信" description="仅保存在本地项目中" /><SelectField label="场景状态" defaultValue="draft"><option value="idea">想法</option><option value="draft">草稿</option><option value="complete">完成</option></SelectField><TextareaField label="场景目标" defaultValue="让主角在错误线索中发现真正的时间矛盾。" /><TextField label="章节编号" defaultValue="-1" error="章节编号必须大于 0" /></div></Sample>
          <Sample title="勾选与开关"><div className="ui-gallery-stack"><CheckboxField label="发送当前场景给 AI" description="调用前仍会显示上下文胶囊" defaultChecked /><CheckboxField label="包含仅本地正典" description="隐私字段不可发送" disabled /><SwitchField label="安静保存提示" description="只在保存异常时打断写作" checked={switchOn} onChange={(event) => setSwitchOn(event.target.checked)} /></div></Sample>
        </div>
      </GallerySection>

      <GallerySection title="导航与容器" description="页签切页面，分段控件切同一数据的视图；左右栏语义固定。">
        <div className="ui-gallery-stack">
          <Sample title="页签与视图"><div className="ui-gallery-stack"><Tabs items={[{ id: 'scene', label: '场景' }, { id: 'canon', label: '正典' }, { id: 'finding', label: '检查' }, { id: 'candidate', label: '候选' }]} value={tab} onChange={setTab} label="检查器页签" /><SegmentedControl items={[{ id: 'narrative', label: '叙述顺序' }, { id: 'story', label: '故事时间' }, { id: 'board', label: '故事板' }]} value={segment} onChange={setSegment} label="规划视图" /></div></Sample>
          <div className="ui-gallery-pane-demo"><Pane side="left" title="书稿"><div role="tree" aria-label="示例书稿"><TreeRow title="第一卷" description="12 章" icon={<BookOpenText size={16} />} expanded /><TreeRow title="第一章 雾中来客" meta="2,140 字" level={2} selected /></div></Pane><Pane title="正文纸张"><Card title="第一场 · 码头" description="POV：林照"><p className="ui-type-body">雾从河面漫上来，先吞没了对岸的灯。</p></Card></Pane><Pane side="right" title="场景检查"><ListRow title="人物状态" description="林照仍持有旧地图" selected /><ListRow title="伏笔" description="铜钥匙尚未回收" /></Pane></div>
        </div>
      </GallerySection>

      <GallerySection title="卡片、列表与状态" description="业务可以组合语义，不再创造新的卡片皮肤。">
        <div className="ui-gallery-grid">
          <Sample title="卡片"><div className="ui-gallery-stack"><Card title="普通卡片" description="用于明确分组">正文和工具使用不同表面。</Card><Card variant="selectable" selected title="可选择卡片">已选中状态同时使用边框和底色。</Card><Card variant="metric" title="今日净新增"><strong className="ui-type-title">1,842</strong></Card></div></Sample>
          <Sample title="列表行"><div className="ui-gallery-stack"><ListRow title="第一场 · 码头" description="草稿 · 林照" meta="1,120 字" icon={<FileText size={16} />} selected /><ListRow title="第二场 · 旧仓库" description="想法 · 沈砚" meta="430 字" icon={<FileText size={16} />} /><div role="tree" aria-label="示例章节"><TreeRow title="第三章 未寄出的信" meta="3 场" level={2} /></div></div></Sample>
          <Sample title="徽标"><div className="ui-gallery-row"><Badge>草稿</Badge><Badge tone="success">已保存</Badge><Badge tone="warning">待复核</Badge><Badge tone="danger">有冲突</Badge><Badge tone="info">仅本地</Badge></div></Sample>
          <Sample title="行内反馈"><div className="ui-gallery-stack"><InlineNotice tone="success" title="已安全保存">本次修改已经写入本机快照。</InlineNotice><InlineNotice tone="warning" title="两项设定待复核">不会自动写入正典，请逐条决定。</InlineNotice><InlineNotice tone="danger" title="导出被阻塞">发现一个未闭合章节标题。</InlineNotice></div></Sample>
        </div>
      </GallerySection>

      <GallerySection title="弹层与菜单" description="焦点约束、Esc 关闭、键盘导航与浮层定位由成熟行为层处理。">
        <Sample title="交互样例"><div className="ui-gallery-row"><Button onClick={() => setDialogOpen(true)}>打开对话框</Button><Button variant="ghost" onClick={() => setDrawerOpen(true)}>打开详情栏</Button><Popover trigger={<Button variant="ghost" trailingIcon={<ChevronDown size={15} />}>上下文胶囊</Button>}><strong>本次将读取 3 项内容</strong><p className="ui-type-caption">当前场景、林照的当前状态、最近一次钥匙流转。</p></Popover><DropdownMenu trigger={<IconButton label="更多操作"><MoreHorizontal size={18} /></IconButton>} items={[{ id: 'rename', label: '重命名' }, { id: 'move', label: '移动到', children: [{ id: 'volume-1', label: '第一卷', selected: true }, { id: 'volume-2', label: '第二卷' }] }, { id: 'delete', label: '移到回收站', icon: <Trash2 size={15} />, danger: true }]} /></div></Sample>
        <ModalDialog title="接受事实候选" description="接受后将更新当前场景之后的正典状态。" open={dialogOpen} onOpenChange={setDialogOpen} footer={<><Button variant="ghost" onClick={() => setDialogOpen(false)}>取消</Button><Button variant="primary" onClick={() => setDialogOpen(false)}>接受候选</Button></>}><InlineNotice tone="info" title="佩剑持有者变化">沈砚 → 林照，自第 39 章起生效。</InlineNotice></ModalDialog>
        <Drawer title="正典详情" description="当前场景可见状态" open={drawerOpen} onOpenChange={setDrawerOpen}><div className="ui-gallery-stack"><Card title="林照"><p className="ui-type-body">持有旧地图与沈砚的佩剑。</p></Card><Button variant="primary">查看证据</Button></div></Drawer>
      </GallerySection>

      <GallerySection title="空、加载、失败与通知" description="所有流程都必须设计非理想状态。">
        <div className="ui-gallery-grid"><Sample title="空状态"><EmptyState title="故事还没开始" description="新建一个空白项目，或把旧稿带进来。" action={<Button variant="primary">写第一个故事</Button>} /></Sample><Sample title="加载与失败"><div className="ui-gallery-stack"><LoadingState label="正在整理书稿…" /><ErrorState description="本地服务没有响应，稿件未被修改。" onRetry={() => undefined} /><Skeleton lines={4} /></div></Sample></div>
        {toastOpen && <div className="ui-toast-position"><ToastNotice tone="success" onClose={() => setToastOpen(false)}>显示设置已保存在本设备</ToastNotice></div>}
      </GallerySection>
    </div>
  </main>
}

function GallerySection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="ui-gallery-section"><header><h2>{title}</h2><p>{description}</p></header>{children}</section>
}

function Sample({ title, children }: { title: string; children: React.ReactNode }) {
  return <article className="ui-gallery-sample"><h3>{title}</h3>{children}</article>
}
