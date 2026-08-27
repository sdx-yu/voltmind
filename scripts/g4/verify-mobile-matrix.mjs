import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { run, sourceRevision, writeEvidence } from './release-script-core.mjs'
import { validateMobileEvidence } from './mobile-matrix-core.mjs'

const root = process.cwd()
const inputs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1])
  : path.join(root, '.tooling', 'evidence', 'g4-mobile-matrix.json')
const files = inputs.filter((file) => path.resolve(file) !== output)
const revision = sourceRevision(root)
const parsed = []
const readErrors = []
for (const file of files) {
  try { parsed.push(JSON.parse(fs.readFileSync(file, 'utf8'))) }
  catch (error) { readErrors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`) }
}
const result = validateMobileEvidence(parsed, revision === 'unknown' ? undefined : revision)
result.errors.unshift(...readErrors)
if (readErrors.length) result.status = 'FAILED'
writeEvidence(output, {
  schemaVersion: 'g4-mobile-matrix-summary-v1',
  generatedAt: new Date().toISOString(),
  sourceRevision: revision,
  status: result.status,
  inputs: files.map((file) => path.resolve(file)),
  errors: result.errors,
  requiredWidths: result.requiredWidths,
  humanReviewRequired: true,
  manuscriptContentRecorded: false,
})
if (result.status !== 'PASSED') process.exitCode = 1
