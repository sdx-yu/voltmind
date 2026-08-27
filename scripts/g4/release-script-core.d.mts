export interface CommandResult {
  ok: boolean
  status: number | null
  stdout: string
  stderr: string
  error?: string
}

export interface ReleaseCheck { id: string; passed: boolean; detail?: string }
export interface PreflightSummary { status: 'PASSED' | 'BLOCKED'; missing: string[] }

export function run(command: string, args?: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv; inherit?: boolean; timeout?: number }): CommandResult
export function sourceRevision(root: string): string
export function sha256(file: string): string
export function findFiles(root: string, predicate: (file: string) => boolean): string[]
export function outputPathFromArgs(root: string, defaultName: string): string
export function writeEvidence(file: string, evidence: Record<string, unknown> & { status: string }): void
export function artifactEvidence(files: string[], root: string): Array<{ path: string; bytes: number; sha256: string }>
export function summarizePreflight(checks: ReleaseCheck[]): PreflightSummary
