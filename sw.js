const CACHE='bravia-v35-shell';
const ASSETS=['./','./index.html','./style.css','./app.js?v=33','./v32.css?v=33','./v32.js?v=33','./v34.css?v=34','./v34.js?v=34','./v35.css?v=35','./v35.js?v=35','./icon.svg','./manifest.webmanifest'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))))});
