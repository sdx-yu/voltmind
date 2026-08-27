export type ReleaseGate = {
  id: string
  evidenceClass: 'engineering' | 'external'
  status: 'PASS' | 'BLOCKED'
  requirement: string
}

export type ReleaseEvidenceInput = {
  source: { trackedChanges: boolean }
  versions: { aligned: boolean }
  materials: {
    sbom: { valid: boolean; checksumRecorded: boolean }
    thirdPartyLicenses: { valid: boolean; checksumRecorded: boolean }
    checksumManifest: { artifactRecorded: boolean }
  }
  macOS: {
    appExists: boolean
    signatureStructureValid: boolean
    dmgExists: boolean
    dmgValid: boolean
    developerIdSigned: boolean
    gatekeeperAccepted: boolean
    notarizationStapled: boolean
  }
  windows: {
    installers: string[]
    signedInstallerVerified: boolean
    installUninstallImeRecoveryMatrix: string
  }
  mobile: { realDeviceMatrix: string }
  seedValidation: { status: string }
}

export function finalizeReleaseEvidence<T extends ReleaseEvidenceInput>(evidence: T): T & {
  releaseDecision: 'GO' | 'NO-GO'
  gates: ReleaseGate[]
}
