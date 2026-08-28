const CURRENT_SHELL = 'bbd-shell-v2.2.0'
const SHELL_PREFIX = 'bbd-shell-'
const CORE = ['/', '/?mobile=1', '/mobile-acceptance.html', '/manifest.webmanifest', '/pwa-192.png', '/pwa-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CURRENT_SHELL)
    const shell = await fetch('/')
    if (!shell.ok) throw new Error(`shell HTTP ${shell.status}`)
    const html = await shell.clone().text()
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map((match) => match[1])
    await cache.put('/', shell)
    await cache.addAll([...CORE.filter((path) => path !== '/'), ...new Set(assets)])
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(async (keys) => {
    const shells = keys.filter((key) => key.startsWith(SHELL_PREFIX) && key !== CURRENT_SHELL)
    for (const key of shells.slice(0, -1)) await caches.delete(key)
    await self.clients.claim()
  }))
})

self.addEventListener('message', (event) => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting() })

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return
  event.respondWith((async () => {
    try {
      const response = await fetch(request)
      if (response.ok) { const cache = await caches.open(CURRENT_SHELL); await cache.put(request, response.clone()) }
      return response
    } catch {
      const exact = await caches.match(request)
      if (exact) return exact
      if (request.mode === 'navigate') {
        const keys = (await caches.keys()).filter((key) => key.startsWith(SHELL_PREFIX)).reverse()
        for (const key of keys) { const fallback = await (await caches.open(key)).match('/'); if (fallback) return fallback }
      }
      return new Response('离线资源暂不可用', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }
  })())
})
