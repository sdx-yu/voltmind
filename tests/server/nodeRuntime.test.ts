import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveNodeRuntime } from '../../scripts/node-runtime-core.mjs'

describe('verified sidecar Node runtime', () => {
  it('resolves the macOS arm64 archive and executable', () => {
    const spec = resolveNodeRuntime('/workspace', 'darwin', 'arm64')
    expect(spec.archiveName).toBe('node-v24.10.0-darwin-arm64.tar.gz')
    expect(spec.runtimeExecutable).toBe(path.join('/workspace', '.tooling', 'node-runtime', 'bin', 'node'))
    expect(spec.tarArgs('/tmp/node.tgz', '/tmp/out')).toEqual(['-xzf', '/tmp/node.tgz', '-C', '/tmp/out'])
  })

  it('resolves the Windows x64 ZIP and node.exe', () => {
    const spec = resolveNodeRuntime('C:\\workspace', 'win32', 'x64')
    expect(spec.archiveName).toBe('node-v24.10.0-win-x64.zip')
    expect(spec.runtimeExecutable).toContain('node.exe')
    expect(spec.tarArgs('node.zip', 'out')).toEqual(['-xf', 'node.zip', '-C', 'out'])
  })

  it('rejects platforms outside the supported desktop release matrix', () => {
    expect(() => resolveNodeRuntime('/workspace', 'linux', 'x64')).toThrow('不支持')
    expect(() => resolveNodeRuntime('/workspace', 'win32', 'arm64')).toThrow('不支持')
  })
})
