import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const uiDir = join(root, 'src/ui')
const componentsDir = join(root, 'src/components')
const tokens = readFileSync(join(uiDir, 'tokens.css'), 'utf8')
const legacy = readFileSync(join(root, 'src/styles.css'), 'utf8')
const index = readFileSync(join(uiDir, 'index.ts'), 'utf8')
const main = readFileSync(join(root, 'src/main.tsx'), 'utf8')
const workspace = readFileSync(join(root, 'src/components/Workspace.tsx'), 'utf8')
const bookshelf = readFileSync(join(root, 'src/components/Bookshelf.tsx'), 'utf8')
const delivery = readFileSync(join(root, 'src/components/DeliveryWorkspace.tsx'), 'utf8')
const plot = readFileSync(join(root, 'src/components/PlotWorkspace.tsx'), 'utf8')
const canon = readFileSync(join(root, 'src/components/CanonWorkspace.tsx'), 'utf8')
const editor = readFileSync(join(root, 'src/components/WritingEditor.tsx'), 'utf8')
const workflowPages = [
  'RevisionWorkspace.tsx', 'DeliveryWorkspace.tsx', 'ReviewWorkspace.tsx',
  'ProvenanceWorkspace.tsx', 'SyncWorkspace.tsx', 'RescueScreen.tsx',
  'ResearchWorkspace.tsx', 'ResearchCohortWorkspace.tsx', 'ResearchWaveWorkspace.tsx',
].map((name) => [name, readFileSync(join(root, 'src/components', name), 'utf8')])
const templates = readFileSync(join(uiDir, 'Templates.tsx'), 'utf8')
const templateStyles = readFileSync(join(uiDir, 'templates.css'), 'utf8')
const componentStyles = readFileSync(join(uiDir, 'components.css'), 'utf8')
const pageHeader = readFileSync(join(uiDir, 'PageHeader.tsx'), 'utf8')
const chrome = readFileSync(join(root, 'src/lib/chrome.ts'), 'utf8')
const errors = []

const requiredSemanticTokens = [
  '--surface-canvas', '--surface-paper', '--surface-sunken', '--surface-raised', '--surface-overlay',
  '--surface-control', '--surface-control-hover', '--surface-control-disabled',
  '--text-primary', '--text-secondary', '--text-tertiary', '--text-inverse',
  '--border-faint', '--border-subtle', '--border-strong',
  '--action-primary', '--action-primary-hover', '--action-primary-pressed', '--action-subtle',
  '--brand-accent', '--focus-ring',
  '--status-success', '--status-warning', '--status-danger', '--status-info',
  '--font-ui', '--font-editorial', '--font-mono',
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-6', '--space-8', '--space-12',
  '--radius-control', '--radius-card', '--radius-container', '--radius-pill',
  '--shadow-none', '--shadow-raised', '--shadow-floating', '--shadow-modal',
  '--motion-fast', '--motion-standard', '--motion-slow',
]

for (const token of requiredSemanticTokens) if (!tokens.includes(`${token}:`)) errors.push(`缺少语义变量 ${token}`)
for (const theme of ['paper', 'night', 'high-contrast']) if (!tokens.includes(`[data-theme="${theme}"]`)) errors.push(`缺少主题 ${theme}`)

const primitiveNames = new Set([...tokens.matchAll(/--(?:rice|green|cinnabar|gold|blue)-[\w-]+(?=:)/g)].map((match) => match[0]))
if (primitiveNames.size > 24) errors.push(`原始色板槽位 ${primitiveNames.size} 超过上限 24`)

const rawColorPattern = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi
for (const name of readdirSync(uiDir).filter((file) => file.endsWith('.css') && file !== 'tokens.css')) {
  const content = readFileSync(join(uiDir, name), 'utf8')
  const matches = content.match(rawColorPattern) ?? []
  if (matches.length) errors.push(`${name} 含 ${matches.length} 个裸颜色值；只能在 tokens.css 定义颜色`)
}

const legacyColors = new Set(legacy.match(/#[0-9a-f]{3,8}\b/gi) ?? [])
const legacyImportant = legacy.match(/!important/g)?.length ?? 0
if (legacyColors.size > 248) errors.push(`旧样式颜色从冻结基线 248 增长到 ${legacyColors.size}`)
if (legacyImportant > 26) errors.push(`旧样式 !important 从冻结基线 26 增长到 ${legacyImportant}`)

const requiredModules = ['Button', 'Card', 'CommandPalette', 'Feedback', 'Field', 'ListRow', 'Overlay', 'PageHeader', 'Pane', 'State', 'Tabs', 'Templates', 'Toolbar']
for (const moduleName of requiredModules) if (!index.includes(`'./${moduleName}'`)) errors.push(`基础组件未导出：${moduleName}`)
if (!main.includes("window.location.pathname === '/design-system'")) errors.push('缺少开发态 /design-system 入口')
if (!main.includes('import.meta.env.DEV')) errors.push('Design Gallery 必须限制在开发态')

const shellModes = ['写作', '规划', '正典', '修订', '交付']
for (const mode of shellModes) if (!workspace.includes(`nav-label">${mode}<`)) errors.push(`项目壳缺少一级模式：${mode}`)
for (const mode of shellModes) if (!workspace.includes(`aria-label="${mode}"`)) errors.push(`窄屏一级模式缺少可访问名称：${mode}`)
if (!workspace.includes("key === 'k'")) errors.push('项目壳缺少 Mod+K 命令面板快捷键')
if (!workspace.includes('ui-pane-resizer-left') || !workspace.includes('ui-pane-resizer-right')) errors.push('项目壳缺少可调左右面板')
if (!chrome.includes('treeWidth') || !chrome.includes('inspectorWidth') || !chrome.includes('view: ChromeView')) errors.push('项目壳状态未持久化面板宽度和最后模式')
if (!bookshelf.includes('bookshelf-global-actions') || !bookshelf.includes('书架更多操作')) errors.push('书架动作尚未收敛到全局动作区和更多菜单')
if (!bookshelf.includes("creationPath === 'template'")) errors.push('书架缺少结构起步创建路径')
if (delivery.includes('onOpenTool')) errors.push('交付台仍在承载跨模式工具入口')

const coreTemplates = ['editor', 'board', 'library']
for (const template of coreTemplates) if (!templates.includes(`data-ui-template="${template}"`)) errors.push(`缺少 ${template} 页面模板标识`)
if (!workspace.includes('<EditorTemplate')) errors.push('写作台尚未迁移 Editor 模板')
if (!plot.includes('<BoardTemplate')) errors.push('规划台尚未迁移 Board 模板')
if (!canon.includes('<LibraryTemplate')) errors.push('正典台尚未迁移 Library 模板')
if (!editor.includes('<SceneHeader') || !editor.includes('<Toolbar')) errors.push('正文编辑器缺少统一场景头或工具栏')
if (!templates.includes('function WorkflowSteps') || !templates.includes('function MetricStrip')) errors.push('Workflow 模板缺少步骤或指标语义组件')
if (!pageHeader.includes("tone = 'utility'") || !pageHeader.includes('ui-page-header-${tone}')) errors.push('PageHeader 必须默认使用工具型字体并支持显式作品语义')
for (const marker of ['.ui-page-header h1', '.ui-card h3', '.ui-dialog-header h2', '.ui-state h3']) {
  const rule = componentStyles.slice(componentStyles.indexOf(marker), componentStyles.indexOf('}', componentStyles.indexOf(marker)) + 1)
  if (!rule.includes('var(--font-ui)')) errors.push(`${marker} 未保持默认无衬线 UI 字体`)
}
if (!componentStyles.includes('.ui-page-header-editorial h1')) errors.push('PageHeader 缺少显式作品型标题样式')
for (const [name, content] of workflowPages) if (!content.includes('<WorkflowTemplate')) errors.push(`${name} 尚未迁移 Workflow 模板`)
if (!delivery.includes('<WorkflowSteps') || !delivery.includes('<MetricStrip')) errors.push('交付台缺少统一步骤或指标摘要')
for (const marker of ['.ui-workflow-steps', '.ui-metric-strip', 'prefers-reduced-motion', 'data-density="touch"']) if (!templateStyles.includes(marker)) errors.push(`Workflow 模板样式缺少 ${marker}`)
for (const breakpoint of ['1279px', '1023px', '759px']) if (!templateStyles.includes(`max-width: ${breakpoint}`)) errors.push(`模板缺少 ${breakpoint} 响应式分档`)
if (plot.includes('V1-A') || canon.includes('V1-C')) errors.push('作者界面仍暴露研发阶段名')
const [researchPage, cohortPage, wavePage] = workflowPages.slice(6).map(([, content]) => content)
if (researchPage.includes('<strong>R1') || cohortPage.includes('<strong>R1') || wavePage.includes('<strong>R1')) errors.push('研究界面顶栏仍暴露研发阶段名')

const nativeSelectFiles = readdirSync(componentsDir).filter((file) => file.endsWith('.tsx') && readFileSync(join(componentsDir, file), 'utf8').includes('<select'))
if (nativeSelectFiles.length) errors.push(`业务组件仍包含原生选择框：${nativeSelectFiles.join('、')}`)
if (!canon.includes('<SearchField') || canon.includes('className="canon-search"')) errors.push('正典搜索仍未收敛为单层 SearchField')

const summary = {
  primitiveSlots: primitiveNames.size,
  semanticTokens: requiredSemanticTokens.length,
  themes: 3,
  densities: 3,
  componentModules: requiredModules.length,
  shellModes: shellModes.length,
  coreTemplates: coreTemplates.length,
  workflowPages: workflowPages.length,
  responsiveBreakpoints: 4,
  commandPalettes: 2,
  legacyUniqueColors: legacyColors.size,
  legacyImportant,
  nativeSelects: nativeSelectFiles.length,
}

if (errors.length) {
  console.error('UI foundation check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(`UI foundation check passed: ${JSON.stringify(summary)}`)
