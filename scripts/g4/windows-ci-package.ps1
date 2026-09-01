param(
  [string]$BundleRoot = 'src-tauri/target/release/bundle',
  [string]$OutputPath = 'release/windows',
  [bool]$RequireSigned = $false
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath '.').Path
$resolvedBundle = (Resolve-Path -LiteralPath $BundleRoot).Path
$resolvedOutput = Join-Path $root $OutputPath
if (Test-Path -LiteralPath $resolvedOutput) { Remove-Item -LiteralPath $resolvedOutput -Recurse -Force }
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null

$nsis = @(Get-ChildItem -LiteralPath (Join-Path $resolvedBundle 'nsis') -Filter '*-setup.exe' -File)
$msi = @(Get-ChildItem -LiteralPath (Join-Path $resolvedBundle 'msi') -Filter '*.msi' -File)
if ($nsis.Count -ne 1 -or $msi.Count -ne 1) { throw "安装包数量异常：NSIS=$($nsis.Count)，MSI=$($msi.Count)。" }

$sourceRevision = (& git rev-parse HEAD).Trim()
$version = (Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json).version
$artifacts = @($nsis[0], $msi[0]) | ForEach-Object {
  $destination = Join-Path $resolvedOutput $_.Name
  Copy-Item -LiteralPath $_.FullName -Destination $destination
  $signature = Get-AuthenticodeSignature -LiteralPath $destination
  if ($RequireSigned -and $signature.Status -ne 'Valid') { throw "$($_.Name) 的 Authenticode 签名无效：$($signature.Status)。" }
  [ordered]@{
    fileName = $_.Name
    bytes = (Get-Item -LiteralPath $destination).Length
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
    signatureStatus = $signature.Status.ToString()
    signerThumbprint = $(if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { $null })
  }
}

$checksumLines = $artifacts | ForEach-Object { "$($_.sha256)  $($_.fileName)" }
$checksumLines | Set-Content -LiteralPath (Join-Path $resolvedOutput 'SHA256SUMS') -Encoding utf8NoBOM
$evidence = [ordered]@{
  schemaVersion = 'windows-ci-artifacts-v1'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  sourceRevision = $sourceRevision
  version = $version
  status = 'PASSED'
  distributionMode = $(if ($RequireSigned) { 'signed' } else { 'unsigned-internal-test' })
  publicDistributionReady = $RequireSigned
  host = [ordered]@{
    os = [Environment]::OSVersion.VersionString
    osArchitecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    processArchitecture = [Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()
  }
  artifacts = $artifacts
  containsCertificateOrPassword = $false
}
$evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $resolvedOutput 'build-evidence.json') -Encoding utf8NoBOM
Write-Output "PASSED: Windows $version 安装包已整理到 $OutputPath；模式=$($evidence.distributionMode)。"
