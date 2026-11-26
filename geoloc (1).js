/* Sci Cal — এলাকা অনুযায়ী বিজ্ঞাপন (SciGeo) — শুধু ইন্টারনেট ঠিকানা (IP) ভিত্তিক, কোনো অনুমতি চায় না
   - ব্যবহারকারীর এলাকা (দেশ + আনুমানিক জেলা) ফোনেই জমা থাকে (scical_loc)
   - শুধু তখনই খোঁজে যখন অন্তত একটি চালু বিজ্ঞাপনে এলাকা দেওয়া আছে
   - বিজ্ঞাপনের geo ফরম্যাট: "BD" (দেশ) · "BD/Dhaka" (জেলা); একাধিক হলে ; দিয়ে আলাদা */
(function () {
    var D = window.SCICAL_DISTRICTS || [];
    var KEY = 'scical_loc', CLOUD = 'scical_cloud_v1';
    var IP_URL = 'https://get.geojs.io/v1/ip/geo.json';
    var IP_FRESH = 12 * 36e5;
    var COUNTRY = { BD: ['বাংলাদেশ', 'Bangladesh'], IN: ['ভারত', 'India'], PK: ['পাকিস্তান', 'Pakistan'], NP: ['নেপাল', 'Nepal'],
        LK: ['শ্রীলঙ্কা', 'Sri Lanka'], SA: ['সৌদি আরব', 'Saudi Arabia'], AE: ['সংযুক্ত আরব আমিরাত', 'UAE'], QA: ['কাতার', 'Qatar'],
        KW: ['কুয়েত', 'Kuwait'], OM: ['ওমান', 'Oman'], MY: ['মালয়েশিয়া', 'Malaysia'], SG: ['সিঙ্গাপুর', 'Singapore'],
        GB: ['যুক্তরাজ্য', 'United Kingdom'], US: ['যুক্তরাষ্ট্র', 'United States'], CA: ['কানাডা', 'Canada'], AU: ['অস্ট্রেলিয়া', 'Australia'],
        IT: ['ইতালি', 'Italy'], JP: ['জাপান', 'Japan'], KR: ['দক্ষিণ কোরিয়া', 'South Korea'] };

    function ls(k, v) {
        try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {}
        return null;
    }
    function lang() { return ls('calcLang') === 'en' ? 'en' : 'bn'; }
    function tr(b, e) { return lang() === 'en' ? e : b; }
    /* নাম মেলানোর জন্য: ছোট হাতের, "district/division" শব্দ বাদ, শুধু অক্ষর-সংখ্যা */
    function norm(s) {
        return String(s == null ? '' : s).toLowerCase()
            .replace(/\b(district|division|upazila|upazilla|zila|thana)\b/g, ' ')
            .replace(/[^a-z0-9ঀ-৿]/g, '');
    }
    function dNames(d) { return [norm(d.en)].concat((d.alt || []).map(norm)); }
    function findDistrict(tok) {
        for (var i = 0; i < D.length; i++) if (dNames(D[i]).indexOf(tok) >= 0) return D[i];
        return null;
    }
    function nearest(lat, lng) {
        var best = null, bd = 1e9;
        D.forEach(function (d) {
            var dx = (d.lng - lng) * Math.cos(lat * Math.PI / 180), dy = d.lat - lat, v = dx * dx + dy * dy;
            if (v < bd) { bd = v; best = d; }
        });
        return best;
    }

    function get() { try { return JSON.parse(ls(KEY) || 'null'); } catch (e) { return null; } }
    function put(loc) { ls(KEY, loc ? JSON.stringify(loc) : null); renderStatus(); }

    /* অন্তত একটি জমানো চালু বিজ্ঞাপনে এলাকা দেওয়া আছে কি? */
    function needed() {
        try {
            var d = JSON.parse(ls(CLOUD) || 'null');
            return !!(d && d.ads && d.ads.some(function (a) { return a && a.active && a.geo; }));
        } catch (e) { return false; }
    }

    /* ---------- বিজ্ঞাপনের সঙ্গে মেলানো ---------- */
    function match(geo) {
        if (!geo) return true;                              /* এলাকা দেওয়া নেই = সব জায়গায় */
        var loc = get();
        if (!loc || !loc.c) return false;                   /* এলাকা অজানা হলে শুধু "সব জায়গার" বিজ্ঞাপন */
        var names = loc.n || [], toks = String(geo).split(';');
        for (var i = 0; i < toks.length; i++) {
            var p = toks[i].split('/');
            if (String(p[0]).trim().toUpperCase() !== loc.c) continue;
            if (p.length < 2 || !String(p[1]).trim()) return true;               /* শুধু দেশ */
            var dt = norm(p[1]), dd = findDistrict(dt), dn = dd ? dNames(dd) : [dt];
            if ((loc.d && dn.indexOf(norm(loc.d)) >= 0) || names.some(function (x) { return dn.indexOf(x) >= 0; })) return true;   /* জেলা */
        }
        return false;
    }

    /* ---------- এলাকা বের করা (IP) ---------- */
    function ipLookup() {
        return fetch(IP_URL, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
            var c = String(j.country_code || '').toUpperCase();
            if (!c) return null;
            var loc = { c: c, n: [], src: 'ip', ts: Date.now() };
            [j.city, j.region].forEach(function (x) { x = norm(x); if (x && loc.n.indexOf(x) < 0) loc.n.push(x); });
            if (c === 'BD' && isFinite(+j.latitude) && isFinite(+j.longitude)) { var d = nearest(+j.latitude, +j.longitude); if (d) loc.d = d.en; }
            return loc;
        });
    }

    var busy = false;
    function refresh(force) {
        if (busy || !navigator.onLine) return Promise.resolve();
        if (!force && !needed()) return Promise.resolve();
        var cur = get();
        if (!force && cur && Date.now() - (cur.ts || 0) < IP_FRESH) return Promise.resolve();
        busy = true;
        return ipLookup().then(function (l) { if (l) put(l); }).catch(function () {}).then(function () { busy = false; renderStatus(); });
    }

    /* ---------- সেটিংস অংশ ---------- */
    function setMsg(t) { var e = document.getElementById('geoMsg'); if (e) e.textContent = t; }
    function cname(c) { return (COUNTRY[c] && COUNTRY[c][lang() === 'en' ? 1 : 0]) || c; }
    function renderStatus() {
        var el = document.getElementById('geoStatus'); if (!el) return;
        var l = get();
        if (!l || !l.c) { el.textContent = tr('এলাকা এখনো জানা নেই।', 'Location not known yet.'); return; }
        var d = l.d ? findDistrict(norm(l.d)) : null;
        el.textContent = cname(l.c) + (d ? ' › ' + (lang() === 'en' ? d.en : d.bn) : '') + ' (' + tr('আনুমানিক', 'approx.') + ')';
    }
    function injectSettings() {
        var m = document.getElementById('settingsModal');
        if (!m || document.getElementById('geoBox')) return;
        var card = m.querySelector('div'), p = card && card.querySelector('p');
        if (!card) return;
        var sec = document.createElement('div');
        sec.id = 'geoBox';
        sec.style.cssText = 'margin-top:12px;padding-top:10px;border-top:1px solid #334155';
        sec.innerHTML =
            '<div style="font-size:11px;color:#94a3b8;font-weight:600;margin-bottom:4px">📍 ' + tr('আমার এলাকা (এলাকা অনুযায়ী বিজ্ঞাপন)', 'My area (for local ads)') + '</div>' +
            '<div id="geoStatus" style="font-size:11px;color:#e2e8f0"></div>' +
            '<div style="display:flex;gap:6px;margin-top:6px">' +
            '<button id="geoRefBtn" style="flex:1;font-size:11px;font-weight:700;padding:6px;border-radius:8px;background:#0e7490;color:#fff;border:0">' + tr('আবার খুঁজুন', 'Detect again') + '</button>' +
            '<button id="geoClrBtn" style="font-size:11px;padding:6px 10px;border-radius:8px;background:#1e293b;color:#cbd5e1;border:0">' + tr('মুছুন', 'Clear') + '</button></div>' +
            '<div id="geoMsg" style="font-size:10px;color:#fbbf24;margin-top:4px"></div>' +
            '<div style="font-size:9px;color:#64748b;margin-top:4px;line-height:1.3">' +
            tr('আপনার ইন্টারনেট ঠিকানা (IP) থেকে দেশ ও আনুমানিক জেলা ধরা হয়, কোনো অনুমতি লাগে না। এলাকা আপনার ফোনেই থাকে। খুঁজতে বিনামূল্যের তৃতীয়-পক্ষ সেবা (geojs.io) ব্যবহার হয়, শুধু এলাকা-ভিত্তিক বিজ্ঞাপন চালু থাকলে।',
               'Your country and approximate district are found from your internet address (IP); no permission needed. The area stays on your phone. A free third-party service (geojs.io) is used, only when local ads are enabled.') + '</div>';
        card.insertBefore(sec, p || null);
        document.getElementById('geoRefBtn').onclick = function () {
            if (!navigator.onLine) return setMsg(tr('ইন্টারনেট চালু করে আবার চেষ্টা করুন।', 'Turn on internet and try again.'));
            setMsg(tr('খোঁজা হচ্ছে…', 'Detecting…'));
            refresh(true).then(function () { setMsg(get() ? tr('হয়েছে ✅', 'Done ✅') : tr('এলাকা পাওয়া যায়নি।', 'Could not detect.')); });
        };
        document.getElementById('geoClrBtn').onclick = function () { put(null); setMsg(''); };
        renderStatus();
    }

    function init() {
        injectSettings();
        var open = window.openSettings;
        if (typeof open === 'function') window.openSettings = function () { var r = open.apply(this, arguments); injectSettings(); renderStatus(); return r; };
        setTimeout(function () { refresh(false); }, 4000);          /* ক্লাউড ডেটা আসার পর */
        window.addEventListener('online', function () { setTimeout(function () { refresh(false); }, 3000); });
    }
    window.SciGeo = { match: match, get: get, refresh: refresh, norm: norm };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
