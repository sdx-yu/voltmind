import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = fs.readFileSync('.github/workflows/windows-desktop.yml', 'utf8')
const buildScript = fs.readFileSync('scripts/g4/windows-ci-build.mjs', 'utf8')
const packageScript = fs.readFileSync('scripts/g4/windows-ci-package.ps1', 'utf8')
const smokeScript = fs.readFileSync('scripts/g4/windows-installer-smoke.ps1', 'utf8')
const certificateScript = fs.readFileSync('scripts/g4/import-windows-signing-certificate.ps1', 'utf8')
const sidecarScript = fs.readFileSync('scripts/build-sidecar.mjs', 'utf8')

describe('Windows x64 automated desktop delivery', () => {
  it('uses a bounded Windows runner workflow with least-privilege artifact delivery', () => {
    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain("- 'v*'")
    expect(workflow).not.toMatch(/branches:\s*\n\s*- main/)
    expect(workflow).toContain('contents: read')
    expect(workflow).toContain('runs-on: windows-2025')
    expect(workflow).toContain('timeout-minutes: 60')
    expect(workflow).toContain('actions/checkout@v7')
    expect(workflow).toContain('actions/setup-node@v6')
    expect(workflow).toContain('actions/upload-artifact@v7')
    expect(workflow).toContain('if-no-files-found: error')
    expect(workflow).toContain('retention-days: 14')
  })

  it('locks quality gates, x64 packaging and MSI install/uninstall into the same revision', () => {
    expect(workflow).toContain('npm ci')
    expect(workflow).toContain('npm run ui:check && npm run ui:quality && npm run typecheck && npm test')
    expect(workflow).toContain('npm run desktop:build:windows-ci')
    expect(workflow).toContain('windows-ci-package.ps1')
    expect(workflow).toContain('windows-installer-smoke.ps1')
    expect(buildScript).toContain("process.platform !== 'win32' || process.arch !== 'x64'")
    expect(buildScript).toContain('process.env.npm_execpath')
    expect(buildScript).toContain("run(process.execPath, [npmCli, 'run', 'desktop:prepare'])")
    expect(buildScript).not.toContain("run('npm.cmd'")
    expect(buildScript).toContain("'--bundles', 'nsis,msi'")
    expect(sidecarScript).toContain("'postject', 'dist', 'cli.js'")
    expect(sidecarScript).toContain('execFileSync(process.execPath, [postject, ...args]')
    expect(packageScript).toContain("Get-FileHash -Algorithm SHA256")
    expect(packageScript).toContain("Get-AuthenticodeSignature")
    expect(smokeScript).toContain("'/i'")
    expect(smokeScript).toContain("'/x'")
  })

  it('keeps signing optional for internal tests without exposing certificate material', () => {
    expect(workflow).toContain('secrets.WINDOWS_CERTIFICATE_BASE64')
    expect(certificateScript).toContain('Import-PfxCertificate')
    expect(certificateScript).toContain('Remove-Item -LiteralPath $pfxPath')
    expect(packageScript).toContain("'unsigned-internal-test'")
    expect(packageScript).toContain('containsCertificateOrPassword = $false')
    expect(workflow).not.toMatch(/Write-Output.*WINDOWS_CERTIFICATE_(BASE64|PASSWORD)/)
  })
})
