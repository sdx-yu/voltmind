const REQUIRED_WIDTHS = [360, 390, 430]
const REQUIRED_MANUAL_CHECKS = ['imeComposition', 'offlineReopen', 'weakNetworkSave', 'pwaUpdate', 'encryptedHandoff']

export function validateMobileEvidence(items, expectedRevision) {
  const errors = []
  if (!Array.isArray(items) || items.length < 3) errors.push('至少需要 3 份真机证据')
  const evidence = Array.isArray(items) ? items : []
  evidence.forEach((item, index) => {
    const prefix = `证据 ${index + 1}`
    if (item?.schemaVersion !== 'g4-mobile-device-v1') errors.push(`${prefix} schemaVersion 不正确`)
    if (!/^1\.6\.0$/.test(item?.appVersion ?? '')) errors.push(`${prefix} 应用版本不是 1.6.0`)
    if (!/^[a-f0-9]{7,40}$/i.test(item?.sourceRevision ?? '')) errors.push(`${prefix} 缺少源码修订号`)
    if (expectedRevision && !expectedRevision.startsWith(item?.sourceRevision ?? '')) errors.push(`${prefix} 源码修订号与当前提交不一致`)
    if (!Number.isFinite(item?.viewport?.width) || !Number.isFinite(item?.viewport?.height)) errors.push(`${prefix} 缺少视口尺寸`)
    if (!item?.runtime?.secureContext || !item?.runtime?.serviceWorkerSupported || !(item?.runtime?.touchPoints > 0)) errors.push(`${prefix} 不是可验证的安全触控 PWA 环境`)
    if (!item?.runtime?.healthOk) errors.push(`${prefix} 未通过本地服务健康检查`)
    for (const id of REQUIRED_MANUAL_CHECKS) if (item?.checks?.[id] !== true) errors.push(`${prefix} 未通过 ${id}`)
    if (typeof item?.screenshotReference !== 'string' || !item.screenshotReference.trim()) errors.push(`${prefix} 缺少脱敏截图引用`)
    if (item?.manuscriptContentRecorded !== false) errors.push(`${prefix} 不得记录正文`)
  })

  for (const width of REQUIRED_WIDTHS) {
    if (!evidence.some((item) => Math.abs(item?.viewport?.width - width) <= 3)) errors.push(`缺少 ${width}px（±3px）真机视口`)
  }
  const agents = evidence.map((item) => item?.runtime?.userAgent ?? '')
  if (!agents.some(isIosSafari)) errors.push('缺少 iOS Safari 真机证据')
  if (!agents.some(isAndroidChrome)) errors.push('缺少 Android Chrome 真机证据')
  return { status: errors.length ? 'FAILED' : 'PASSED', errors, requiredWidths: REQUIRED_WIDTHS }
}

function isIosSafari(userAgent) {
  return /(iPhone|iPad|iPod)/i.test(userAgent) && /Safari/i.test(userAgent) && !/(CriOS|FxiOS|EdgiOS)/i.test(userAgent)
}

function isAndroidChrome(userAgent) {
  return /Android/i.test(userAgent) && /Chrome\//i.test(userAgent) && !/(EdgA|OPR)/i.test(userAgent)
}
