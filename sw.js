/* Sci Cal — সম্পূর্ণ অফলাইন সার্ভিস ওয়ার্কার
   অ্যাপের ফাইল একবার ক্যাশ হলে ইন্টারনেট ছাড়াই হুবহু একই চেহারায় খুলবে।
   ক্লাউড (বিজ্ঞাপন/ঘোষণা/পরিসংখ্যান) ক্যাশ করা হয় না — সেগুলো index.html নিজেই localStorage এ জমা রাখে। */
const VERSION = 'scical-v9';
const CORE = ['./', 'index.html', 'config.js', 'adpopup.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(VERSION)
            .then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {}))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    /* বিজ্ঞাপনের ছবি: একবার দেখলে ক্যাশে রাখো, অফলাইনে সেখান থেকে দেখাও */
    if (url.origin !== location.origin) {
        if (req.destination === 'image') {
            e.respondWith(
                caches.open(VERSION + '-ads').then(c =>
                    c.match(req).then(hit => hit || fetch(req, { mode: 'no-cors' }).then(r => { c.put(req, r.clone()); return r; }))
                ).catch(() => Response.error())
            );
        }
        return; /* Firestore ইত্যাদি সরাসরি নেটওয়ার্কে */
    }

    /* অ্যাপের নিজের ফাইল: ক্যাশ আগে, পরে ব্যাকগ্রাউন্ডে নতুন করে নেওয়া */
    e.respondWith(
        caches.match(req, { ignoreSearch: true }).then(hit => {
            const net = fetch(req).then(r => {
                if (r && r.ok) caches.open(VERSION).then(c => c.put(req, r.clone()));
                return r;
            }).catch(() => null);
            if (hit) return hit;
            return net.then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
        })
    );
});
