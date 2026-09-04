import fs from 'node:fs'
import path from 'node:path'
import type { AppConfig } from './config.js'
import type { AppDatabase } from './db.js'
import { listDatabaseSnapshots } from './backups.js'

export type TrashRetentionDays = 30 | 90 | null

export interface StoragePolicy {
  trashRetentionDays: TrashRetentionDays
}

export interface StorageStatus {
  databaseByteSize: number
  backupByteSize: number
  backupCount: number
  trashEstimatedByteSize: number
  trashCount: number
  trashRetentionDays: TrashRetentionDays
  libraryPresent: boolean
  availableByteSize: number
}

const POLICY_FILE = 'storage-policy.json'
const LIBRARY_MARKER_FILE = '.library-state.json'
const DEFAULT_POLICY: StoragePolicy = { trashRetentionDays: null }

export function assertLibraryCanOpen(config: AppConfig) {
  if (fs.existsSync(config.databasePath)) return
  const markerExists = fs.existsSync(path.join(config.dataDir, LIBRARY_MARKER_FILE))
  const snapshotsExist = listDatabaseSnapshots(config.dataDir).length > 0
  if (markerExists || snapshotsExist) throw new Error('资料库文件已从本机移除；已阻止创建空资料库，请从本地快照恢复')
}

export function ensureLibraryMarker(config: AppConfig) {
  const markerPath = path.join(config.dataDir, LIBRARY_MARKER_FILE)
  if (fs.existsSync(markerPath)) return
  writeJsonAtomic(markerPath, {
    version: 1,
    databaseFile: path.basename(config.databasePath),
    createdAt: new Date().toISOString(),
  })
}

export function isLibraryPresent(config: AppConfig) {
  return fs.existsSync(config.databasePath)
}

export function readStoragePolicy(dataDir: string): StoragePolicy {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(dataDir, POLICY_FILE), 'utf8')) as Partial<StoragePolicy>
    return { trashRetentionDays: value.trashRetentionDays === 30 || value.trashRetentionDays === 90 ? value.trashRetentionDays : null }
  } catch {
    return { ...DEFAULT_POLICY }
  }
}

export function writeStoragePolicy(dataDir: string, policy: StoragePolicy) {
  if (policy.trashRetentionDays !== null && policy.trashRetentionDays !== 30 && policy.trashRetentionDays !== 90) throw new Error('不支持的回收站保留时间')
  writeJsonAtomic(path.join(dataDir, POLICY_FILE), policy)
  return policy
}

export function storageStatus(database: AppDatabase, config: AppConfig): StorageStatus {
  const snapshots = listDatabaseSnapshots(config.dataDir)
  const trash = database.listProjectTrash()
  return {
    databaseByteSize: fileSize(config.databasePath),
    backupByteSize: snapshots.reduce((sum, item) => sum + item.byteSize, 0),
    backupCount: snapshots.length,
    trashEstimatedByteSize: trash.reduce((sum, item) => sum + item.estimatedByteSize, 0),
    trashCount: trash.length,
    trashRetentionDays: readStoragePolicy(config.dataDir).trashRetentionDays,
    libraryPresent: isLibraryPresent(config),
    availableByteSize: availableBytes(config.dataDir),
  }
}

export function expiredTrashIds(database: AppDatabase, retentionDays: TrashRetentionDays, at = Date.now()) {
  if (retentionDays === null) return []
  const cutoff = at - retentionDays * 24 * 60 * 60 * 1000
  return database.listProjectTrash()
    .filter((project) => project.deletedAt && Date.parse(project.deletedAt) <= cutoff)
    .map((project) => project.id)
}

function fileSize(filePath: string) {
  try { return fs.statSync(filePath).size } catch { return 0 }
}

function availableBytes(directory: string) {
  try {
    const stats = fs.statfsSync(directory)
    return Number(stats.bavail) * Number(stats.bsize)
  } catch { return 0 }
}

function writeJsonAtomic(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.partial-${process.pid}-${Date.now()}`
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}
