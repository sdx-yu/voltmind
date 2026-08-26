import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const cargoHome = path.join(root, '.tooling', 'cargo')
const rustupHome = path.join(root, '.tooling', 'rustup')
const cli = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, CARGO_HOME: cargoHome, RUSTUP_HOME: rustupHome, PATH: `${path.join(cargoHome, 'bin')}${path.delimiter}${process.env.PATH ?? ''}` },
})
process.exit(result.status ?? 1)
