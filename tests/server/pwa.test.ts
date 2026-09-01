// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('V1-M PWA shell contract', () => {
  it('has an installable manifest with mobile start URL and complete icons', () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve('public/manifest.webmanifest'), 'utf8'))
    expect(manifest).toMatchObject({ short_name: '笔不怠', display: 'standalone', start_url: '/?mobile=1' })
    expect(manifest.icons).toEqual(expect.arrayContaining([expect.objectContaining({ sizes: '192x192' }), expect.objectContaining({ sizes: '512x512' })]))
    for (const icon of manifest.icons) expect(fs.statSync(path.resolve('public', icon.src.replace(/^\//, ''))).size).toBeGreaterThan(100)
  })

  it('keeps one rollback shell, excludes API writes and activates updates only by message', () => {
    const worker = fs.readFileSync(path.resolve('public/sw.js'), 'utf8')
    expect(worker).toContain("const CURRENT_SHELL = 'bbd-shell-v2.3.5'")
    expect(worker).toContain('html.matchAll(/(?:src|href)')
    expect(worker).toContain('\\/assets\\/')
    expect(worker).toContain("await cache.addAll([...CORE.filter((path) => path !== '/'), ...new Set(assets)])")
    expect(worker).toMatch(/shells\.slice\(0, -1\)/)
    expect(worker).toMatch(/url\.pathname\.startsWith\('\/api\/'\)/)
    expect(worker).toContain("event.data?.type === 'SKIP_WAITING'")
    expect(worker).not.toMatch(/install[\s\S]{0,300}skipWaiting/)
  })
})
