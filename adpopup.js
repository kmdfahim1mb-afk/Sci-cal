/* Sci Cal — বড় বিজ্ঞাপন (গ্রাফ ল্যাবে)
   - গ্রাফ ল্যাব খুললে স্ক্রিনের বড় অংশ জুড়ে বিজ্ঞাপন আসে
   - ৫ সেকেন্ড গণনা চলে, তার আগে বন্ধ করা যায় না
   - ৫ সেকেন্ড পর কোনায় ✕ চিহ্ন আসে
   - বিজ্ঞাপনের ডেটা আগের মতোই ক্লাউড থেকে আসে এবং ফোনে জমা থাকে, তাই অফলাইনেও জমানো বিজ্ঞাপন দেখাবে */
(function () {
    var SECONDS = 5;
    var KEY = 'scical_cloud_v1';
    var CFG = window.SCICAL_CFG || {};
    var timer = null, current = null;

    function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function today() {
        var d = new Date();
        return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }
    function lang() { return ls('calcLang') === 'en' ? 'en' : 'bn'; }
    function load() { try { return JSON.parse(ls(KEY) || 'null') || { cfg: {}, ads: [] }; } catch (e) { return { cfg: {}, ads: [] }; } }

    function pick() {
        var data = load();
        if (!data.cfg || data.cfg.adsEnabled === false) return null;
        var t = today(), l = lang();
        var list = (data.ads || []).filter(function (a) {
            if (!a.active) return false;
            if (a.start && t < a.start) return false;
            if (a.end && t > a.end) return false;
            if (a.lang && a.lang !== 'all' && a.lang !== l) return false;
            return !!(a.text || a.imageUrl) && !!a.linkUrl;
        });
        if (!list.length) return null;
        var tot = 0; list.forEach(function (a) { tot += Math.max(1, +a.weight || 1); });
        var r = Math.random() * tot;
        for (var i = 0; i < list.length; i++) { r -= Math.max(1, +list[i].weight || 1); if (r <= 0) return list[i]; }
        return list[0];
    }

    function bump(id, field) {
        if (!CFG.apiKey || !CFG.projectId || !navigator.onLine || !id) return;
        var db = 'projects/' + CFG.projectId + '/databases/(default)';
        fetch('https://firestore.googleapis.com/v1/' + db + '/documents:commit?key=' + CFG.apiKey, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
            body: JSON.stringify({ writes: [{ transform: { document: db + '/documents/ads/' + id,
                fieldTransforms: [{ fieldPath: field, increment: { integerValue: '1' } }] } }] })
        }).catch(function () {});
    }

    /* দুটি বিজ্ঞাপনের মাঝে ন্যূনতম বিরতি (সব ট্যাব মিলিয়ে একটাই হিসাব, অ্যাপ বন্ধ করে খুললেও থাকে) */
    var GAP_MIN = 0, GAP_KEY = 'scical_bigad_last';
    function cooldownOver() {
        var last = parseInt(ls(GAP_KEY) || '0', 10);
        var now = Date.now();
        if (!last || last > now) return true;          /* কখনো দেখায়নি, বা ঘড়ি উল্টে গেছে */
        return now - last >= GAP_MIN * 60 * 1000;
    }
    function markShown() { try { localStorage.setItem(GAP_KEY, String(Date.now())); } catch (e) {} }

    function injectStyle() {
        if (document.getElementById('bigAdStyle')) return;
        var s = document.createElement('style');
        s.id = 'bigAdStyle';
        s.textContent =
            '#bigAd{position:absolute;z-index:80;top:62px;left:14px;right:14px;height:64%;max-height:560px;display:flex;flex-direction:column;' +
            'background:#04121a;border:1px solid #22d3ee;border-radius:18px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.85),0 0 24px rgba(34,211,238,.25)}' +
            '#bigAd .ba-tag{position:absolute;left:10px;top:10px;z-index:3;font-size:10px;font-weight:700;color:#cbd5e1;background:rgba(2,6,23,.8);border-radius:6px;padding:2px 7px}' +
            '#bigAd .ba-x{position:absolute;right:10px;top:10px;z-index:3;min-width:34px;height:34px;border-radius:99px;border:1px solid #475569;' +
            'background:rgba(2,6,23,.85);color:#fff;font-size:16px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 8px}' +
            '#bigAd .ba-x.ready{background:#dc2626;border-color:#f87171;cursor:pointer}' +
            '#bigAd a{flex:1;min-height:0;display:flex;flex-direction:column;color:inherit;text-decoration:none}' +
            '#bigAd .ba-img{flex:1;min-height:0;width:100%;object-fit:cover;display:none}' +
            '#bigAd .ba-txt{padding:18px 16px;font-size:16px;line-height:1.5;color:#e2e8f0;text-align:center;font-weight:600}' +
            '#bigAd .ba-txt.big{flex:1;display:flex;align-items:center;justify-content:center;font-size:20px}' +
            '#bigAd .ba-cta{padding:10px;text-align:center;background:#0e7490;color:#fff;font-weight:700;font-size:13px}';
        document.head.appendChild(s);
    }

    function hide() {
        clearInterval(timer); timer = null; current = null;
        var el = document.getElementById('bigAd');
        if (el) el.remove();
    }

    /* where = 'graph' (গ্রাফ ল্যাব) বা 'main' (সমীকরণ/ম্যাচ/কনস্ট্যান্ট/সূত্রাবলী ট্যাব) */
    function show(where) {
        hide();
        var host = document.getElementById(where === 'graph' ? 'graphStudioModal' : '') ||
            document.querySelector('.mobile-calc-container');
        if (!cooldownOver()) return;          /* ৩০ মিনিট পার না হলে বিজ্ঞাপন নয় */
        var ad = pick();
        if (!host || !ad) return;
        markShown();                          /* এখন থেকে ৩০ মিনিট গোনা শুরু */
        injectStyle();
        current = ad;

        var el = document.createElement('div');
        el.id = 'bigAd';
        if (where !== 'graph') {
            /* ট্যাব বারের ঠিক নিচ থেকে স্ক্রিনের নিচ পর্যন্ত */
            var bar = document.getElementById('tabComp'), hr = host.getBoundingClientRect();
            var top = bar ? bar.parentElement.getBoundingClientRect().bottom - hr.top + 6 : 240;
            el.style.cssText = 'top:' + Math.round(top) + 'px;height:auto;max-height:none;bottom:12px';
        }
        el.innerHTML =
            '<span class="ba-tag">বিজ্ঞাপন</span>' +
            '<button class="ba-x" aria-label="Close" disabled>' + SECONDS + '</button>' +
            '<a href="#" id="bigAdLink">' +
            '<img class="ba-img" alt="">' +
            '<div class="ba-txt"></div>' +
            '<div class="ba-cta">আরও দেখুন ›</div></a>';
        host.appendChild(el);

        var img = el.querySelector('.ba-img'), txt = el.querySelector('.ba-txt');
        var label = ad.text || ad.title || '';
        function textOnly() { img.style.display = 'none'; txt.textContent = label; txt.className = 'ba-txt big'; }
        if (ad.imageUrl) {
            txt.textContent = label; txt.style.display = label ? '' : 'none';
            img.onload = function () { img.style.display = 'block'; };
            img.onerror = textOnly;
            img.src = ad.imageUrl; img.alt = ad.title || '';
        } else textOnly();

        el.querySelector('#bigAdLink').addEventListener('click', function (e) {
            e.preventDefault();
            bump(ad.id, 'clicks');
            window.open(ad.linkUrl, '_blank', 'noopener');
        });
        bump(ad.id, 'views');

        var btn = el.querySelector('.ba-x'), left = SECONDS;
        timer = setInterval(function () {
            left--;
            if (left > 0) { btn.textContent = left; return; }
            clearInterval(timer); timer = null;
            btn.textContent = '✕'; btn.disabled = false; btn.classList.add('ready');
            btn.addEventListener('click', hide);
        }, 1000);
    }

    function hook() {
        /* পুরনো ছোট ব্যানার সবসময় লুকানো */
        var st = document.createElement('style');
        st.textContent = '#adBox{display:none!important}';
        document.head.appendChild(st);

        var open = window.openGraphStudioModal, close = window.closeGraphStudioModal, sw = window.switchCalcMode;
        if (typeof open === 'function') {
            window.openGraphStudioModal = function () { var r = open.apply(this, arguments); show('graph'); return r; };
            window.closeGraphStudioModal = function () { hide(); return close.apply(this, arguments); };
        }
        /* গাণিতিক (comp) ছাড়া বাকি সব ট্যাবে বিজ্ঞাপন */
        if (typeof sw === 'function') {
            window.switchCalcMode = function (mode) {
                var r = sw.apply(this, arguments);
                if (mode === 'comp') hide(); else show('main');
                return r;
            };
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
})();
