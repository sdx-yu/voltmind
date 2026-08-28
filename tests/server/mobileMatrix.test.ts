import { describe, expect, it } from 'vitest'
import { validateMobileEvidence } from '../../scripts/g4/mobile-matrix-core.mjs'

const revision = '0123456789abcdef0123456789abcdef01234567'
const manualChecks = { imeComposition: true, offlineReopen: true, weakNetworkSave: true, pwaUpdate: true, encryptedHandoff: true }
function evidence(width: number, userAgent: string) {
  return {
    schemaVersion: 'g4-mobile-device-v1', appVersion: '1.7.0', sourceRevision: revision.slice(0, 8),
    viewport: { width, height: 800 }, runtime: { secureContext: true, serviceWorkerSupported: true, serviceWorkerControlled: true, touchPoints: 5, healthOk: true, userAgent },
    checks: manualChecks, screenshotReference: `device-${width}.png`, manuscriptContentRecorded: false,
  }
}

describe('G4 mobile real-device matrix verifier', () => {
  it('accepts the required widths and both mobile browser families', () => {
    const result = validateMobileEvidence([
      evidence(360, 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/127.0 Mobile Safari/537.36'),
      evidence(390, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'),
      evidence(430, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'),
    ], revision)
    expect(result).toMatchObject({ status: 'PASSED', errors: [] })
  })

  it('rejects a desktop simulation or an incomplete manual matrix', () => {
    const item = evidence(390, 'Mozilla/5.0 Macintosh Safari/605.1.15')
    item.runtime.touchPoints = 0
    item.checks = { ...manualChecks, offlineReopen: false }
    const result = validateMobileEvidence([item], revision)
    expect(result.status).toBe('FAILED')
    expect(result.errors).toContain('至少需要 3 份真机证据')
    expect(result.errors.some((error) => error.includes('离线') || error.includes('offlineReopen'))).toBe(true)
  })
})
