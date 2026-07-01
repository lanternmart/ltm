// Wrap&Roll Rockhampton — Service Worker
// Update strategy: network-first for HTML/version so devices always get the latest;
// only cache *successful* responses (never broken/partial ones) to avoid white screens.
// The app also polls version.json and force-reloads (clearing caches) when the version changes.
var CACHE_NAME = 'wraproll-v6.4';
var APP_SHELL = ['./index.html','./manifest.json','./logo.png'];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      // Cache shell items individually so one missing file doesn't fail the whole install
      return Promise.all(APP_SHELL.map(function(u){
        return fetch(u, {cache:'no-store'}).then(function(r){
          if(r && r.ok) return cache.put(u, r);
        }).catch(function(){ /* ignore missing asset */ });
      }));
    }).then(function(){
      return self.skipWaiting(); // activate immediately
    })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){return k!==CACHE_NAME;})
            .map(function(k){return caches.delete(k);})
      );
    }).then(function(){
      return self.clients.claim();
    }).then(function(){
      return self.clients.matchAll({type:'window'}).then(function(clients){
        clients.forEach(function(c){ c.postMessage({type:'SW_UPDATED',version:CACHE_NAME}); });
      });
    })
  );
});

self.addEventListener('fetch', function(e){
  var url = new URL(e.request.url);

  // Never cache API calls
  if(url.hostname.indexOf('script.google.com')>-1 ||
     url.hostname.indexOf('googleusercontent.com')>-1){
    e.respondWith(fetch(e.request).catch(function(){
      return new Response('{"ok":false,"msg":"Offline"}',{headers:{'Content-Type':'application/json'}});
    }));
    return;
  }

  // index.html & version.json — ALWAYS network-first; only cache a fresh OK response.
  if(url.pathname.endsWith('/') || url.pathname.endsWith('index.html') || url.pathname.endsWith('version.json')){
    e.respondWith(
      fetch(e.request).then(function(resp){
        if(resp && resp.ok){
          var clone = resp.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(e.request, clone); });
        }
        return resp;
      }).catch(function(){
        return caches.match(e.request).then(function(m){ return m || caches.match('./index.html'); });
      })
    );
    return;
  }

  // Other assets — cache-first, but only store successful responses
  e.respondWith(
    caches.match(e.request).then(function(cached){
      return cached || fetch(e.request).then(function(resp){
        if(resp && resp.ok){
          var clone=resp.clone();
          caches.open(CACHE_NAME).then(function(cache){cache.put(e.request,clone);});
        }
        return resp;
      }).catch(function(){ return cached; });
    })
  );
});

// Allow the app to trigger skipWaiting manually
self.addEventListener('message', function(e){
  if(e.data&&e.data.type==='SKIP_WAITING') self.skipWaiting();
});
