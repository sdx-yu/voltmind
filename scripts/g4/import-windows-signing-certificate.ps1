param()

$ErrorActionPreference = 'Stop'
$certificateBase64 = $env:WINDOWS_CERTIFICATE_BASE64
$certificatePassword = $env:WINDOWS_CERTIFICATE_PASSWORD
$timestampUrl = $env:WINDOWS_TIMESTAMP_URL

if ([string]::IsNullOrWhiteSpace($certificateBase64)) {
  'BBD_WINDOWS_SIGNING_ENABLED=0' | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
  Write-Output '未配置代码签名证书：将生成“未知发布者”的 Windows 内测包。'
  exit 0
}
if ([string]::IsNullOrWhiteSpace($certificatePassword)) { throw '已配置证书但缺少 WINDOWS_CERTIFICATE_PASSWORD。' }
if ($timestampUrl -notmatch '^https://') { throw '签名构建必须配置 HTTPS WINDOWS_TIMESTAMP_URL。' }

$pfxPath = Join-Path $env:RUNNER_TEMP 'bibudai-windows-signing.pfx'
try {
  [IO.File]::WriteAllBytes($pfxPath, [Convert]::FromBase64String($certificateBase64))
  $securePassword = ConvertTo-SecureString $certificatePassword -AsPlainText -Force
  $certificate = Import-PfxCertificate -FilePath $pfxPath -CertStoreLocation 'Cert:\CurrentUser\My' -Password $securePassword
  if (-not $certificate.HasPrivateKey) { throw '导入的 Windows 代码签名证书没有私钥。' }
  if ($certificate.NotAfter -le (Get-Date)) { throw 'Windows 代码签名证书已过期。' }
  if (-not ($certificate.EnhancedKeyUsageList.ObjectId.Value -contains '1.3.6.1.5.5.7.3.3')) { throw '证书不包含代码签名用途。' }
  "WINDOWS_CERTIFICATE_THUMBPRINT=$($certificate.Thumbprint)" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
  'BBD_WINDOWS_SIGNING_ENABLED=1' | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
  Write-Output 'Windows 代码签名证书已导入；后续日志只记录证书指纹，不记录证书或密码。'
} finally {
  Remove-Item -LiteralPath $pfxPath -Force -ErrorAction SilentlyContinue
}
