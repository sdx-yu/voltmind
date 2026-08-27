import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

export function run(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    timeout: options.timeout,
  })
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
    error: result.error?.message,
  }
}

export function sourceRevision(root) {
  const result = run('git', ['rev-parse', 'HEAD'], { cwd: root })
  return result.ok ? result.stdout : 'unknown'
}

export function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function findFiles(root, predicate) {
  if (!fs.existsSync(root)) return []
  const found = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) found.push(...findFiles(file, predicate))
    else if (predicate(file)) found.push(file)
  }
  return found
}

export function outputPathFromArgs(root, defaultName) {
  const index = process.argv.indexOf('--output')
  return index >= 0 && process.argv[index + 1]
    ? path.resolve(process.argv[index + 1])
    : path.join(root, '.tooling', 'evidence', defaultName)
}

export function writeEvidence(file, evidence) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  try { fs.chmodSync(file, 0o600) } catch { /* Windows ACLs are not POSIX modes. */ }
  process.stdout.write(`${evidence.status}: ${file}\n`)
}

export function artifactEvidence(files, root) {
  return files.map((file) => ({
    path: path.relative(root, file),
    bytes: fs.statSync(file).size,
    sha256: sha256(file),
  }))
}
