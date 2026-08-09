self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // هذا الكود فارغ عمداً، وظيفته فقط إقناع المتصفح أن التطبيق قابل للتثبيت
});
