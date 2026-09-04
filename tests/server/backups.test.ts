// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../../server/db.js'
import { createDatabaseSnapshot, listDatabaseSnapshots, restoreDatabaseSnapshot, rotateSnapshots } from '../../server/backups.js'

describe('automatic database snapshots', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-backups-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('creates an integrity-checked SQLite snapshot', () => {
    const database = new AppDatabase(path.join(dir, 'main.sqlite'))
    database.createProject('快照项目')
    const target = createDatabaseSnapshot(database, dir)
    expect(fs.existsSync(target)).toBe(true)
    const copy = new AppDatabase(target)
    expect(copy.integrityCheck()).toBe('ok')
    expect(copy.listProjects()[0].title).toBe('快照项目')
    copy.close(); database.close()
    expect(fs.readdirSync(path.join(dir, 'backups')).some((name) => name.includes('.partial'))).toBe(false)
  })

  it('retains the newest 20 snapshots plus one daily snapshot for seven days', () => {
    const backupDir = path.join(dir, 'backups'); fs.mkdirSync(backupDir)
    for (let day = 1; day <= 9; day += 1) for (let hour = 0; hour < 3; hour += 1) fs.writeFileSync(path.join(backupDir, `bibudai-2026-08-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}-00-00Z.sqlite`), '')
    rotateSnapshots(backupDir)
    const retained = fs.readdirSync(backupDir)
    expect(retained.length).toBeGreaterThanOrEqual(20)
    expect(new Set(retained.map((name) => name.slice(8, 18))).size).toBeGreaterThanOrEqual(7)
  })

  it('caps pre-migration safety copies independently', () => {
    const backupDir = path.join(dir, 'backups'); fs.mkdirSync(backupDir)
    for (let index = 0; index < 9; index += 1) fs.writeFileSync(path.join(backupDir, `pre-migration-v${index}-to-v21-2026-08-${String(index + 1).padStart(2, '0')}.sqlite`), '')
    rotateSnapshots(backupDir)
    expect(fs.readdirSync(backupDir).filter((name) => name.startsWith('pre-migration-'))).toHaveLength(6)
  })

  it('removes timestamped and interrupted snapshot temporary files', () => {
    const backupDir = path.join(dir, 'backups'); fs.mkdirSync(backupDir)
    fs.writeFileSync(path.join(backupDir, 'bibudai-test.sqlite.partial'), 'incomplete')
    fs.writeFileSync(path.join(backupDir, 'bibudai-test.sqlite.partial-123'), 'incomplete')
    rotateSnapshots(backupDir)
    expect(fs.readdirSync(backupDir)).toEqual([])
  })

  it('restores only a valid snapshot and preserves the corrupt database', () => {
    const databasePath = path.join(dir, 'main.sqlite')
    const database = new AppDatabase(databasePath)
    database.createProject('可恢复项目')
    const snapshot = createDatabaseSnapshot(database, dir)
    database.close()
    fs.writeFileSync(databasePath, Buffer.from('not-a-sqlite-database'))

    const listed = listDatabaseSnapshots(dir)
    expect(listed[0]).toMatchObject({ fileName: path.basename(snapshot), integrity: 'ok' })
    const result = restoreDatabaseSnapshot(dir, databasePath, path.basename(snapshot))
    expect(result.integrity).toBe('ok')
    expect(result.preserved).toHaveLength(1)
    expect(fs.readFileSync(result.preserved[0], 'utf8')).toBe('not-a-sqlite-database')
    const recovered = new AppDatabase(databasePath)
    expect(recovered.integrityCheck()).toBe('ok')
    expect(recovered.listProjects()[0].title).toBe('可恢复项目')
    recovered.close()
    expect(() => restoreDatabaseSnapshot(dir, databasePath, '../escape.sqlite')).toThrow('无效的快照文件名')
  })
})
