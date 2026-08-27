param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [Parameter(Mandatory = $true)][bool]$InstallPassed,
  [Parameter(Mandatory = $true)][bool]$UninstallPassed,
  [Parameter(Mandatory = $true)][bool]$MicrosoftPinyinPassed,
  [Parameter(Mandatory = $true)][bool]$SogouPinyinPassed,
  [Parameter(Mandatory = $true)][bool]$RecoveryPassed,
  [Parameter(Mandatory = $true)][string]$ScreenshotReference
)

$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitOperatingSystem) { throw 'G4 Windows 矩阵要求 x64 Windows。' }
$resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
$signature = Get-AuthenticodeSignature -LiteralPath $resolvedInstaller
$signatureValid = $signature.Status -eq 'Valid'
$languages = Get-WinUserLanguageList | ForEach-Object {
  [PSCustomObject]@{ LanguageTag = $_.LanguageTag; InputMethodTips = @($_.InputMethodTips) }
}
$sourceRevision = (& git rev-parse HEAD).Trim()
$checks = [ordered]@{
  authenticodeValid = $signatureValid
  install = $InstallPassed
  uninstall = $UninstallPassed
  microsoftPinyinComposition = $MicrosoftPinyinPassed
  sogouPinyinComposition = $SogouPinyinPassed
  recoveryAfterForcedTermination = $RecoveryPassed
}
$passed = ($checks.Values | Where-Object { -not $_ }).Count -eq 0
$evidence = [ordered]@{
  schemaVersion = 'g4-windows-matrix-v1'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  sourceRevision = $sourceRevision
  status = $(if ($passed) { 'PASSED' } else { 'FAILED' })
  host = [ordered]@{
    os = [Environment]::OSVersion.VersionString
    osArchitecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    processArchitecture = [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()
  }
  installer = [ordered]@{
    fileName = [IO.Path]::GetFileName($resolvedInstaller)
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedInstaller).Hash.ToLowerInvariant()
    signatureStatus = $signature.Status.ToString()
    signerThumbprint = $signature.SignerCertificate.Thumbprint
  }
  installedInputMethods = @($languages)
  checks = $checks
  screenshotReference = $ScreenshotReference
  manuscriptContentRecorded = $false
}
$parent = Split-Path -Parent $OutputPath
if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
$evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Output "$($evidence.status): $OutputPath"
if (-not $passed) { exit 1 }
