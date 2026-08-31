import { useEffect, useState } from 'react'
import { Bot, CheckCircle2, CircleAlert, CircleHelp, CloudOff, Cpu, DatabaseBackup, Goal, KeyRound, MonitorCog, ShieldCheck, WalletCards } from 'lucide-react'
import { api } from '../lib/api'
import { applyDisplay, readDisplay, saveDisplay, type DisplayDensity, type DisplayTheme } from '../lib/display'
import { Modal } from './Modal'
import { SelectControl } from '../ui'

type SettingsTab = 'ai' | 'goals' | 'display' | 'help'
type AiMode = 'demo' | 'ollama'

const OLLAMA_BASE_URL = 'http://127.0.0.1:11434/v1'
const LOCAL_MODELS = [
  { id: 'qwen3.5:4b', label: 'Qwen 3.5 · 4B', note: '推荐，约 3.4 GB，适合 16 GB 内存' },
  { id: 'qwen3.5:9b', label: 'Qwen 3.5 · 9B', note: '效果更强，约 6.6 GB，运行更慢' },
]

export function SettingsModal({ projectId, initialTab = 'ai', onClose, onOpenTool, notify }: { projectId: string; initialTab?: SettingsTab; onClose: () => void; onOpenTool?: (tool: 'provenance' | 'sync') => void; notify: (type: 'success' | 'error', message: string) => void }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [aiMode, setAiMode] = useState<AiMode>('demo')
  const [model, setModel] = useState(LOCAL_MODELS[0].id)
  const [blockedLegacyProvider, setBlockedLegacyProvider] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ status: 'success' | 'error'; message: string } | null>(null)
  const [dailyGoal, setDailyGoal] = useState(2000)
  const [projectGoal, setProjectGoal] = useState(100000)
  const savedDisplay = readDisplay()
  const [fontSize, setFontSize] = useState(savedDisplay.fontSize)
  const [paperWidth, setPaperWidth] = useState(savedDisplay.paperWidth)
  const [lineHeight, setLineHeight] = useState(savedDisplay.lineHeight)
  const [theme, setTheme] = useState<DisplayTheme>(savedDisplay.theme)
  const [density, setDensity] = useState<DisplayDensity>(savedDisplay.density)

  useEffect(() => {
    void api.getAiSettings().then((settings) => {
      setBlockedLegacyProvider(settings.provider === 'blocked')
      setAiMode(settings.provider === 'ollama' ? 'ollama' : 'demo')
      if (settings.provider === 'ollama' && LOCAL_MODELS.some((item) => item.id === settings.model)) setModel(settings.model)
    })
    void api.stats(projectId).then((stats) => { setDailyGoal(stats.dailyGoal); setProjectGoal(stats.projectGoal) })
  }, [projectId])

  function chooseMode(mode: AiMode) {
    setAiMode(mode)
    setTestResult(null)
  }

  async function activateLocalModel() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.testAi({ baseUrl: OLLAMA_BASE_URL, model, apiKey: '' })
      setTestResult({ status: result.ok ? 'success' : 'error', message: result.message })
      if (!result.ok) return
      await api.saveAiSettings({ baseUrl: OLLAMA_BASE_URL, model, apiKey: '' })
      window.dispatchEvent(new CustomEvent('bbd:ai-settings-changed', { detail: { provider: 'ollama', model } }))
      notify('success', `已启用本地免费模型 ${model}`)
      onClose()
    } catch (error) {
      setTestResult({ status: 'error', message: error instanceof Error ? error.message : '连接失败' })
    } finally {
      setTesting(false)
    }
  }

  async function activateDemo() {
    try {
      await api.saveAiSettings({ baseUrl: 'mock://local', model: '笔不怠演示模型', apiKey: '' })
      window.dispatchEvent(new CustomEvent('bbd:ai-settings-changed', { detail: { provider: 'demo', model: '笔不怠演示模型' } }))
      notify('success', '已切换到不联网的演示模式')
      onClose()
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '保存失败')
    }
  }

  async function copyPullCommand() {
    try {
      await navigator.clipboard.writeText(`ollama pull ${model}`)
      notify('success', '模型下载命令已复制')
    } catch {
      notify('error', `请手动复制：ollama pull ${model}`)
    }
  }

  async function saveGoals() {
    try {
      await Promise.all([api.setSetting(projectId, 'dailyGoal', dailyGoal), api.setSetting(projectId, 'projectGoal', projectGoal)])
      notify('success', '写作目标已保存')
      onClose()
    } catch (error) {
      notify('error', error instanceof Error ? error.message : '写作目标保存失败')
    }
  }

  function persistDisplay() {
    saveDisplay({ fontSize, paperWidth, lineHeight, theme, density })
    notify('success', '显示设置已保存在本设备')
    onClose()
  }

  return <Modal title="设置" onClose={onClose} wide>
    <div className="settings-layout">
      <nav>
        <button className={tab === 'ai' ? 'active' : ''} onClick={() => setTab('ai')}><KeyRound size={16} />AI 与隐私</button>
        <button className={tab === 'goals' ? 'active' : ''} onClick={() => setTab('goals')}><Goal size={16} />写作目标</button>
        <button className={tab === 'display' ? 'active' : ''} onClick={() => setTab('display')}><MonitorCog size={16} />显示</button>
        <button className={tab === 'help' ? 'active' : ''} onClick={() => setTab('help')}><CircleHelp size={16} />帮助与恢复</button>
      </nav>
      <section className="settings-content">
        {tab === 'ai' ? <>
          <span className="eyebrow">本地 AI</span>
          <h3>免费使用，稿件留在电脑里</h3>
          <p className="muted">这一版只允许连接本机 Ollama，不接受云端模型地址，也不需要 API Key。</p>

          <div className="zero-cost-banner">
            <WalletCards size={20} />
            <div><strong>API 费用：¥0</strong><span>没有充值入口，不会连接按量计费服务；首次下载模型只占用网络流量和本机磁盘。</span></div>
          </div>

          {blockedLegacyProvider && <p className="test-result error"><CircleAlert size={15} />检测到旧的外网模型设置，已被零费用保护停用。启用下面的本地模型即可替换。</p>}

          <div className="ai-mode-grid">
            <button type="button" className={`ai-mode-card ${aiMode === 'ollama' ? 'active' : ''}`} onClick={() => chooseMode('ollama')}>
              <span className="ai-mode-icon"><Cpu size={20} /></span>
              <span><strong>本地免费模型</strong><small>真实生成 · 不联网计费</small></span>
              {aiMode === 'ollama' && <CheckCircle2 size={17} />}
            </button>
            <button type="button" className={`ai-mode-card ${aiMode === 'demo' ? 'active' : ''}`} onClick={() => chooseMode('demo')}>
              <span className="ai-mode-icon"><Bot size={20} /></span>
              <span><strong>演示模式</strong><small>固定候选 · 无需安装</small></span>
              {aiMode === 'demo' && <CheckCircle2 size={17} />}
            </button>
          </div>

          {aiMode === 'ollama' ? <div className="local-ai-setup">
            <div className="local-ai-steps">
              <span>1</span><div><strong>安装并启动 Ollama</strong><p>从 <a href="https://ollama.com/download" target="_blank" rel="noreferrer">Ollama 官方网站</a>下载安装，软件本身免费。</p></div>
              <span>2</span><div><strong>下载一个本地模型</strong><p>在终端运行下面的命令。模型下载后可离线使用。</p></div>
            </div>
            <label className="local-model-field">本地模型<SelectControl value={model} onChange={(event) => { setModel(event.target.value); setTestResult(null) }}>{LOCAL_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}｜{item.note}</option>)}</SelectControl></label>
            <div className="local-command"><code>ollama pull {model}</code><button type="button" onClick={() => void copyPullCommand()}>复制命令</button></div>
            <div className="privacy-note"><CloudOff size={17} /><div><strong>本机边界</strong><span>连接地址固定为 127.0.0.1；服务端会拦截所有外网模型地址。只有你勾选的上下文会交给本机模型。</span></div></div>
            {testResult && <p className={`test-result ${testResult.status}`}>{testResult.status === 'success' ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}{testResult.message}</p>}
            <div className="modal-actions"><button className="button primary" disabled={testing} onClick={() => void activateLocalModel()}>{testing ? '正在检测本机…' : '检测并启用'}</button></div>
          </div> : <div className="demo-ai-panel">
            <Bot size={22} /><div><strong>先继续使用演示模式</strong><p>它不会调用真正的 AI，只返回固定候选，适合体验流程。</p></div>
            <button className="button secondary" onClick={() => void activateDemo()}>使用演示模式</button>
          </div>}
        </> : tab === 'goals' ? <>
          <span className="eyebrow">写作目标</span><h3>看净新增，不奖励无效操作</h3><p className="muted">今日净新增按当前正文与今日开始前基线计算，粘贴、删除和撤销不会重复累计。</p>
          <div className="form-stack"><label>每日目标（字）<input type="number" min="0" value={dailyGoal} onChange={(event) => setDailyGoal(Number(event.target.value))} /></label><label>项目目标（字）<input type="number" min="0" value={projectGoal} onChange={(event) => setProjectGoal(Number(event.target.value))} /></label><div className="modal-actions"><button className="button primary" onClick={() => void saveGoals()}>保存目标</button></div></div>
        </> : tab === 'display' ? <>
          <span className="eyebrow">本设备显示</span><h3>把纸张调到顺眼</h3><p className="muted">这些设置只保存在当前设备。纸面用系统宋体，不从网络拉字体。</p>
          <div className="form-stack"><label>正文字号：{fontSize}px<input type="range" min="15" max="24" value={fontSize} onChange={(event) => { const next = Number(event.target.value); setFontSize(next); applyDisplay({ fontSize: next, paperWidth, lineHeight, theme, density }) }} /></label><label>纸张宽度：{paperWidth}px<input type="range" min="600" max="980" step="20" value={paperWidth} onChange={(event) => { const next = Number(event.target.value); setPaperWidth(next); applyDisplay({ fontSize, paperWidth: next, lineHeight, theme, density }) }} /></label><label>行高：{lineHeight.toFixed(1)}<input type="range" min="1.6" max="2.4" step="0.1" value={lineHeight} onChange={(event) => { const next = Number(event.target.value); setLineHeight(next); applyDisplay({ fontSize, paperWidth, lineHeight: next, theme, density }) }} /></label><label>稿纸主题<SelectControl value={theme} onChange={(event) => { const next = event.target.value as DisplayTheme; setTheme(next); applyDisplay({ fontSize, paperWidth, lineHeight, theme: next, density }) }}><option value="paper">宣纸</option><option value="night">夜间稿纸</option><option value="high-contrast">高对比</option></SelectControl></label><label>工具密度<SelectControl value={density} onChange={(event) => { const next = event.target.value as DisplayDensity; setDensity(next); applyDisplay({ fontSize, paperWidth, lineHeight, theme, density: next }) }}><option value="comfortable">舒适</option><option value="compact">紧凑</option><option value="touch">触控</option></SelectControl></label><div className="modal-actions"><button className="button primary" onClick={persistDisplay}>应用并保存</button></div></div>
        </> : <>
          <span className="eyebrow">帮助与恢复</span><h3>恢复优先，正文不进诊断</h3>
          <div className="help-cards"><article><DatabaseBackup size={19}/><div><strong>日常备份</strong><p>交付页可导出完整离线备份；系统启动、退出和每 10 分钟也会生成校验过的数据库快照。</p></div></article><article><ShieldCheck size={19}/><div><strong>异常救援</strong><p>数据库损坏时会停止常规写入并进入救援模式。只选择标记“完整”的快照；损坏原件会移入 recovery，不会删除。</p></div></article><article><CloudOff size={19}/><div><strong>反馈故障</strong><p>提供版本、系统、项目规模和操作步骤即可。不要直接发送正文、API Key 或整个数据目录；必要时先导出脱敏样本。</p></div></article></div>
          <div className="tool-links">{onOpenTool && <><button className="button secondary" onClick={() => onOpenTool('provenance')}>打开创作来源</button><button className="button ghost" onClick={() => onOpenTool('sync')}>打开本地加密接力（实验）</button></>}</div><p className="form-hint">创作来源通过修订台或这里进入；本地加密接力也可从顶栏、命令面板或这里进入。两者均不上传正文，接力依靠手动交换加密文件。</p>
        </>}
      </section>
    </div>
  </Modal>
}
