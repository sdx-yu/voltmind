// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase } from '../../server/db.js'
import { createDatabaseSnapshot } from '../../server/backups.js'
import { getConfig } from '../../server/config.js'
import { createRescueApp } from '../../server/rescue.js'

describe('database rescue API', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bbd-rescue-')) })
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  it('exposes only verified snapshots and restores through a protected local session', async () => {
    const databasePath = path.join(dir, 'bibudai.sqlite')
    const database = new AppDatabase(databasePath)
    database.createProject('救援样稿')
    const snapshot = createDatabaseSnapshot(database, dir)
    database.close()
    fs.writeFileSync(databasePath, 'corrupt')
    fs.writeFileSync(path.join(dir, 'backups', 'bibudai-2026-08-20T00-00-00Z.sqlite'), 'bad snapshot')

    const recovered = vi.fn()
    const app = createRescueApp(getConfig({ dataDir: dir, databasePath, production: false }), new Error('database disk image is malformed'), recovered)
    await request(app).get('/api/rescue/status').expect(401)
    const session = await request(app).post('/api/session').expect(200)
    const cookie = session.headers['set-cookie'][0].split(';')[0]
    const status = await request(app).get('/api/rescue/status').set('Cookie', cookie).expect(200)
    expect(status.body.snapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileName: path.basename(snapshot), integrity: 'ok' }),
      expect.objectContaining({ fileName: 'bibudai-2026-08-20T00-00-00Z.sqlite', integrity: 'failed' }),
    ]))
    await request(app).post('/api/rescue/restore').set('Cookie', cookie).send({ fileName: path.basename(snapshot) }).expect(200)
    await new Promise((resolve) => setTimeout(resolve, 70))
    expect(recovered).toHaveBeenCalledOnce()
    const opened = new AppDatabase(databasePath)
    expect(opened.listProjects()[0].title).toBe('救援样稿')
    opened.close()
  })
})
