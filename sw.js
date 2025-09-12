self.addEventListener('install', (e)=>{ self.skipWaiting(); });
self.addEventListener('activate', (e)=>{ e.waitUntil(self.clients.claim()); });

const cachePaths = new Map(); // iid -> Promise<GeoJSON>
async function loadPaths(iid) {
  if (!cachePaths.has(iid)) {
    const resp = await fetch(`./api/instances/${iid}/paths.geojson`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`paths.geojson not found for ${iid}`);
    const gj = await resp.json();
    cachePaths.set(iid, Promise.resolve(gj));
  }
  return cachePaths.get(iid);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const path = url.pathname;

  // /api/instances 或 /api/instances/  ->  ./api/instances.json
  if (path.endsWith('/api/instances') || path.endsWith('/api/instances/')) {
    event.respondWith(fetch('./api/instances.json', { cache: 'no-store' }));
    return;
  }

  // /api/zones?highlight=...  -> ./api/zones.json（忽略 query）
  if (path.endsWith('/api/zones')) {
    event.respondWith(fetch('./api/zones.json', { cache: 'no-store' }));
    return;
  }

  // /api/instances/{iid}/route?o=Oi&d=Dj -> 從 paths.geojson 篩選回傳
  const m = path.match(/\/api\/instances\/(.+?)\/route$/);
  if (m) {
    const iid = m[1];
    const o = url.searchParams.get('o');
    const d = url.searchParams.get('d');
    event.respondWith((async () => {
      try {
        const gj = await loadPaths(iid);
        const feat = (gj.features || []).find(f => {
          const p = f.properties || {};
          return p.o === o && p.d === d;
        });
        const body = JSON.stringify(feat || {"type":"Feature","geometry":null,"properties":{"o":o,"d":d,"minutes":null,"note":"not_found"}});
        return new Response(body, { headers: { 'Content-Type': 'application/geo+json; charset=utf-8' } });
      } catch (e) {
        const body = JSON.stringify({"type":"Feature","geometry":null,"properties":{"o":o,"d":d,"minutes":null,"error": String(e)}});
        return new Response(body, { headers: { 'Content-Type': 'application/geo+json; charset=utf-8' } });
      }
    })());
    return;
  }
});