import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const tokens = readFileSync(join(root, 'src/ui/tokens.css'), 'utf8')
const foundations = readFileSync(join(root, 'src/ui/foundations.css'), 'utf8')
const templates = readFileSync(join(root, 'src/ui/templates.css'), 'utf8')
const legacy = readFileSync(join(root, 'src/styles.css'), 'utf8')
const errors = []

const paper = declarations(block(/:root,\s*\[data-theme="paper"\]\s*\{([\s\S]*?)\n\}/))
const themes = {
  paper,
  night: { ...paper, ...declarations(block(/\[data-theme="night"\]\s*\{([\s\S]*?)\n\}/)) },
  'high-contrast': { ...paper, ...declarations(block(/\[data-theme="high-contrast"\]\s*\{([\s\S]*?)\n\}/)) },
}

const contrastPairs = [
  ['--text-primary', '--surface-canvas', 4.5],
  ['--text-primary', '--surface-paper', 4.5],
  ['--text-secondary', '--surface-canvas', 4.5],
  ['--text-secondary', '--surface-paper', 4.5],
  ['--text-secondary', '--surface-sunken', 4.5],
  ['--brand-accent', '--surface-canvas', 4.5],
  ['--text-inverse', '--action-primary', 4.5],
  ['--status-danger', '--status-danger-surface', 4.5],
  ['--status-warning', '--status-warning-surface', 4.5],
  ['--focus-ring', '--surface-canvas', 3],
]

const ratios = {}
for (const [theme, vars] of Object.entries(themes)) {
  ratios[theme] = {}
  for (const [foreground, background, minimum] of contrastPairs) {
    const ratio = contrast(resolve(foreground, vars), resolve(background, vars))
    ratios[theme][`${foreground}/${background}`] = Number(ratio.toFixed(2))
    if (ratio < minimum) errors.push(`${theme} ${foreground} / ${background} 对比度 ${ratio.toFixed(2)} 低于 ${minimum}:1`)
  }
}

const styles = `${legacy}\n${foundations}\n${templates}`
const undersized = [
  ...styles.matchAll(/font-size:\s*(8|9|10|11)px\b/g),
  ...styles.matchAll(/font:\s*[^;{}]*?\b(8|9|10|11)px\b/g),
]
if (undersized.length) errors.push(`仍有 ${undersized.length} 处关键字体低于 12px`)
if (!foundations.includes('*:focus-visible') || !foundations.includes('--focus-ring')) errors.push('缺少全局可见焦点规则')
if (!foundations.includes('prefers-reduced-motion') || !templates.includes('prefers-reduced-motion')) errors.push('基础层或模板层缺少减少动态效果规则')
if (!foundations.includes('[data-density="touch"]') || !foundations.includes('2.75rem')) errors.push('触控密度未冻结 44px 控件高度')

if (errors.length) {
  console.error('UI quality check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(`UI quality check passed: ${JSON.stringify({ themes: Object.keys(themes).length, contrastPairs: contrastPairs.length, minimumFontPx: 12, ratios })}`)

function block(pattern) { const match = tokens.match(pattern); if (!match) throw new Error(`无法解析 tokens.css: ${pattern}`); return match[1] }
function declarations(source) { return Object.fromEntries([...source.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()])) }
function resolve(name, vars, seen = new Set()) {
  if (seen.has(name)) throw new Error(`变量循环：${name}`)
  seen.add(name)
  const value = vars[name]
  if (!value) throw new Error(`缺少颜色变量：${name}`)
  const reference = value.match(/^var\((--[\w-]+)\)$/)?.[1]
  if (reference) return resolve(reference, vars, seen)
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value
  throw new Error(`质量门暂不支持的颜色表达式：${name}=${value}`)
}
function contrast(a, b) { const [la, lb] = [a, b].map(luminance); return (Math.max(la, lb) + .05) / (Math.min(la, lb) + .05) }
function luminance(hex) { const value = hex.slice(1); const full = value.length === 3 ? [...value].map((char) => char + char).join('') : value.slice(0, 6); const rgb = [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16) / 255).map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4); return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2] }
