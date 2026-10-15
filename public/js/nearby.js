// Aurora — "shops near me": remembers where the buyer is, finds nearby shops, draws the spiral.
// Location stays in THIS browser (localStorage) and is only sent to Aurora when asking for nearby shops.
// Place names come from OpenStreetMap's free Nominatim service (called straight from the browser).
const AuroraLoc = {
  KEY: 'aurora_loc', RKEY: 'aurora_radius',
  get() { try { const v = JSON.parse(localStorage.getItem(this.KEY) || 'null'); return v && isFinite(v.lat) && isFinite(v.lng) ? v : null; } catch { return null; } },
  set(loc) { try { localStorage.setItem(this.KEY, JSON.stringify(loc)); } catch {} document.dispatchEvent(new CustomEvent('aurora-location', { detail: loc })); return loc; },
  clear() { try { localStorage.removeItem(this.KEY); } catch {} document.dispatchEvent(new CustomEvent('aurora-location', { detail: null })); },
  radius() { const r = Number(localStorage.getItem(this.RKEY)); return [5, 10, 25, 50].includes(r) ? r : 25; },
  setRadius(r) { try { localStorage.setItem(this.RKEY, String(r)); } catch {} },
  query(loc = this.get()) {
    if (!loc) return '';
    return `lat=${encodeURIComponent(loc.lat)}&lng=${encodeURIComponent(loc.lng)}&radius=${this.radius()}` + (loc.city ? `&city=${encodeURIComponent(loc.city)}` : '');
  },

  // Ask the browser for the GPS position (this shows the "Allow location?" prompt).
  detect() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('This device cannot share its location. Type your area instead.'));
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }),
        e => reject(new Error(e.code === 1
          ? 'Location is blocked. Tap the lock icon in your browser’s address bar, allow Location, then try again — or type your area instead.'
          : 'Couldn’t get your location. Check that GPS is on, or type your area instead.')),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 });
    });
  },
  async _nom(path) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 7000);
    try { const r = await fetch('https://nominatim.openstreetmap.org/' + path, { signal: ctl.signal, headers: { 'Accept': 'application/json' } }); if (!r.ok) throw 0; return await r.json(); }
    finally { clearTimeout(t); }
  },
  _name(a = {}) {
    const city = a.city || a.town || a.municipality || a.county || a.state_district || a.state || '';
    const area = a.suburb || a.neighbourhood || a.city_district || a.village || a.quarter || '';
    return { city, area, label: [area, city].filter(Boolean).join(', ') };
  },
  // coordinates -> "Rumuokoro, Port Harcourt". Never throws; falls back to a generic label.
  async reverse(lat, lng) {
    try { const j = await this._nom(`reverse?format=jsonv2&zoom=14&addressdetails=1&lat=${lat}&lon=${lng}`); const n = this._name(j.address); return { ...n, label: n.label || 'Your location' }; }
    catch { return { city: '', area: '', label: 'Your location' }; }
  },
  // typed place -> up to 5 suggestions
  async search(q) {
    q = String(q || '').trim(); if (q.length < 3) return [];
    try {
      const j = await this._nom(`search?format=jsonv2&limit=5&addressdetails=1&q=${encodeURIComponent(q)}`);
      return j.map(x => { const n = this._name(x.address); return { lat: +(+x.lat).toFixed(6), lng: +(+x.lon).toFixed(6), city: n.city, label: n.label || String(x.display_name || '').split(',').slice(0, 2).join(',') }; });
    } catch { return []; }
  },
  // GPS + place name in one go, saved for next time
  async useMyLocation() {
    const pos = await this.detect();
    const name = await this.reverse(pos.lat, pos.lng);
    return this.set({ ...pos, city: name.city, label: name.label, source: 'gps' });
  },
};

const AuroraNearby = {
  async fetchShops(loc = AuroraLoc.get()) {
    const q = loc ? '?' + AuroraLoc.query(loc) : '';
    const { shops } = await AuroraAPI.get('/shops' + q);
    return shops;
  },
  distLabel(s) { return s.distanceKm == null ? (s.area || s.city || 'Nearby') : (s.distanceKm < 1 ? 'Under 1 km away' : s.distanceKm + ' km away'); },

  // Spiral of shops: nearest in the inner ring. Max 12 on the spiral; the rest show in the list.
  renderSpiral(scene, shops, esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))) {
    if (!scene) return;
    scene.querySelectorAll('.shop-node').forEach(n => n.remove());
    const k = (scene.clientWidth || 520) / 520;          // scales with the circle so nodes stay inside on phones
    const list = shops.slice(0, 12), n = list.length;
    // True spiral (golden angle): nearest shop closest to the centre, spreading outward without overlapping.
    list.forEach((s, i) => {
      const a = (i * 137.5 - 90) * Math.PI / 180;
      const r = (112 + (226 - 112) * Math.sqrt(n > 1 ? i / (n - 1) : 0)) * k;
      const ri = i < 3 ? 0 : i < 7 ? 1 : 2;
      const node = document.createElement('a');
      node.href = 'shop.html?slug=' + encodeURIComponent(s.slug); node.className = 'shop-node';
      node.style.transform = `translate(calc(-50% + ${Math.cos(a) * r}px), calc(-50% + ${Math.sin(a) * r}px))`;
      node.style.animation = `nodeHover ${2.4 + ri * .5}s ease-in-out ${(i % 3) * .35}s infinite alternate`;
      node.innerHTML = `<div class="shop-node-inner" style="border-color:${/^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : 'var(--glass-border)'}">
          <div class="shop-node-emoji">${esc(s.emoji || '🏪')}</div><div class="shop-node-name">${esc(s.name)}</div></div>
        <div class="shop-tooltip"><div class="tooltip-name">${esc(s.name)}</div><div class="tooltip-cat">${esc(s.category || '')}</div>
          <div class="tooltip-dist">📍 ${esc(this.distLabel(s))}</div><div class="tooltip-rating">★ ${s.reviewCount ? Number(s.rating).toFixed(1) : 'New'}</div></div>`;
      scene.appendChild(node);
    });
  },

  // Small popup: use GPS, type an area, pick a radius. onDone(loc) runs after a new location is saved.
  openPicker(onDone) {
    document.getElementById('loc-picker')?.remove();
    const cur = AuroraLoc.get(), el = document.createElement('div');
    el.id = 'loc-picker'; el.className = 'modal-overlay open';
    el.innerHTML = `<div class="modal modal-sm" role="dialog" aria-label="Change location" style="max-width:440px">
      <div class="modal-header"><div class="modal-title">Change location</div><button class="modal-close" aria-label="Close">✕</button></div>
      <div style="display:flex;flex-direction:column;gap:14px;padding:4px 2px 6px">
        <button class="btn-full" id="lp-gps" type="button">📍 Use my current location</button>
        <div class="form-hint" style="text-align:center">or type a place</div>
        <input class="form-input" id="lp-q" placeholder="e.g. Rumuokoro, Port Harcourt" autocomplete="off">
        <div id="lp-res" style="display:flex;flex-direction:column;gap:6px"></div>
        <div><div class="form-label" style="margin-bottom:8px">How far? <span class="form-hint" style="font-weight:400">(currently ${AuroraLoc.radius()} km)</span></div>
          <div class="search-filters" id="lp-rad">${[5, 10, 25, 50].map(r => `<span class="filter-chip ${r === AuroraLoc.radius() ? 'active' : ''}" data-r="${r}">${r} km</span>`).join('')}</div></div>
        <div id="lp-msg" class="form-hint" style="min-height:16px"></div>
      </div></div>`;
    document.body.appendChild(el);
    const $ = s => el.querySelector(s), close = () => el.remove(), msg = (t, bad) => { $('#lp-msg').textContent = t || ''; $('#lp-msg').style.color = bad ? '#E5484D' : ''; };
    el.addEventListener('click', e => { if (e.target === el) close(); });
    $('.modal-close').onclick = close;
    $('#lp-rad').onclick = e => { const c = e.target.closest('[data-r]'); if (!c) return; AuroraLoc.setRadius(+c.dataset.r); $('#lp-rad').querySelectorAll('.filter-chip').forEach(x => x.classList.toggle('active', x === c)); if (AuroraLoc.get()) { onDone && onDone(AuroraLoc.get()); } };
    $('#lp-gps').onclick = async () => {
      msg('Waiting for your permission…'); $('#lp-gps').disabled = true;
      try { const loc = await AuroraLoc.useMyLocation(); close(); onDone && onDone(loc); }
      catch (err) { msg(err.message, true); $('#lp-gps').disabled = false; }
    };
    let timer; $('#lp-q').oninput = e => {
      clearTimeout(timer); const v = e.target.value; $('#lp-res').innerHTML = '';
      if (v.trim().length < 3) return msg('');
      timer = setTimeout(async () => {
        msg('Searching…'); const found = await AuroraLoc.search(v);
        msg(found.length ? '' : 'No match. Try a nearby town or landmark.');
        $('#lp-res').innerHTML = '';
        found.forEach(f => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-social'; b.style.cssText = 'text-align:left;border-radius:14px!important;font-size:13px'; b.textContent = '📍 ' + f.label;
          b.onclick = () => { const loc = AuroraLoc.set({ lat: f.lat, lng: f.lng, city: f.city, label: f.label, source: 'search' }); close(); onDone && onDone(loc); };
          $('#lp-res').appendChild(b); });
      }, 450);
    };
    setTimeout(() => $('#lp-q').focus(), 50);
  },
};
