import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`Windows CI 构建只允许在 Windows x64 运行，当前为 ${process.platform}-${process.arch}`)
}

const thumbprint = (process.env.WINDOWS_CERTIFICATE_THUMBPRINT ?? '').replaceAll(' ', '').toUpperCase()
const timestampUrl = process.env.WINDOWS_TIMESTAMP_URL ?? ''
if (thumbprint && !/^[A-F0-9]{40}$/.test(thumbprint)) throw new Error('WINDOWS_CERTIFICATE_THUMBPRINT 格式无效')
if (thumbprint && !/^https:\/\//i.test(timestampUrl)) throw new Error('签名构建必须配置 HTTPS 时间戳地址')

const npmCli = process.env.npm_execpath
if (!npmCli || !fs.existsSync(npmCli)) throw new Error('缺少 npm CLI 路径；请通过 npm run desktop:build:windows-ci 启动构建')
run(process.execPath, [npmCli, 'run', 'desktop:prepare'])

const tooling = path.join(root, '.tooling')
fs.mkdirSync(tooling, { recursive: true })
const override = path.join(tooling, 'tauri.windows.ci.json')
const windows = { digestAlgorithm: 'sha256' }
if (thumbprint) Object.assign(windows, { certificateThumbprint: thumbprint, timestampUrl })
fs.writeFileSync(override, `${JSON.stringify({ bundle: { targets: ['nsis', 'msi'], windows } }, null, 2)}\n`, { mode: 0o600 })

const tauriCli = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
run(process.execPath, [
  tauriCli, 'build', '--bundles', 'nsis,msi',
  '--config', path.join(root, 'src-tauri', 'tauri.windows.conf.json'),
  '--config', override,
])

const bundleRoot = path.join(root, 'src-tauri', 'target', 'release', 'bundle')
const nsis = findFiles(path.join(bundleRoot, 'nsis'), (file) => file.endsWith('-setup.exe'))
const msi = findFiles(path.join(bundleRoot, 'msi'), (file) => file.endsWith('.msi'))
if (nsis.length !== 1 || msi.length !== 1) {
  throw new Error(`Windows 安装包数量异常：NSIS=${nsis.length}，MSI=${msi.length}`)
}
process.stdout.write(`Windows installers ready:\n- ${path.relative(root, nsis[0])}\n- ${path.relative(root, msi[0])}\n`)

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} 执行失败，退出码 ${result.status}`)
}

function findFiles(directory, predicate) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(directory, entry.name))
    .filter(predicate)
}
