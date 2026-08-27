export type PwaRegistrationState = { registration: ServiceWorkerRegistration | null; updateReady: boolean; offlineReady: boolean }

export async function registerPwa(onChange: (state: PwaRegistrationState) => void): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || (!import.meta.env.PROD && !new URLSearchParams(location.search).has('pwa-test'))) return null
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  const emit = (updateReady = Boolean(registration.waiting)) => onChange({ registration, updateReady, offlineReady: Boolean(navigator.serviceWorker.controller) })
  emit()
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing
    worker?.addEventListener('statechange', () => { if (worker.state === 'installed') emit(Boolean(navigator.serviceWorker.controller)) })
  })
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
  return registration
}

export function activatePwaUpdate(registration: ServiceWorkerRegistration | null) { registration?.waiting?.postMessage({ type: 'SKIP_WAITING' }) }
