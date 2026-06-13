const CACHE_NAME = 'meatdae-v19';
const ASSETS = [
    '/index.html',
    '/check_out.html',
    '/payment.html',
    '/css/style.css',
    '/css/swiggy-theme.css',
    '/css/premium-theme.css',
    '/css/cart-redesign.css',
    '/js/main.js',
    '/js/payment.js',
    '/js/order-notifier.js',
    '/js/firebase-config.js'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Strategy: Stale-while-revalidate for local assets, Network-first for HTML
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. HARDEN: Only handle GET requests to the same origin.
    // Explicitly bypass internal Firebase auth paths (/__/) and cross-origin requests.
    if (
        event.request.method !== 'GET' || 
        url.origin !== self.location.origin ||
        url.pathname.startsWith('/__/')
    ) {
        return;
    }

    // 2. HARDEN: Skip common non-asset schemes
    if (!url.protocol.startsWith('http')) return;

    const isHTML = event.request.mode === 'navigate' || url.pathname.endsWith('.html');

    if (isHTML) {
        // Network-first for HTML pages
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
    } else {
        // Stale-while-revalidate for local assets (JS, CSS, Images)
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                const fetchPromise = fetch(event.request).then((networkResponse) => {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
                    return networkResponse;
                });
                return cachedResponse || fetchPromise;
            })
        );
    }
});