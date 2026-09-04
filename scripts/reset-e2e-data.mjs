import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const dataDir = path.resolve(root, '.ui-e-data')

if (path.dirname(dataDir) !== root || path.basename(dataDir) !== '.ui-e-data') {
  throw new Error(`拒绝清理非标准 E2E 数据目录：${dataDir}`)
}

fs.rmSync(dataDir, { recursive: true, force: true })
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
process.stdout.write(`已重建专用 E2E 数据目录：${path.relative(root, dataDir)}\n`)
