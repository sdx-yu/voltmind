import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const tauri = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
const cargo = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8').match(/^version = "([^"]+)"/m)?.[1] ?? ''
const shell = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8').match(/bbd-shell-v([0-9.]+)/)?.[1] ?? ''
const version = packageJson.version
const appPath = path.join(root, 'src-tauri/target/release/bundle/macos/笔不怠.app')
const dmgPath = path.join(root, `src-tauri/target/release/bundle/dmg/笔不怠_${version}_aarch64.dmg`)

const result = {
  checkedAt: new Date().toISOString(),
  version,
  publicRelease: 'NO-GO',
  sourceVersions: { package: version, tauri: tauri.version, cargo, serviceWorker: shell, aligned: [tauri.version, cargo, shell].every((value) => value === version) },
  macOS: { appExists: fs.existsSync(appPath), signatureValid: false, developerId: false, notarized: false, dmgExists: fs.existsSync(dmgPath), dmgValid: false },
  windows: { signedInstallerPresent: findWindowsInstaller(root) },
  seedValidation: { status: 'required', evidence: '必须由研究负责人核对至少 5 名两周、3 名四周的真实研究包；脚本不接受本机夹具代替' },
}

if (process.platform === 'darwin' && result.macOS.appExists) {
  result.macOS.signatureValid = succeeds('codesign', ['--verify', '--deep', '--strict', appPath])
  const details = output('codesign', ['-dv', '--verbose=4', appPath])
  result.macOS.developerId = /Authority=Developer ID Application:/.test(details) && !/Signature=adhoc/.test(details)
  result.macOS.notarized = succeeds('spctl', ['--assess', '--type', 'execute', '--verbose=2', appPath])
}
if (process.platform === 'darwin' && result.macOS.dmgExists) result.macOS.dmgValid = succeeds('hdiutil', ['verify', dmgPath])

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)

function succeeds(command, args) {
  return spawnSync(command, args, { stdio: 'ignore' }).status === 0
}
function output(command, args) {
  const run = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return `${run.stdout ?? ''}${run.stderr ?? ''}`
}
function findWindowsInstaller(base) {
  const directories = [path.join(base, 'src-tauri/target/release/bundle/nsis'), path.join(base, 'src-tauri/target/release/bundle/msi')]
  return directories.some((directory) => fs.existsSync(directory) && fs.readdirSync(directory).some((name) => /\.(exe|msi)$/i.test(name)))
}
