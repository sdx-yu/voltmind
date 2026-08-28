import '@testing-library/jest-dom/vitest'

if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => undefined
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
}
if (typeof URL !== 'undefined') {
  if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:test'
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => undefined
}
