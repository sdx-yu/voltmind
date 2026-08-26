import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const version = '24.10.0'
const platform = process.platform
const arch = process.arch
if (platform !== 'darwin' || !['arm64', 'x64'].includes(arch)) {
  throw new Error(`RC1 目前只封装 macOS arm64/x64 sidecar；当前平台为 ${platform}-${arch}`)
}
const root = process.cwd()
const runtimeDir = path.join(root, '.tooling', 'node-runtime')
const runtimeNode = path.join(runtimeDir, 'bin', 'node')
if (fs.existsSync(runtimeNode)) process.exit(0)

const platformArch = `darwin-${arch}`
const archiveName = `node-v${version}-${platformArch}.tar.gz`
const baseUrl = `https://nodejs.org/dist/v${version}`
const staging = path.join(root, '.tooling', 'node-download')
fs.mkdirSync(staging, { recursive: true })
const archivePath = path.join(staging, archiveName)
const [checksums, archive] = await Promise.all([
  fetch(`${baseUrl}/SHASUMS256.txt`).then(assertResponse).then((response) => response.text()),
  fetch(`${baseUrl}/${archiveName}`).then(assertResponse).then((response) => response.arrayBuffer()),
])
fs.writeFileSync(archivePath, new Uint8Array(archive))
const expected = checksums.split('\n').find((line) => line.endsWith(`  ${archiveName}`))?.split(/\s+/)[0]
const actual = createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex')
if (!expected || actual !== expected) throw new Error(`Node 运行时 SHA-256 校验失败：${archiveName}`)
execFileSync('tar', ['-xzf', archivePath, '-C', staging], { stdio: 'inherit' })
fs.renameSync(path.join(staging, `node-v${version}-${platformArch}`), runtimeDir)
fs.unlinkSync(archivePath)
process.stdout.write(`Verified Node runtime ${version} (${actual})\n`)

function assertResponse(response) {
  if (!response.ok) throw new Error(`下载 Node 运行时失败：HTTP ${response.status}`)
  return response
}
