import { describe, expect, it } from 'vitest'
import { finalizeReleaseEvidence } from '../../scripts/release-readiness-core.mjs'

describe('G4-A release readiness evidence', () => {
  it('keeps public release blocked when external evidence is absent', () => {
    const evidence = finalizeReleaseEvidence({
      releaseDecision: 'NO-GO',
      source: { trackedChanges: false },
      versions: { aligned: true },
      materials: {
        sbom: { valid: true, checksumRecorded: true },
        thirdPartyLicenses: { valid: true, checksumRecorded: true },
        checksumManifest: { artifactRecorded: true },
      },
      macOS: {
        appExists: true,
        signatureStructureValid: true,
        dmgExists: true,
        dmgValid: true,
        developerIdSigned: false,
        gatekeeperAccepted: false,
        notarizationStapled: false,
      },
      windows: { installers: [], signedInstallerVerified: false, installUninstallImeRecoveryMatrix: 'pending_external_windows_x64' },
      mobile: { realDeviceMatrix: 'pending_external_devices' },
      seedValidation: { status: 'pending_external_authors_and_time', fixtureEvidenceAccepted: false },
    })

    expect(evidence.releaseDecision).toBe('NO-GO')
    expect(evidence.gates.map((gate: { id: string }) => gate.id)).toEqual([
      'G4-SOURCE', 'G4-MATERIALS', 'G4-MAC-BUILD', 'G4-MAC-DISTRIBUTION', 'G4-WINDOWS', 'G4-MOBILE', 'R1-SEED',
    ])
    expect(evidence.gates.filter((gate: { evidenceClass: string }) => gate.evidenceClass === 'engineering').every((gate: { status: string }) => gate.status === 'PASS')).toBe(true)
    expect(evidence.gates.filter((gate: { evidenceClass: string }) => gate.evidenceClass === 'external').every((gate: { status: string }) => gate.status === 'BLOCKED')).toBe(true)
  })

  it('requires every gate before returning GO', () => {
    const evidence = finalizeReleaseEvidence({
      source: { trackedChanges: false }, versions: { aligned: true },
      materials: { sbom: { valid: true, checksumRecorded: true }, thirdPartyLicenses: { valid: true, checksumRecorded: true }, checksumManifest: { artifactRecorded: true } },
      macOS: { appExists: true, signatureStructureValid: true, dmgExists: true, dmgValid: true, developerIdSigned: true, gatekeeperAccepted: true, notarizationStapled: true },
      windows: { installers: ['signed.exe'], signedInstallerVerified: true, installUninstallImeRecoveryMatrix: 'passed' },
      mobile: { realDeviceMatrix: 'passed' }, seedValidation: { status: 'passed' },
    })
    expect(evidence.releaseDecision).toBe('GO')
    expect(evidence.gates.every((gate: { status: string }) => gate.status === 'PASS')).toBe(true)
  })
})
