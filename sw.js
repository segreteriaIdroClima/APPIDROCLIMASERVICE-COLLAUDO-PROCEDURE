const CACHE_SCOPE = 'idroclima-procedures-'+new URL(self.registration.scope).pathname.replace(/[^a-z0-9]/gi,'_');
const CACHE_NAME = CACHE_SCOPE+'-rc1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './admin-tools.js',
    './release-config.js',
    './procedures-day.js',
    './procedures-day.css',
    './jsQR.js',
    './manifest.json',
    './idroclima-app-192.png',
    './idroclima-app-512.png',
    './idroclima-drop-48.png'
];

self.addEventListener('install', (evt) => {
    evt.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
    evt.waitUntil(
        caches.keys().then((keyList) => Promise.all(
            keyList.map((key) => key.startsWith(CACHE_SCOPE+'-') && key !== CACHE_NAME && key !== CACHE_SCOPE+'-account' ? caches.delete(key) : undefined)
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', (evt) => {
    const requestUrl = new URL(evt.request.url);

    if (requestUrl.hostname.includes('script.google.com') || requestUrl.hostname.includes('googleusercontent.com')) {
        return;
    }

    if (evt.request.method !== 'GET') {
        return;
    }

    const isLocalAsset = requestUrl.origin === self.location.origin;
    const isFreshAsset = isLocalAsset && (
        evt.request.mode === 'navigate' ||
        requestUrl.pathname.endsWith('.html') ||
        requestUrl.pathname.endsWith('.js') ||
        requestUrl.pathname.endsWith('.css') ||
        requestUrl.pathname.endsWith('manifest.json')
    );

    if (isFreshAsset) {
        evt.respondWith(
            fetch(evt.request)
                .then((networkResponse) => {
                    const responseCopy = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(evt.request, responseCopy));
                    return networkResponse;
                })
                .catch(() => caches.match(evt.request,{ignoreSearch:true}))
        );
        return;
    }

    evt.respondWith(
        caches.match(evt.request,{ignoreSearch:true}).then((cachedResponse) => {
            return cachedResponse || fetch(evt.request).then((networkResponse) => {
                if (isLocalAsset) {
                    const responseCopy = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(evt.request, responseCopy));
                }
                return networkResponse;
            });
        })
    );
});

/* PROCEDURES ADDITION: only generic payloads; never cache documents or API tokens. */
const ACCOUNT_CACHE=CACHE_SCOPE+'-account';
const ACCOUNT_URL=new URL('__push_account__',self.registration.scope).href;
self.addEventListener('message',evt=>{if(!evt.source?.url?.startsWith(self.registration.scope))return;if(evt.data?.type==='IDROCLIMA_PUSH_ACCOUNT')evt.waitUntil(caches.open(ACCOUNT_CACHE).then(c=>evt.data.userId?c.put(ACCOUNT_URL,new Response(JSON.stringify({userId:String(evt.data.userId)}))):c.delete(ACCOUNT_URL)));});
self.addEventListener('push',evt=>{evt.waitUntil((async()=>{let data;try{data=evt.data.json();}catch{return;}const cache=await caches.open(ACCOUNT_CACHE),stored=await cache.match(ACCOUNT_URL);if(!stored||String((await stored.json()).userId)!==String(data.userId))return;await self.registration.showNotification('Procedure per i lavori di oggi',{body:'Apri le procedure collegate alla tua giornata.',icon:new URL('idroclima-app-192.png',self.registration.scope).href,badge:new URL('idroclima-drop-48.png',self.registration.scope).href,tag:data.tag,requireInteraction:true,data:{userId:String(data.userId)}});})());});
self.addEventListener('notificationclick',evt=>{evt.notification.close();evt.waitUntil((async()=>{const cache=await caches.open(ACCOUNT_CACHE),stored=await cache.match(ACCOUNT_URL);if(!stored||String((await stored.json()).userId)!==evt.notification.data?.userId)return;const url=new URL('index.html?procedures=today',self.registration.scope).href;const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const existing=windows.find(w=>w.url.startsWith(self.registration.scope));if(existing){await existing.focus();existing.postMessage({type:'IDROCLIMA_PROCEDURES_OPEN'});}else await self.clients.openWindow(url);})());});
