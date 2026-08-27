import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const root = process.cwd()
const releaseDir = path.join(root, 'release')
const manifest = path.join(releaseDir, 'SHA256SUMS')
const files = fs.readdirSync(releaseDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name !== 'SHA256SUMS')
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, 'zh-CN'))
const lines = files.map((name) => {
  const sha256 = createHash('sha256').update(fs.readFileSync(path.join(releaseDir, name))).digest('hex')
  return `${sha256}  release/${name}`
})
fs.writeFileSync(manifest, `${lines.join('\n')}\n`)
process.stdout.write(`Recorded ${files.length} release artifact checksums in ${path.relative(root, manifest)}\n`)
