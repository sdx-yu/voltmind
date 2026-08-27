import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  artifactEvidence, findFiles, outputPathFromArgs, run, sourceRevision, summarizePreflight, writeEvidence,
} from './release-script-core.mjs'

const root = process.cwd()
const output = outputPathFromArgs(root, 'g4-windows-release.json')
const thumbprint = (process.env.WINDOWS_CERTIFICATE_THUMBPRINT ?? '').replaceAll(' ', '').toUpperCase()
const timestampUrl = process.env.WINDOWS_TIMESTAMP_URL ?? ''
const checks = [
  check('platform', process.platform === 'win32' && process.arch === 'x64', `${process.platform}-${process.arch}`),
  check('certificate-thumbprint-format', /^[A-F0-9]{40}$/.test(thumbprint), thumbprint ? 'configured' : 'not-configured'),
  check('rfc3161-timestamp-url', /^https:\/\//i.test(timestampUrl), timestampUrl ? 'configured' : 'not-configured'),
]

if (process.platform === 'win32' && /^[A-F0-9]{40}$/.test(thumbprint)) {
  const script = `$cert = Get-Item -LiteralPath 'Cert:\\CurrentUser\\My\\${thumbprint}' -ErrorAction Stop; if (-not $cert.HasPrivateKey) { exit 2 }; if ($cert.NotAfter -le (Get-Date)) { exit 3 }; if (-not ($cert.EnhancedKeyUsageList.ObjectId.Value -contains '1.3.6.1.5.5.7.3.3')) { exit 4 }`
  checks.push(check('code-signing-certificate', run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]).ok, 'CurrentUser/My private key, validity and code-signing EKU'))
} else {
  checks.push(check('code-signing-certificate', false, 'not-checked'))
}

const base = {
  schemaVersion: 'g4-windows-release-v1',
  generatedAt: new Date().toISOString(),
  sourceRevision: sourceRevision(root),
  host: { platform: process.platform, arch: process.arch },
  checks,
  credentialsRecorded: false,
}
const preflight = summarizePreflight(checks)
if (process.argv.includes('--preflight-only') || preflight.missing.length) {
  writeEvidence(output, { ...base, status: preflight.status, missing: preflight.missing, artifacts: [] })
  process.exitCode = preflight.missing.length ? 2 : 0
} else {
  const override = path.join(root, '.tooling', 'tauri.windows.release.json')
  fs.mkdirSync(path.dirname(override), { recursive: true })
  fs.writeFileSync(override, `${JSON.stringify({
    bundle: {
      targets: ['nsis', 'msi'],
      windows: { certificateThumbprint: thumbprint, digestAlgorithm: 'sha256', timestampUrl },
    },
  }, null, 2)}\n`, { mode: 0o600 })
  const prepare = run('npm.cmd', ['run', 'desktop:prepare'], { cwd: root, inherit: true })
  const tauri = prepare.ok
    ? run(process.execPath, ['scripts/run-tauri.mjs', 'build', '--bundles', 'nsis,msi', '--config', override], { cwd: root, inherit: true })
    : { ok: false }
  const bundleRoot = path.join(root, 'src-tauri', 'target', 'release', 'bundle')
  const installers = findFiles(bundleRoot, (file) => file.endsWith('.msi') || file.endsWith('-setup.exe'))
  const signatures = installers.map((file) => {
    const escaped = file.replaceAll("'", "''")
    const command = `$s = Get-AuthenticodeSignature -LiteralPath '${escaped}'; if ($s.Status -ne 'Valid') { exit 2 }; if ($s.SignerCertificate.Thumbprint -ne '${thumbprint}') { exit 3 }`
    return { file, valid: run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]).ok }
  })
  const verifyChecks = [
    check('desktop-build', prepare.ok && tauri.ok, prepare.ok ? 'tauri-build' : 'desktop-prepare'),
    check('nsis-produced', installers.some((file) => file.endsWith('-setup.exe')), 'NSIS setup executable'),
    check('msi-produced', installers.some((file) => file.endsWith('.msi')), 'MSI installer'),
    check('authenticode-valid', signatures.length >= 2 && signatures.every((item) => item.valid), 'valid signer and configured thumbprint'),
  ]
  const passed = verifyChecks.every((item) => item.passed)
  writeEvidence(output, {
    ...base,
    checks: [...checks, ...verifyChecks],
    status: passed ? 'PASSED' : 'FAILED',
    missing: passed ? [] : verifyChecks.filter((item) => !item.passed).map((item) => item.id),
    artifacts: artifactEvidence(installers, root),
  })
  if (!passed) process.exitCode = 1
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail }
}
