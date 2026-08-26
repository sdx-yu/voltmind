import fs from 'node:fs'
import path from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

export class LocalVault {
  private readonly key: Buffer
  readonly storage: 'system_keychain' | 'protected_file'

  constructor(dataDir: string) {
    const keyPath = path.join(dataDir, '.vault-key')
    fs.mkdirSync(dataDir, { recursive: true })
    const systemKey = process.platform === 'darwin' && process.env.NODE_ENV === 'production' ? loadMacKeychainKey(dataDir, keyPath) : null
    if (systemKey) {
      this.key = systemKey
      this.storage = 'system_keychain'
      return
    }
    if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, randomBytes(32), { mode: 0o600 })
    fs.chmodSync(keyPath, 0o600)
    this.key = fs.readFileSync(keyPath)
    this.storage = 'protected_file'
    if (this.key.length !== 32) throw new Error('Invalid local vault key')
  }

  encrypt(value: string): string {
    if (!value) return ''
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, encrypted]).toString('base64')
  }

  decrypt(payload: string): string {
    if (!payload) return ''
    const bytes = Buffer.from(payload, 'base64')
    const iv = bytes.subarray(0, 12)
    const tag = bytes.subarray(12, 28)
    const encrypted = bytes.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  }
}

function loadMacKeychainKey(dataDir: string, legacyKeyPath: string): Buffer | null {
  const service = 'com.bibudai.local-vault'
  const account = createHash('sha256').update(path.resolve(dataDir)).digest('hex').slice(0, 24)
  const found = spawnSync('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w'], { encoding: 'utf8' })
  if (found.status === 0) {
    const value = Buffer.from(found.stdout.trim(), 'base64')
    return value.length === 32 ? value : null
  }
  const key = fs.existsSync(legacyKeyPath) ? fs.readFileSync(legacyKeyPath) : randomBytes(32)
  if (key.length !== 32) return null
  const saved = spawnSync('/usr/bin/security', ['add-generic-password', '-U', '-s', service, '-a', account, '-w', key.toString('base64')], { encoding: 'utf8' })
  return saved.status === 0 ? key : null
}
