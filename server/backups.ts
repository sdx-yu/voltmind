import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AppDatabase } from './db.js'

export function createDatabaseSnapshot(database: AppDatabase, dataDir: string): string {
  const backupDir = path.join(dataDir, 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  database.checkpoint()
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
  const target = path.join(backupDir, `bibudai-${stamp}.sqlite`)
  const temporary = `${target}.partial`
  fs.copyFileSync(database.databasePath, temporary)
  const check = new DatabaseSync(temporary, { readOnly: true })
  try {
    const result = check.prepare('PRAGMA integrity_check').get() as Record<string, unknown>
    if (result.integrity_check !== 'ok') throw new Error(`Backup integrity check failed: ${String(result.integrity_check)}`)
  } finally {
    check.close()
    for (const sidecar of [`${temporary}-wal`, `${temporary}-shm`]) if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar)
  }
  fs.renameSync(temporary, target)
  rotateSnapshots(backupDir)
  return target
}

export function rotateSnapshots(backupDir: string) {
  for (const name of fs.readdirSync(backupDir).filter((item) => item.includes('.partial-') || item.endsWith('.partial'))) fs.unlinkSync(path.join(backupDir, name))
  const files = fs.readdirSync(backupDir).filter((name) => /^bibudai-\d{4}-\d{2}-\d{2}T.*\.sqlite$/.test(name)).sort().reverse()
  const keep = new Set(files.slice(0, 20))
  const days = new Set<string>()
  for (const file of files) {
    const day = file.slice(8, 18)
    if (days.size < 7 && !days.has(day)) { days.add(day); keep.add(file) }
  }
  for (const file of files) if (!keep.has(file)) fs.unlinkSync(path.join(backupDir, file))
  const migrations = fs.readdirSync(backupDir).filter((name) => /^pre-migration-v\d+-to-v\d+-.+\.sqlite$/.test(name)).sort().reverse()
  for (const file of migrations.slice(6)) fs.unlinkSync(path.join(backupDir, file))
}

export interface DatabaseSnapshot {
  fileName: string
  createdAt: string
  byteSize: number
  integrity: 'ok' | 'failed'
}

export function listDatabaseSnapshots(dataDir: string): DatabaseSnapshot[] {
  const backupDir = path.join(dataDir, 'backups')
  if (!fs.existsSync(backupDir)) return []
  return fs.readdirSync(backupDir)
    .filter(isSnapshotFileName)
    .map((fileName) => {
      const fullPath = path.join(backupDir, fileName)
      const stat = fs.statSync(fullPath)
      return {
        fileName,
        createdAt: stat.mtime.toISOString(),
        byteSize: stat.size,
        integrity: checkDatabaseFile(fullPath) ? 'ok' as const : 'failed' as const,
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function restoreDatabaseSnapshot(dataDir: string, databasePath: string, fileName: string) {
  if (!isSnapshotFileName(fileName)) throw new Error('无效的快照文件名')
  const source = path.join(dataDir, 'backups', fileName)
  if (!fs.existsSync(source) || !checkDatabaseFile(source)) throw new Error('所选快照不存在或完整性检查失败')

  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const recoveryDir = path.join(dataDir, 'recovery')
  fs.mkdirSync(recoveryDir, { recursive: true })
  const stamp = new Date().toISOString().replaceAll(':', '-')
  const temporary = `${databasePath}.restore-${process.pid}-${Date.now()}`
  fs.copyFileSync(source, temporary)
  if (!checkDatabaseFile(temporary)) { fs.unlinkSync(temporary); throw new Error('恢复副本完整性检查失败') }

  const preserved: string[] = []
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const current = `${databasePath}${suffix}`
      if (!fs.existsSync(current)) continue
      const target = path.join(recoveryDir, `bibudai-corrupt-${stamp}.sqlite${suffix}`)
      fs.renameSync(current, target)
      preserved.push(target)
    }
    fs.renameSync(temporary, databasePath)
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    const main = preserved.find((item) => item.endsWith('.sqlite'))
    if (!fs.existsSync(databasePath) && main && fs.existsSync(main)) fs.renameSync(main, databasePath)
    throw error
  }
  return { restoredFrom: fileName, preserved, integrity: 'ok' as const }
}

function isSnapshotFileName(fileName: string) {
  return /^(?:bibudai-\d{4}-\d{2}-\d{2}T.+|pre-migration-v\d+-to-v\d+-.+)\.sqlite$/.test(fileName) && !fileName.includes('/') && !fileName.includes('\\')
}

function checkDatabaseFile(filePath: string) {
  let check: DatabaseSync | null = null
  try {
    check = new DatabaseSync(filePath, { readOnly: true })
    const result = check.prepare('PRAGMA integrity_check').get() as Record<string, unknown>
    return result.integrity_check === 'ok'
  } catch {
    return false
  } finally {
    try { check?.close() } catch { /* invalid databases may fail while closing */ }
    for (const sidecar of [`${filePath}-wal`, `${filePath}-shm`]) if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar)
  }
}
