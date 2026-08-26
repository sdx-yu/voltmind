import { createServer, type RequestListener } from 'node:http'
import type { AppDatabase } from './db.js'
import { getConfig } from './config.js'
import { createApp } from './app.js'
import { createDatabaseSnapshot } from './backups.js'
import { createRescueApp } from './rescue.js'

const config = getConfig()
let database: AppDatabase | null = null
let handler: RequestListener = (_req, res) => { res.statusCode = 503; res.end('Starting') }
let lastFailure = ''

function activate() {
  try {
    database?.close()
    database = null
    const runtime = createApp(config)
    const integrity = runtime.database.integrityCheck()
    if (integrity !== 'ok') {
      runtime.database.close()
      throw new Error(`SQLite integrity_check: ${integrity}`)
    }
    database = runtime.database
    handler = runtime.app as RequestListener
    lastFailure = ''
    return true
  } catch (error) {
    lastFailure = error instanceof Error ? error.message : String(error)
    handler = createRescueApp(config, error, () => {
      if (activate()) {
        try { createDatabaseSnapshot(database!, config.dataDir) } catch { /* recovery succeeded even if a fresh snapshot cannot be created */ }
      }
    }) as RequestListener
    return false
  }
}

const healthy = activate()
const server = createServer((req, res) => handler(req, res))

server.listen(config.port, config.host, () => {
  let snapshot = '跳过（救援模式）'
  if (database) {
    try { snapshot = createDatabaseSnapshot(database, config.dataDir) } catch (error) { snapshot = `失败：${error instanceof Error ? error.message : String(error)}` }
  }
  process.stdout.write(`笔不怠本地服务：http://${config.host}:${config.port}\n数据：${config.databasePath}\n`)
  process.stdout.write(`${healthy ? '启动快照' : `救援模式：${lastFailure}`}：${snapshot}\n`)
})
const backupTimer = setInterval(() => {
  if (!database) return
  try { createDatabaseSnapshot(database, config.dataDir) } catch { /* health endpoint remains available; next interval retries */ }
}, 10 * 60_000)
backupTimer.unref()

function shutdown() {
  clearInterval(backupTimer)
  if (database) { try { createDatabaseSnapshot(database, config.dataDir) } catch { /* shutdown must continue */ } }
  server.close(() => {
    try { database?.close() } catch { /* already closed */ }
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 5_000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
