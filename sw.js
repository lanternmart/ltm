// Lantern Mart — Service Worker
// Auto-update: SW activates immediately, reloads clients on new version.
// CACHE_NAME must match version.json + APP_VER in index.html (3 places per release).
var CACHE_NAME = 'lantern-v1.0.2';
var APP_SHELL = [
  './index.html','./manifest.json',
  './js/db.js','./js/supabase.js','./js/sync.js','./js/app.js',
  './icons/icon-192.png','./icons/icon-512.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(APP_SHELL).catch(function(){ /* tolerate missing optional files */ });
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){return k!==CACHE_NAME;})
                             .map(function(k){return caches.delete(k);}));
    }).then(function(){ return self.clients.claim(); })
     .then(function(){
       return self.clients.matchAll({type:'window'}).then(function(clients){
         clients.forEach(function(c){ c.postMessage({type:'SW_UPDATED',version:CACHE_NAME}); });
       });
     })
  );
});

self.addEventListener('fetch', function(e){
  var url = new URL(e.request.url);

  // Never cache Supabase or Lightspeed API
  if(url.hostname.indexOf('supabase.co')>-1 ||
     url.hostname.indexOf('lightspeedapp.com')>-1){
    e.respondWith(fetch(e.request).catch(function(){
      return new Response('{"error":"offline"}',{headers:{'Content-Type':'application/json'}});
    }));
    return;
  }

  // index.html + version.json — network-first (always latest)
  if(url.pathname.endsWith('/') || url.pathname.endsWith('index.html') || url.pathname.endsWith('version.json')){
    e.respondWith(
      fetch(e.request).then(function(resp){
        var clone=resp.clone();
        caches.open(CACHE_NAME).then(function(c){c.put(e.request,clone);});
        return resp;
      }).catch(function(){ return caches.match(e.request); })
    );
    return;
  }

  // Other assets — cache-first
  e.respondWith(
    caches.match(e.request).then(function(cached){
      return cached || fetch(e.request).then(function(resp){
        var clone=resp.clone();
        caches.open(CACHE_NAME).then(function(c){c.put(e.request,clone);});
        return resp;
      });
    })
  );
});

self.addEventListener('message', function(e){
  if(e.data&&e.data.type==='SKIP_WAITING') self.skipWaiting();
});
