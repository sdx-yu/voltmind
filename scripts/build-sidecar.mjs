import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { resolveNodeRuntime } from './node-runtime-core.mjs'

const root = process.cwd()
const runtimeNode = resolveNodeRuntime(root, process.platform, process.arch).runtimeExecutable
if (!fs.existsSync(runtimeNode)) throw new Error('缺少已校验的 Node 官方运行时，请先执行 scripts/fetch-node-runtime.mjs')
const staging = path.join(root, '.tooling', 'sidecar')
const binaries = path.join(root, 'src-tauri', 'binaries')
fs.mkdirSync(staging, { recursive: true })
fs.mkdirSync(binaries, { recursive: true })

const bundled = path.join(staging, 'server.cjs')
await build({
  entryPoints: [path.join(root, 'server', 'index.ts')],
  outfile: bundled,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
})

const blob = path.join(staging, 'server.blob')
const seaConfig = path.join(staging, 'sea-config.json')
fs.writeFileSync(seaConfig, JSON.stringify({
  main: bundled,
  output: blob,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
}, null, 2))
execFileSync(runtimeNode, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' })

const triple = process.platform === 'darwin'
  ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
  : process.platform === 'win32'
    ? `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`
    : `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-gnu`
const extension = process.platform === 'win32' ? '.exe' : ''
const target = path.join(binaries, `bibudai-server-${triple}${extension}`)
if (fs.existsSync(target)) { fs.chmodSync(target, 0o755); fs.unlinkSync(target) }
fs.copyFileSync(runtimeNode, target)
if (process.platform !== 'win32') fs.chmodSync(target, 0o755)
if (process.platform === 'darwin') {
  try { execFileSync('codesign', ['--remove-signature', target], { stdio: 'ignore' }) } catch { /* unsigned node binaries need no removal */ }
}
const postject = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'postject.cmd' : 'postject')
const args = [target, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2']
if (process.platform === 'darwin') args.push('--macho-segment-name', 'NODE_SEA')
execFileSync(postject, args, { stdio: 'inherit' })
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', '--force', target], { stdio: 'inherit' })
process.stdout.write(`Sidecar: ${target}\n`)
