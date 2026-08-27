import path from 'node:path'

export const NODE_RUNTIME_VERSION = '24.10.0'

export function resolveNodeRuntime(root, platform, arch, version = NODE_RUNTIME_VERSION) {
  const supported = platform === 'darwin' && ['arm64', 'x64'].includes(arch)
    || platform === 'win32' && arch === 'x64'
  if (!supported) {
    throw new Error(`不支持的 Node sidecar 运行时平台：${platform}-${arch}`)
  }

  const platformArch = platform === 'darwin' ? `darwin-${arch}` : 'win-x64'
  const archiveExtension = platform === 'win32' ? '.zip' : '.tar.gz'
  const folderName = `node-v${version}-${platformArch}`
  const archiveName = `${folderName}${archiveExtension}`
  const runtimeDir = path.join(root, '.tooling', 'node-runtime')
  const runtimeExecutable = platform === 'win32'
    ? path.join(runtimeDir, 'node.exe')
    : path.join(runtimeDir, 'bin', 'node')

  return {
    version,
    platform,
    arch,
    platformArch,
    archiveName,
    folderName,
    runtimeDir,
    runtimeExecutable,
    tarArgs: platform === 'win32'
      ? (archivePath, staging) => ['-xf', archivePath, '-C', staging]
      : (archivePath, staging) => ['-xzf', archivePath, '-C', staging],
  }
}
