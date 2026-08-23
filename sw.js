// Change this release marker whenever the PWA is published.
const SW_RELEASE = '20260823-data-visibility-fix-v1';

self.addEventListener('install', (event) => {
    // Activate the new worker without waiting for all old tabs to close.
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    const localAsset = url.origin === self.location.origin &&
        ['document', 'script', 'style', 'manifest'].includes(request.destination);

    if (!localAsset || request.method !== 'GET') return;

    // Always revalidate local app assets. This prevents an old installed PWA
    // from keeping a stale HTML/JS/CSS version after a deployment.
    event.respondWith(fetch(request, { cache: 'no-store' }));
});

void SW_RELEASE;
