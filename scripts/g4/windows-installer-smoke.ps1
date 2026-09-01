param(
  [Parameter(Mandatory = $true)][string]$InstallerPath,
  [string]$OutputPath = 'release/windows/install-smoke-evidence.json'
)

$ErrorActionPreference = 'Stop'
if (-not [Environment]::Is64BitOperatingSystem) { throw '安装烟测要求 Windows x64。' }
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$logDirectory = Split-Path -Parent (Join-Path (Resolve-Path -LiteralPath '.').Path $OutputPath)
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$installLog = Join-Path $logDirectory 'msi-install.log'
$uninstallLog = Join-Path $logDirectory 'msi-uninstall.log'
$installed = $false
$installCode = $null
$uninstallCode = $null

try {
  $install = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"$installer`"", '/qn', '/norestart', '/L*v', "`"$installLog`"") -Wait -PassThru
  $installCode = $install.ExitCode
  if ($installCode -notin @(0, 3010)) { throw "MSI 静默安装失败，退出码 $installCode。" }
  $installed = $true
} finally {
  if ($installed) {
    $uninstall = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/x', "`"$installer`"", '/qn', '/norestart', '/L*v', "`"$uninstallLog`"") -Wait -PassThru
    $uninstallCode = $uninstall.ExitCode
  }
}

$passed = $installCode -in @(0, 3010) -and $uninstallCode -in @(0, 3010)
$evidence = [ordered]@{
  schemaVersion = 'windows-installer-smoke-v1'
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  sourceRevision = (& git rev-parse HEAD).Trim()
  status = $(if ($passed) { 'PASSED' } else { 'FAILED' })
  installer = [ordered]@{
    fileName = [IO.Path]::GetFileName($installer)
    sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash.ToLowerInvariant()
  }
  checks = [ordered]@{
    silentInstall = $installCode -in @(0, 3010)
    silentUninstall = $uninstallCode -in @(0, 3010)
  }
  exitCodes = [ordered]@{ install = $installCode; uninstall = $uninstallCode }
  manuscriptContentRecorded = $false
}
$evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding utf8NoBOM
Write-Output "$($evidence.status): Windows MSI 安装/卸载烟测证据已写入 $OutputPath。"
if (-not $passed) { exit 1 }
