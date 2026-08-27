import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  artifactEvidence, findFiles, outputPathFromArgs, run, sourceRevision, summarizePreflight, writeEvidence,
} from './release-script-core.mjs'

const root = process.cwd()
const output = outputPathFromArgs(root, 'g4-macos-release.json')
const checks = []
const identity = process.env.APPLE_SIGNING_IDENTITY ?? ''
const developerDirectory = run('xcode-select', ['-p'])
checks.push(check('platform', process.platform === 'darwin', `${process.platform}-${process.arch}`))
checks.push(check('full-xcode', developerDirectory.ok && !developerDirectory.stdout.includes('CommandLineTools'), developerDirectory.stdout || developerDirectory.stderr))

const identities = run('security', ['find-identity', '-v', '-p', 'codesigning'])
const identityUsable = identity.includes('Developer ID Application') && identities.ok && identities.stdout.includes(identity)
checks.push(check('developer-id-identity', identityUsable, identity ? 'configured-but-not-usable' : 'not-configured'))

const apiCredentials = Boolean(process.env.APPLE_API_ISSUER && process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_PATH && fs.existsSync(process.env.APPLE_API_KEY_PATH))
const appleIdCredentials = Boolean(process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID)
checks.push(check('notarization-credentials', apiCredentials || appleIdCredentials, apiCredentials ? 'app-store-connect-api-key' : appleIdCredentials ? 'apple-id-app-password' : 'not-configured'))

const preflight = summarizePreflight(checks)
const base = {
  schemaVersion: 'g4-macos-release-v1',
  generatedAt: new Date().toISOString(),
  sourceRevision: sourceRevision(root),
  host: { platform: process.platform, arch: process.arch },
  checks,
  credentialsRecorded: false,
}

if (process.argv.includes('--preflight-only') || preflight.missing.length) {
  writeEvidence(output, { ...base, status: preflight.status, missing: preflight.missing, artifacts: [] })
  process.exitCode = preflight.missing.length ? 2 : 0
} else {
  const override = path.join(root, '.tooling', 'tauri.macos.release.json')
  fs.mkdirSync(path.dirname(override), { recursive: true })
  fs.writeFileSync(override, `${JSON.stringify({
    bundle: { targets: ['app', 'dmg'], macOS: { signingIdentity: identity, hardenedRuntime: true } },
  }, null, 2)}\n`, { mode: 0o600 })

  const build = run('npm', ['run', 'desktop:prepare'], { cwd: root, inherit: true })
  const tauri = build.ok
    ? run(process.execPath, ['scripts/run-tauri.mjs', 'build', '--bundles', 'app,dmg', '--config', override], { cwd: root, inherit: true })
    : { ok: false }
  const bundleRoot = path.join(root, 'src-tauri', 'target', 'release', 'bundle')
  const apps = findFiles(bundleRoot, (file) => file.endsWith('.app/Contents/MacOS/bibudai')).map((file) => file.slice(0, file.indexOf('.app/') + 4))
  const dmgs = findFiles(bundleRoot, (file) => file.endsWith('.dmg'))
  const app = [...new Set(apps)][0]
  const dmg = dmgs[0]
  const verifyChecks = [
    check('desktop-build', build.ok && tauri.ok, build.ok ? 'tauri-build' : 'desktop-prepare'),
    check('app-produced', Boolean(app), app ? path.relative(root, app) : 'missing'),
    check('dmg-produced', Boolean(dmg), dmg ? path.relative(root, dmg) : 'missing'),
    check('codesign-strict', Boolean(app) && run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]).ok, 'codesign --verify'),
    check('gatekeeper-app', Boolean(app) && run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]).ok, 'spctl execute assessment'),
    check('stapled-app', Boolean(app) && run('xcrun', ['stapler', 'validate', app]).ok, 'stapler validate app'),
    check('dmg-integrity', Boolean(dmg) && run('hdiutil', ['verify', dmg]).ok, 'hdiutil verify'),
    check('gatekeeper-dmg', Boolean(dmg) && run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmg]).ok, 'spctl open assessment'),
    check('stapled-dmg', Boolean(dmg) && run('xcrun', ['stapler', 'validate', dmg]).ok, 'stapler validate dmg'),
  ]
  const passed = verifyChecks.every((item) => item.passed)
  writeEvidence(output, {
    ...base,
    checks: [...checks, ...verifyChecks],
    status: passed ? 'PASSED' : 'FAILED',
    missing: passed ? [] : verifyChecks.filter((item) => !item.passed).map((item) => item.id),
    artifacts: artifactEvidence([app, dmg].filter(Boolean), root),
  })
  if (!passed) process.exitCode = 1
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail }
}
