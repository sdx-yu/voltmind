import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import { z } from 'zod'
import type { AppConfig } from './config.js'
import { listDatabaseSnapshots, restoreDatabaseSnapshot } from './backups.js'
import { nowIso } from './utils.js'

export function createRescueApp(config: AppConfig, failure: unknown, onRecovered: () => void) {
  const app = express()
  const sessionToken = randomBytes(24).toString('hex')
  const allowedOrigins = new Set([`http://${config.host}:4318`, `http://${config.host}:${config.port}`])
  const reason = sanitizeFailure(failure)

  app.disable('x-powered-by')
  app.use((req, res, next) => { const origin = req.headers.origin; if (origin && !allowedOrigins.has(origin)) return res.status(403).json({ error: 'Origin is not allowed' }); next() })
  app.use(cors({ origin: [...allowedOrigins], credentials: true }))
  app.use(express.json({ limit: '1mb' }))
  app.get('/api/health', (_req, res) => res.json({ ok: false, integrity: 'failed', rescueMode: true, reason, time: nowIso() }))
  app.post('/api/session', (req, res) => {
    if (!isLoopback(req.ip)) return res.status(403).json({ error: 'Only loopback clients are allowed' })
    res.setHeader('Set-Cookie', `bbd_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`)
    return res.json({ ok: true })
  })
  app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path === '/session') return next()
    if (parseCookies(req.headers.cookie ?? '').bbd_session !== sessionToken) return res.status(401).json({ error: 'Local session required' })
    return next()
  })
  app.get('/api/rescue/status', (_req, res) => res.json({ rescueMode: true, reason, snapshots: listDatabaseSnapshots(config.dataDir) }))
  app.post('/api/rescue/restore', route(async (req, res) => {
    const { fileName } = z.object({ fileName: z.string().min(1).max(240) }).parse(req.body)
    const result = restoreDatabaseSnapshot(config.dataDir, config.databasePath, fileName)
    res.json(result)
    setTimeout(onRecovered, 50).unref()
  }))

  if (config.production && fs.existsSync(config.staticDir)) {
    app.use(express.static(config.staticDir))
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(config.staticDir, 'index.html')))
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: '请求格式不正确', details: error.issues })
    return res.status(500).json({ error: error instanceof Error ? error.message : '恢复失败' })
  })
  return app
}

function sanitizeFailure(failure: unknown) {
  const message = failure instanceof Error ? failure.message : String(failure)
  return message.replaceAll(/[\r\n\t]/g, ' ').slice(0, 240) || '数据库完整性检查失败'
}

function isLoopback(ip: string | undefined) { return !ip || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' }
function parseCookies(value: string) { return Object.fromEntries(value.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((pair) => pair.length === 2)) }
function route(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) { return (req: Request, res: Response, next: NextFunction) => void handler(req, res, next).catch(next) }
