// Service Worker - 离线缓存
const CACHE = 'dengguangtong-v1'

self.addEventListener('install', e=>{
  e.waitUntil(
    caches.open(CACHE).then(c=> c.addAll(['./', './index.html', './manifest.json', './icon-512.png']))
  )
  self.skipWaiting()
})

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=> Promise.all(keys.filter(k=>k!==CACHE).map(k=> caches.delete(k))))
  )
  self.clients.claim()
})

self.addEventListener('fetch', e=>{
  e.respondWith(
    caches.match(e.request).then(r=> r || fetch(e.request).then(resp=>{
      // 缓存新请求
      if(resp && resp.status===200) {
        const clone = resp.clone()
        caches.open(CACHE).then(c=> c.put(e.request, clone))
      }
      return resp
    }).catch(()=> caches.match('./index.html')))
  )
})
