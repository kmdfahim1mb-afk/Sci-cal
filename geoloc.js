/* Sci Cal — এলাকা অনুযায়ী বিজ্ঞাপন (SciGeo)
   - ব্যবহারকারীর এলাকা ফোনেই জমা থাকে (scical_loc); কোনো সার্ভারে পাঠানো হয় না
   - এলাকা জানার পথ: (১) GPS (অনুমতি দিলে) → জেলা + উপজেলার নাম, (২) ইন্টারনেট ঠিকানা (IP) → দেশ + আনুমানিক জেলা
   - শুধু তখনই কাজ করে যখন অন্তত একটি বিজ্ঞাপনে এলাকা দেওয়া আছে (না থাকলে অনুমতিও চায় না, IP-ও খোঁজে না)
   - বিজ্ঞাপনের geo ফরম্যাট: "BD" (দেশ) · "BD/Dhaka" (জেলা) · "BD/Dhaka/Savar,Savar Upazila" (উপজেলা, একাধিক বানান কমা দিয়ে); একাধিক হলে ; দিয়ে আলাদা */
(function () {
    var D = window.SCICAL_DISTRICTS || [];
    var KEY = 'scical_loc', ASK = 'scical_loc_asked', OPENS = 'scical_opens', CLOUD = 'scical_cloud_v1';
    var IP_URL = 'https://get.geojs.io/v1/ip/geo.json';
    var REV_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
    var GPS_FRESH = 7 * 864e5, IP_FRESH = 12 * 36e5;
    var COUNTRY = { BD: ['বাংলাদেশ', 'Bangladesh'], IN: ['ভারত', 'India'], PK: ['পাকিস্তান', 'Pakistan'], NP: ['নেপাল', 'Nepal'],
        SA: ['সৌদি আরব', 'Saudi Arabia'], AE: ['সংযুক্ত আরব আমিরাত', 'UAE'], QA: ['কাতার', 'Qatar'], KW: ['কুয়েত', 'Kuwait'],
        OM: ['ওমান', 'Oman'], MY: ['মালয়েশিয়া', 'Malaysia'], SG: ['সিঙ্গাপুর', 'Singapore'], GB: ['যুক্তরাজ্য', 'United Kingdom'],
        US: ['যুক্তরাষ্ট্র', 'United States'], CA: ['কানাডা', 'Canada'], AU: ['অস্ট্রেলিয়া', 'Australia'], IT: ['ইতালি', 'Italy'] };

    function ls(k, v) {
        try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {}
        return null;
    }
    function lang() { return ls('calcLang') === 'en' ? 'en' : 'bn'; }
    function tr(b, e) { return lang() === 'en' ? e : b; }
    /* নাম মেলানোর জন্য: ছোট হাতের, "district/division/upazila" শব্দ বাদ, শুধু অক্ষর-সংখ্যা */
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
    function inBD(lat, lng) { return lat >= 20.5 && lat <= 26.7 && lng >= 88.0 && lng <= 92.8; }

    function get() { try { return JSON.parse(ls(KEY) || 'null'); } catch (e) { return null; } }
    function put(loc) { ls(KEY, loc ? JSON.stringify(loc) : null); renderStatus(); }

    /* অন্তত একটি জমানো বিজ্ঞাপনে এলাকা দেওয়া আছে কি? */
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
            var okD = (loc.d && dn.indexOf(norm(loc.d)) >= 0) || names.some(function (x) { return dn.indexOf(x) >= 0; });
            if (!okD) continue;
            if (p.length < 3 || !String(p[2]).trim()) return true;               /* জেলা পর্যন্ত */
            var al = String(p[2]).split(',').map(norm).filter(Boolean);
            if (al.some(function (a) { return names.indexOf(a) >= 0; })) return true;
        }
        return false;
    }

    /* ---------- এলাকা বের করা ---------- */
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
    function names(j) {
        var out = [];
        function add(x) { x = norm(x); if (x && out.indexOf(x) < 0) out.push(x); }
        ((j.localityInfo && j.localityInfo.administrative) || []).forEach(function (a) { add(a && a.name); });
        add(j.city); add(j.locality); add(j.principalSubdivision);
        return out;
    }
    function gps() {
        return new Promise(function (res, rej) {
            if (!navigator.geolocation) return rej(new Error('nogeo'));
            navigator.geolocation.getCurrentPosition(function (p) { res(p.coords); }, rej, { enableHighAccuracy: false, timeout: 20000, maximumAge: 36e5 });
        }).then(function (c) {
            var lat = c.latitude, lng = c.longitude;
            return fetch(REV_URL + '?latitude=' + lat + '&longitude=' + lng + '&localityLanguage=en').then(function (r) { return r.json(); }).catch(function () { return {}; })
                .then(function (j) {
                    var cc = String(j.countryCode || '').toUpperCase() || (inBD(lat, lng) ? 'BD' : '');
                    var loc = { c: cc, n: names(j), src: 'gps', ts: Date.now() };
                    if (cc === 'BD') { var d = nearest(lat, lng); if (d) loc.d = d.en; }
                    return cc ? loc : ipLookup();             /* দেশই না ধরা গেলে IP দিয়ে */
                });
        });
    }
    function permState() {
        try { return navigator.permissions.query({ name: 'geolocation' }).then(function (r) { return r.state; }).catch(function () { return 'unknown'; }); }
        catch (e) { return Promise.resolve('unknown'); }
    }

    var busy = false;
    function refresh(force) {
        if (busy || !navigator.onLine) return Promise.resolve();
        if (!force && !needed()) return Promise.resolve();
        busy = true;
        var cur = get(), age = cur ? Date.now() - (cur.ts || 0) : 1e15;
        return permState().then(function (st) {
            if (st === 'granted' && (force || !cur || cur.src !== 'gps' || age > 6 * 36e5)) return gps().then(put);
            if (cur && cur.src === 'gps' && age < GPS_FRESH) return null;     /* টাটকা GPS এলাকা IP দিয়ে বদলানো হবে না */
            if (!cur || age > IP_FRESH) return ipLookup().then(function (l) { if (l) put(l); });
            return null;
        }).catch(function () {}).then(function () { busy = false; renderStatus(); });
    }
    function useGPS() {
        setMsg(tr('অবস্থান খোঁজা হচ্ছে…', 'Finding your location…'));
        if (!navigator.onLine) { setMsg(tr('ইন্টারনেট চালু করে আবার চেষ্টা করুন।', 'Turn on internet and try again.')); return Promise.resolve(); }
        return gps().then(function (l) { put(l); setMsg(tr('এলাকা ঠিক হয়েছে ✅', 'Location set ✅')); })
            .catch(function (e) {
                setMsg(e && e.code === 1 ? tr('অনুমতি দেওয়া হয়নি। ব্রাউজারের সাইট সেটিংস থেকে অবস্থান "অনুমতি" দিন।', 'Permission denied. Allow location in site settings.')
                    : tr('অবস্থান পাওয়া যায়নি, আবার চেষ্টা করুন।', 'Could not get location. Try again.'));
            });
    }

    /* ---------- সেটিংস অংশ ---------- */
    function setMsg(t) { var e = document.getElementById('geoMsg'); if (e) e.textContent = t; }
    function cname(c) { return (COUNTRY[c] && COUNTRY[c][lang() === 'en' ? 1 : 0]) || c; }
    function renderStatus() {
        var el = document.getElementById('geoStatus'); if (!el) return;
        var l = get();
        if (!l || !l.c) { el.textContent = tr('এলাকা এখনো জানা নেই।', 'Location not known yet.'); return; }
        var d = l.d ? findDistrict(norm(l.d)) : null;
        var txt = cname(l.c) + (d ? ' › ' + (lang() === 'en' ? d.en : d.bn) : '');
        el.innerHTML = '';
        el.appendChild(document.createTextNode(txt + ' (' + (l.src === 'gps' ? 'GPS' : 'IP') + ')'));
        if (l.n && l.n.length) {
            var s = document.createElement('div'); s.style.cssText = 'font-size:9px;color:#64748b;margin-top:2px;word-break:break-word';
            s.textContent = tr('চিহ্নিত নাম: ', 'Detected names: ') + l.n.join(', '); el.appendChild(s);
        }
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
            '<button id="geoGpsBtn" style="flex:1;font-size:11px;font-weight:700;padding:6px;border-radius:8px;background:#0e7490;color:#fff;border:0">' + tr('GPS দিয়ে ঠিক করুন', 'Set by GPS') + '</button>' +
            '<button id="geoClrBtn" style="font-size:11px;padding:6px 10px;border-radius:8px;background:#1e293b;color:#cbd5e1;border:0">' + tr('মুছুন', 'Clear') + '</button></div>' +
            '<div id="geoMsg" style="font-size:10px;color:#fbbf24;margin-top:4px"></div>' +
            '<div style="font-size:9px;color:#64748b;margin-top:4px;line-height:1.3">' +
            tr('এলাকা আপনার ফোনেই থাকে। এলাকা খুঁজতে বিনামূল্যের তৃতীয়-পক্ষ সেবা (geojs.io, bigdatacloud.net) ব্যবহার হয়; শুধু এলাকা-ভিত্তিক বিজ্ঞাপন চালু থাকলে।',
               'Your area stays on your phone. Free third-party services (geojs.io, bigdatacloud.net) are used to find it, only when local ads are enabled.') + '</div>';
        card.insertBefore(sec, p || null);
        document.getElementById('geoGpsBtn').onclick = useGPS;
        document.getElementById('geoClrBtn').onclick = function () { put(null); setMsg(''); };
        renderStatus();
    }

    /* ---------- একবারের অনুরোধ (২য় বার খোলার পর) ---------- */
    function showAsk() {
        if (document.getElementById('geoAsk')) return;
        var b = document.createElement('div');
        b.id = 'geoAsk';
        b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:14px;z-index:95;max-width:420px;margin:0 auto;background:#0b1626;border:1px solid #22d3ee;border-radius:14px;padding:12px;box-shadow:0 8px 30px rgba(0,0,0,.7);color:#e2e8f0;font-size:13px;line-height:1.45';
        b.innerHTML = '<div style="font-weight:700;color:#22d3ee;margin-bottom:4px">📍 ' + tr('আপনার এলাকার অফার পেতে', 'Get offers near you') + '</div>' +
            '<div style="font-size:12px;color:#cbd5e1">' + tr('আপনার এলাকার বিজ্ঞাপন দেখাতে অবস্থান ব্যবহারের অনুমতি দিন। সেটিংস থেকে পরেও করা যায়।', 'Allow location to see ads for your area. You can also do this later in Settings.') + '</div>' +
            '<div style="display:flex;gap:8px;margin-top:8px"><button id="geoYes" style="flex:1;background:#0e7490;color:#fff;border:0;border-radius:10px;padding:8px;font-weight:700">' + tr('অনুমতি দিন', 'Allow') + '</button>' +
            '<button id="geoNo" style="background:#1e293b;color:#cbd5e1;border:0;border-radius:10px;padding:8px 14px">' + tr('এখন নয়', 'Not now') + '</button></div>';
        document.body.appendChild(b);
        function done() { ls(ASK, '1'); b.remove(); }
        document.getElementById('geoYes').onclick = function () { done(); useGPS(); };
        document.getElementById('geoNo').onclick = done;
    }
    function maybeAsk(opens) {
        if (ls(ASK) || opens < 2 || !navigator.geolocation || !needed()) return;
        permState().then(function (st) { if (st !== 'granted' && st !== 'denied') showAsk(); });
    }

    function init() {
        var opens = (parseInt(ls(OPENS) || '0', 10) || 0) + 1; ls(OPENS, String(opens));
        injectSettings();
        var open = window.openSettings;
        if (typeof open === 'function') window.openSettings = function () { var r = open.apply(this, arguments); injectSettings(); renderStatus(); return r; };
        setTimeout(function () { refresh(false).then(function () { maybeAsk(opens); }); }, 4000);   /* ক্লাউড ডেটা আসার পর */
        window.addEventListener('online', function () { setTimeout(function () { refresh(false); }, 3000); });
    }
    window.SciGeo = { match: match, get: get, refresh: refresh, useGPS: useGPS, norm: norm };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
