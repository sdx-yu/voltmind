import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolveNodeRuntime } from './node-runtime-core.mjs'

const root = process.cwd()
const spec = resolveNodeRuntime(root, process.platform, process.arch)
if (fs.existsSync(spec.runtimeExecutable)) process.exit(0)

const baseUrl = `https://nodejs.org/dist/v${spec.version}`
const staging = path.join(root, '.tooling', 'node-download')
fs.mkdirSync(staging, { recursive: true })
const archivePath = path.join(staging, spec.archiveName)
const [checksums, archive] = await Promise.all([
  fetch(`${baseUrl}/SHASUMS256.txt`).then(assertResponse).then((response) => response.text()),
  fetch(`${baseUrl}/${spec.archiveName}`).then(assertResponse).then((response) => response.arrayBuffer()),
])
fs.writeFileSync(archivePath, new Uint8Array(archive))
const expected = checksums.split('\n').find((line) => line.endsWith(`  ${spec.archiveName}`))?.split(/\s+/)[0]
const actual = createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex')
if (!expected || actual !== expected) throw new Error(`Node 运行时 SHA-256 校验失败：${spec.archiveName}`)
execFileSync('tar', spec.tarArgs(archivePath, staging), { stdio: 'inherit' })
fs.renameSync(path.join(staging, spec.folderName), spec.runtimeDir)
fs.writeFileSync(path.join(spec.runtimeDir, '.verified-runtime.json'), `${JSON.stringify({
  version: spec.version,
  platform: spec.platform,
  arch: spec.arch,
  archive: spec.archiveName,
  sha256: actual,
}, null, 2)}\n`)
fs.unlinkSync(archivePath)
process.stdout.write(`Verified Node runtime ${spec.version} for ${spec.platform}-${spec.arch} (${actual})\n`)

function assertResponse(response) {
  if (!response.ok) throw new Error(`下载 Node 运行时失败：HTTP ${response.status}`)
  return response
}
