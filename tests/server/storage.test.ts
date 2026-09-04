// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { getConfig } from '../../server/config.js'
import { AppDatabase } from '../../server/db.js'
import { assertLibraryCanOpen, ensureLibraryMarker, expiredTrashIds, readStoragePolicy, storageStatus, writeStoragePolicy } from '../../server/storage.js'

describe('local storage safety', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-storage-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('distinguishes a new library from a database removed outside the app', () => {
    const config = getConfig({ dataDir: dir, databasePath: path.join(dir, 'bibudai.sqlite'), production: false })
    expect(() => assertLibraryCanOpen(config)).not.toThrow()
    const database = new AppDatabase(config.databasePath); database.close()
    ensureLibraryMarker(config)
    fs.unlinkSync(config.databasePath)
    expect(() => assertLibraryCanOpen(config)).toThrow('已阻止创建空资料库')
  })

  it('stores a safe retention preference and finds only expired trash', () => {
    const databasePath = path.join(dir, 'bibudai.sqlite')
    const database = new AppDatabase(databasePath)
    const expired = database.createProject('过期作品')
    const recent = database.createProject('最近作品')
    database.updateProject(expired.id, { deletedAt: '2026-01-01T00:00:00.000Z' })
    database.updateProject(recent.id, { deletedAt: '2026-08-25T00:00:00.000Z' })
    writeStoragePolicy(dir, { trashRetentionDays: 30 })
    expect(readStoragePolicy(dir)).toEqual({ trashRetentionDays: 30 })
    expect(expiredTrashIds(database, 30, Date.parse('2026-09-04T00:00:00.000Z'))).toEqual([expired.id])
    database.close()
  })

  it('permanently deletes only trashed projects and keeps the remaining library valid', () => {
    const database = new AppDatabase(path.join(dir, 'bibudai.sqlite'))
    const removed = database.createProject('待删除')
    const retained = database.createProject('继续保留')
    database.updateProject(removed.id, { deletedAt: '2026-08-01T00:00:00.000Z' })
    expect(database.listProjectTrash()[0].estimatedByteSize).toBeGreaterThan(0)
    expect(() => database.purgeProjects([retained.id])).toThrow('只能永久删除')
    expect(database.purgeProjects([removed.id]).map((project) => project.title)).toEqual(['待删除'])
    expect(database.getProject(removed.id)).toBeNull()
    expect(database.getProject(retained.id)?.title).toBe('继续保留')
    expect(database.integrityCheck()).toBe('ok')
    database.close()
  })

  it('reports storage, purges through a confirmed API, and blocks requests after external removal', async () => {
    const config = getConfig({ dataDir: dir, databasePath: path.join(dir, 'bibudai.sqlite'), production: false })
    const result = createApp(config)
    const trashed = result.database.createProject('回收作品')
    result.database.updateProject(trashed.id, { deletedAt: '2026-08-01T00:00:00.000Z' })
    const session = await request(result.app).post('/api/session').expect(200)
    const cookie = session.headers['set-cookie'][0].split(';')[0]
    const before = await request(result.app).get('/api/storage').set('Cookie', cookie).expect(200)
    expect(before.body).toMatchObject({ trashCount: 1, libraryPresent: true })
    await request(result.app).post('/api/projects/trash/purge').set('Cookie', cookie).send({ ids: [trashed.id], confirm: true }).expect(200)
    expect(result.database.getProject(trashed.id)).toBeNull()
    const status = storageStatus(result.database, config)
    expect(status.backupCount).toBeGreaterThan(0)
    // Windows keeps an open SQLite file locked. An external removal can only
    // become observable after the desktop process releases that handle.
    result.database.close()
    fs.unlinkSync(config.databasePath)
    const health = await request(result.app).get('/api/health').expect(200)
    expect(health.body).toMatchObject({ ok: false, libraryPresent: false })
    await request(result.app).get('/api/storage').set('Cookie', cookie).expect(503)
  })

  it('applies retention immediately and can empty the remaining trash after confirmation', async () => {
    const config = getConfig({ dataDir: dir, databasePath: path.join(dir, 'bibudai.sqlite'), production: false })
    const result = createApp(config)
    const expired = result.database.createProject('已经过期')
    const recent = result.database.createProject('仍在保留期')
    result.database.updateProject(expired.id, { deletedAt: '2026-01-01T00:00:00.000Z' })
    result.database.updateProject(recent.id, { deletedAt: new Date().toISOString() })
    const session = await request(result.app).post('/api/session').expect(200)
    const cookie = session.headers['set-cookie'][0].split(';')[0]

    const policy = await request(result.app).put('/api/storage/policy').set('Cookie', cookie).send({ trashRetentionDays: 30 }).expect(200)
    expect(policy.body).toMatchObject({ purgedProjects: 1, trashCount: 1, trashRetentionDays: 30 })
    expect(result.database.getProject(expired.id)).toBeNull()
    expect(result.database.getProject(recent.id)?.deletedAt).not.toBeNull()

    await request(result.app).post('/api/projects/trash/empty').set('Cookie', cookie).send({ confirm: false }).expect(400)
    const emptied = await request(result.app).post('/api/projects/trash/empty').set('Cookie', cookie).send({ confirm: true }).expect(200)
    expect(emptied.body.purged).toHaveLength(1)
    expect(result.database.listProjectTrash()).toEqual([])
    expect(result.database.integrityCheck()).toBe('ok')
    result.database.close()
  })
})
