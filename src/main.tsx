import { Component, StrictMode, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import App from './App'
import { DesignGallery } from './ui/DesignGallery'
import './ui/tokens.css'
import './styles.css'
import './ui/foundations.css'
import './ui/components.css'
import './ui/shell.css'
import './ui/templates.css'

const galleryRequested = import.meta.env.DEV && (window.location.pathname === '/design-system' || new URLSearchParams(window.location.search).get('design-system') === '1')

let applicationRoot: Root | null = null

class NativeMobileErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <main style={{ boxSizing: 'border-box', minHeight: '100dvh', padding: '64px 28px', background: '#f3efe6', color: '#292722', font: '16px/1.7 -apple-system, BlinkMacSystemFont, sans-serif', textAlign: 'center' }}>
      <h1>笔不怠暂时未能打开</h1>
      <p>你的本机记录没有被改动，请完全退出应用后重新打开。</p>
      <button type="button" onClick={() => window.location.reload()} style={{ minHeight: 48, padding: '0 24px', border: 0, borderRadius: 12, background: '#2f6650', color: 'white', font: 'inherit', fontWeight: 700 }}>重新打开</button>
    </main>
  }
}

declare global {
  interface Window {
    __BBD_MOUNT_APPLICATION__?: () => void
  }
}

export function mountApplication() {
  const container = document.getElementById('root')
  if (!container || container.childElementCount > 0) return
  const nativeMobile = window.location.protocol === 'tauri:' && new URLSearchParams(window.location.search).get('mobile') === '1'
  applicationRoot ??= createRoot(container)
  const content = galleryRequested ? <DesignGallery /> : <App />
  const application = <StrictMode>{nativeMobile ? <NativeMobileErrorBoundary>{content}</NativeMobileErrorBoundary> : content}</StrictMode>
  if (nativeMobile) flushSync(() => applicationRoot!.render(application))
  else applicationRoot.render(application)
}

window.__BBD_MOUNT_APPLICATION__ = mountApplication

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', mountApplication, { once: true })
} else {
  mountApplication()
}
