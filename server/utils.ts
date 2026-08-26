import { createHash, randomUUID } from 'node:crypto'

export const nowIso = () => new Date().toISOString()
export const newId = () => randomUUID()
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

export function jsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
}

export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  const other = Math.max(0, text.length - cjk)
  return Math.ceil(cjk * 1.5 + other / 4)
}

export function countWords(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length
  return cjk + latin
}
