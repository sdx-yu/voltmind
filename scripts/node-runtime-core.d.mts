export const NODE_RUNTIME_VERSION: string

export interface NodeRuntimeSpec {
  version: string
  platform: string
  arch: string
  platformArch: string
  archiveName: string
  folderName: string
  runtimeDir: string
  runtimeExecutable: string
  tarArgs: (archivePath: string, staging: string) => string[]
}

export function resolveNodeRuntime(root: string, platform: string, arch: string, version?: string): NodeRuntimeSpec
