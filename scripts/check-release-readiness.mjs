import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { finalizeReleaseEvidence } from './release-readiness-core.mjs'

const root = process.cwd()
const outputPath = argumentValue('--output')
const fastCheck = process.env.BBD_RELEASE_FAST === '1'
const packageJson = readJson('package.json')
const tauri = readJson('src-tauri/tauri.conf.json')
const cargo = readText('src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1] ?? ''
const shell = readText('public/sw.js').match(/bbd-shell-v([0-9.]+)/)?.[1] ?? ''
const version = packageJson.version
const appPath = path.join(root, 'src-tauri/target/release/bundle/macos/笔不怠.app')
const dmgPath = path.join(root, `src-tauri/target/release/bundle/dmg/笔不怠_${version}_aarch64.dmg`)
const releaseDmgPath = path.join(root, `release/笔不怠_${version}_aarch64.dmg`)
const checksumPath = path.join(root, 'release/SHA256SUMS')
const sbomPath = path.join(root, 'release/bom.cdx.json')
const licensesPath = path.join(root, 'release/third-party-licenses.json')
const windowsInstallers = findFiles([
  'src-tauri/target/release/bundle/nsis',
  'src-tauri/target/release/bundle/msi',
], /\.(exe|msi)$/i)
const checksumRecords = parseChecksums(checksumPath)
const artifactForChecksum = fs.existsSync(releaseDmgPath) ? releaseDmgPath : dmgPath
const artifactRelativePath = relative(artifactForChecksum)
const artifactHash = hashFile(artifactForChecksum)
const recordedHash = checksumRecords.get(artifactRelativePath) ?? null
const codesignDetails = !fastCheck && process.platform === 'darwin' && fs.existsSync(appPath)
  ? output('codesign', ['-dv', '--verbose=4', appPath])
  : ''

let evidence = {
  schemaVersion: 'g4-release-readiness-v1',
  checkedAt: new Date().toISOString(),
  releaseDecision: 'NO-GO',
  source: {
    branch: output('git', ['branch', '--show-current']).trim() || null,
    commit: output('git', ['rev-parse', 'HEAD']).trim() || null,
    trackedChanges: !succeeds('git', ['diff', '--quiet', 'HEAD', '--']),
  },
  versions: {
    package: version,
    tauri: tauri.version,
    cargo,
    serviceWorker: shell,
    aligned: [tauri.version, cargo, shell].every((value) => value === version),
  },
  materials: {
    sbom: inspectJsonMaterial(sbomPath, (value) => value?.bomFormat === 'CycloneDX' && value?.specVersion === '1.6'),
    thirdPartyLicenses: inspectJsonMaterial(licensesPath, (value) => value && typeof value === 'object' && Object.keys(value).length > 0),
    checksumManifest: {
      exists: fs.existsSync(checksumPath),
      artifact: artifactRelativePath,
      artifactSha256: artifactHash,
      recordedSha256: recordedHash,
      artifactRecorded: Boolean(artifactHash && recordedHash && timingSafeEqual(artifactHash, recordedHash)),
    },
  },
  macOS: {
    appExists: fs.existsSync(appPath),
    signatureStructureValid: !fastCheck && process.platform === 'darwin' && fs.existsSync(appPath)
      ? succeeds('codesign', ['--verify', '--deep', '--strict', appPath])
      : false,
    developerIdSigned: /Authority=Developer ID Application:/.test(codesignDetails) && !/Signature=adhoc/.test(codesignDetails),
    dmgExists: fs.existsSync(dmgPath),
    dmgValid: !fastCheck && process.platform === 'darwin' && fs.existsSync(dmgPath) ? succeeds('hdiutil', ['verify', dmgPath]) : false,
    gatekeeperAccepted: !fastCheck && process.platform === 'darwin' && fs.existsSync(appPath)
      ? succeeds('spctl', ['--assess', '--type', 'execute', appPath])
      : false,
    notarizationStapled: !fastCheck && process.platform === 'darwin' && fs.existsSync(dmgPath)
      ? succeeds('xcrun', ['stapler', 'validate', dmgPath])
      : false,
  },
  windows: {
    installers: windowsInstallers.map(relative),
    signedInstallerVerified: false,
    installUninstallImeRecoveryMatrix: 'pending_external_windows_x64',
  },
  mobile: {
    realDeviceMatrix: 'pending_external_devices',
    requiredWidths: [360, 390, 430],
    requiredConditions: ['offline', 'weak_network', 'pwa_update', 'encrypted_handoff'],
  },
  seedValidation: {
    status: 'pending_external_authors_and_time',
    minimumTwoWeekAuthors: 5,
    minimumFourWeekAuthors: 3,
    fixtureEvidenceAccepted: false,
  },
  privacy: {
    containsAuthorIdentity: false,
    containsContactDetails: false,
    containsManuscriptText: false,
    containsSecrets: false,
  },
  gates: [],
}

evidence = finalizeReleaseEvidence(evidence)

const serialized = `${JSON.stringify(evidence, null, 2)}\n`
if (outputPath) {
  const resolved = path.resolve(root, outputPath)
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  fs.writeFileSync(resolved, serialized, { mode: 0o600 })
}
process.stdout.write(serialized)

function inspectJsonMaterial(filePath, validate) {
  if (!fs.existsSync(filePath)) return { exists: false, valid: false, sha256: null, checksumRecorded: false }
  const sha256 = hashFile(filePath)
  const recorded = checksumRecords.get(relative(filePath)) ?? null
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return { exists: true, valid: Boolean(validate(value)), sha256, checksumRecorded: Boolean(sha256 && recorded && timingSafeEqual(sha256, recorded)) }
  } catch {
    return { exists: true, valid: false, sha256, checksumRecorded: Boolean(sha256 && recorded && timingSafeEqual(sha256, recorded)) }
  }
}

function parseChecksums(filePath) {
  const records = new Map()
  if (!fs.existsSync(filePath)) return records
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/i)
    if (match) records.set(match[2], match[1].toLowerCase())
  }
  return records
}

function findFiles(directories, pattern) {
  return directories.flatMap((directory) => {
    const absolute = path.join(root, directory)
    if (!fs.existsSync(absolute)) return []
    return fs.readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => entry.isFile() && pattern.test(entry.name))
      .map((entry) => path.join(absolute, entry.name))
  })
}

function readJson(filePath) { return JSON.parse(readText(filePath)) }
function readText(filePath) { return fs.readFileSync(path.join(root, filePath), 'utf8') }
function relative(filePath) { return filePath ? path.relative(root, filePath).split(path.sep).join('/') : null }
function hashFile(filePath) { return filePath && fs.existsSync(filePath) ? crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex') : null }
function timingSafeEqual(left, right) {
  const a = Buffer.from(left, 'hex'); const b = Buffer.from(right, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
function argumentValue(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null }
function succeeds(command, args) { return spawnSync(command, args, { cwd: root, stdio: 'ignore', timeout: 15_000, killSignal: 'SIGKILL' }).status === 0 }
function output(command, args) {
  const run = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000, killSignal: 'SIGKILL' })
  return `${run.stdout ?? ''}${run.stderr ?? ''}`
}
