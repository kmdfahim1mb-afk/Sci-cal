/* Sci Cal — সম্পূর্ণ অফলাইন সার্ভিস ওয়ার্কার (v17)
   একবার ইন্টারনেটে খুললেই সব ফাইল ফোনে জমা হয়; এরপর ডেটা বন্ধ থাকলেও হুবহু একই চেহারায় খোলে। */
const VERSION = 'scical-v20';
const ADS = 'scical-ads';            /* বিজ্ঞাপনের ছবি — ভার্সন বদলালেও মোছা হয় না */
const CORE = ['./', 'index.html', 'config.js', 'adpopup.js', 'geodata.js', 'geoloc.js',
              'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(VERSION)
            .then(c => Promise.all(CORE.map(u =>
                fetch(new Request(u, { cache: 'reload' }))
                    .then(r => { if (r && r.ok) return c.put(u, r); })
                    .catch(() => {})
            )))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys
                .filter(k => k !== VERSION && k !== ADS)
                .map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    /* বাইরের ছবি (বিজ্ঞাপন): ক্যাশ আগে; না থাকলে নেটে, পেলে জমা রাখো */
    if (url.origin !== location.origin) {
        if (req.destination === 'image') {
            e.respondWith(
                caches.open(ADS).then(c =>
                    c.match(req.url).then(hit => hit ||
                        fetch(req.url, { mode: 'no-cors' }).then(r => { c.put(req.url, r.clone()); return r; }))
                ).catch(() => Response.error())
            );
        }
        return; /* Firestore ইত্যাদি সরাসরি নেটওয়ার্কে — অ্যাপ নিজে localStorage এ জমা রাখে */
    }

    /* অ্যাপের নিজের ফাইল: ক্যাশ আগে (অফলাইনে নিশ্চিত), ব্যাকগ্রাউন্ডে নতুন করে নেওয়া */
    e.respondWith(
        caches.match(req, { ignoreSearch: true }).then(hit => {
            const net = fetch(req).then(r => {
                if (r && r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
                return r;
            }).catch(() => null);
            if (hit) { e.waitUntil(net); return hit; }
            return net.then(r => r || (req.mode === 'navigate'
                ? caches.match('index.html').then(x => x || caches.match('./'))
                : Response.error()));
        })
    );
});

/* ---- অফলাইনে ব্যবহারের গণনা: ইন্টারনেট ফিরলে (অ্যাপ বন্ধ থাকলেও) পাঠানো ---- */
function idbOpen() {
    return new Promise((res, rej) => {
        const q = indexedDB.open('scical', 1);
        q.onupgradeneeded = () => q.result.createObjectStore('kv');
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
    });
}
function idbDo(db, mode, fn) {
    return new Promise((res, rej) => {
        const r = fn(db.transaction('kv', mode).objectStore('kv'));
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
}
async function flushPing() {
    const db = await idbOpen();
    const p = await idbDo(db, 'readonly', s => s.get('pending'));
    if (!p) return;
    const r = await fetch(p.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: p.body });
    if (r.ok || (r.status >= 400 && r.status < 500)) await idbDo(db, 'readwrite', s => s.delete('pending'));
    else throw new Error('retry');           /* সার্ভার সমস্যা — ব্রাউজার পরে আবার চেষ্টা করবে */
}
async function flushUsage() {
    const db = await idbOpen();
    const cfg = await idbDo(db, 'readonly', s => s.get('cfg'));
    if (!cfg) return;
    /* একসাথে পড়া ও খালি করা */
    const m = await new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv'), g = st.get('usage');
        let out = {};
        g.onsuccess = () => { out = g.result || {}; st.put({}, 'usage'); };
        tx.oncomplete = () => res(out); tx.onerror = tx.onabort = () => rej(tx.error);
    });
    const writes = [];
    Object.keys(m).forEach(d => {
        const n = Math.min(43200, Math.floor(m[d] || 0)); if (n < 1) return;
        writes.push({ update: { name: cfg.doc + '/usage/' + d, fields: { d: { stringValue: d } } }, updateMask: { fieldPaths: ['d'] },
                      updateTransforms: [{ fieldPath: 'secs', increment: { integerValue: String(n) } }] });
    });
    if (!writes.length) return;
    let ok = false;
    try { const r = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writes }) }); ok = r.ok; } catch (e) {}
    if (!ok) {                                /* ব্যর্থ হলে ফেরত রাখো, ব্রাউজার পরে আবার চেষ্টা করবে */
        await new Promise((res, rej) => {
            const tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv'), g = st.get('usage');
            g.onsuccess = () => { const cur = g.result || {}; for (const k in m) cur[k] = (cur[k] || 0) + m[k]; st.put(cur, 'usage'); };
            tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error);
        });
        throw new Error('retry');
    }
}
self.addEventListener('sync', e => {
    if (e.tag !== 'scical-ping') return;
    e.waitUntil(Promise.allSettled([flushPing(), flushUsage()]).then(rs => { if (rs.some(r => r.status === 'rejected')) throw new Error('retry'); }));
});
