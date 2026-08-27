export function finalizeReleaseEvidence(evidence) {
  const gates = [
    gate('G4-SOURCE', 'engineering', evidence.versions.aligned && !evidence.source.trackedChanges, '版本一致且受跟踪源码无改动'),
    gate('G4-MATERIALS', 'engineering', evidence.materials.sbom.valid && evidence.materials.sbom.checksumRecorded && evidence.materials.thirdPartyLicenses.valid && evidence.materials.thirdPartyLicenses.checksumRecorded && evidence.materials.checksumManifest.artifactRecorded, 'SBOM、许可证和当前安装包哈希可验证'),
    gate('G4-MAC-BUILD', 'engineering', evidence.macOS.appExists && evidence.macOS.signatureStructureValid && evidence.macOS.dmgExists && evidence.macOS.dmgValid, 'macOS 应用结构与 DMG 可验证'),
    gate('G4-MAC-DISTRIBUTION', 'external', evidence.macOS.developerIdSigned && evidence.macOS.gatekeeperAccepted && evidence.macOS.notarizationStapled, '需要 Developer ID、Gatekeeper 接受和公证票据'),
    gate('G4-WINDOWS', 'external', evidence.windows.installers.length > 0 && evidence.windows.signedInstallerVerified && evidence.windows.installUninstallImeRecoveryMatrix === 'passed', '需要 Windows x64 签名包和真机矩阵'),
    gate('G4-MOBILE', 'external', evidence.mobile.realDeviceMatrix === 'passed', '需要真实移动设备、弱网和 PWA 更新矩阵'),
    gate('R1-SEED', 'external', evidence.seedValidation.status === 'passed', '需要至少 5 名两周、3 名四周的真实作者证据'),
  ]
  return { ...evidence, releaseDecision: gates.every((item) => item.status === 'PASS') ? 'GO' : 'NO-GO', gates }
}

function gate(id, evidenceClass, passed, requirement) {
  return { id, evidenceClass, status: passed ? 'PASS' : 'BLOCKED', requirement }
}
