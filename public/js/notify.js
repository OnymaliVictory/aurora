// Aurora notifications, browser side. Loaded on every page by app.js.
//  - 🔔 bell with unread count + inbox + settings (email choices, device alerts)
//  - Follow button on shop pages
//  - Keeps a server copy of a signed-in buyer's cart (for reminders + other devices)
(function () {
  if (window.AuroraNotify) return;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = () => AuroraAPI; // a top-level const in app.js: reachable by name, not via window
  let user = null, config = { push: false, pushKey: null, email: false }, panelOpen = false, timer = null;

  // ---------- styles ----------
  function css() {
    if ($('#anf-style')) return;
    const st = document.createElement('style'); st.id = 'anf-style';
    st.textContent = `
    .anf-bell{position:relative;background:none;border:1px solid var(--glass-border);color:var(--text-primary);width:36px;height:36px;border-radius:50%;cursor:pointer;font-size:16px;flex-shrink:0;margin-right:8px;line-height:1}
    .anf-bell:hover{border-color:var(--aurora-teal)}
    .anf-badge{position:absolute;top:-4px;right:-4px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:var(--aurora-pink);color:#fff;font-size:10.5px;font-weight:700;display:none;align-items:center;justify-content:center}
    .anf-panel{position:fixed;top:64px;right:12px;width:360px;max-width:calc(100vw - 24px);max-height:calc(100vh - 84px);overflow-y:auto;z-index:220;display:none;padding:0;background:var(--bg-card,#0b1224);border:1px solid var(--glass-border);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.45)}
    .anf-panel.open{display:block}
    .anf-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--glass-border);font-weight:700;color:var(--text-primary)}
    .anf-link{background:none;border:none;color:var(--aurora-teal);font-size:12px;cursor:pointer;padding:0}
    .anf-item{display:block;width:100%;text-align:left;background:none;border:none;border-bottom:1px solid var(--glass-border);padding:12px 16px;cursor:pointer;color:var(--text-primary)}
    .anf-item:hover{background:var(--glass)}
    .anf-item.unread{box-shadow:inset 3px 0 0 var(--aurora-teal)}
    .anf-item .t{font-size:13px;font-weight:600}.anf-item .b{font-size:12.5px;color:var(--text-muted);margin-top:2px;word-break:break-word}.anf-item .w{font-size:11px;color:var(--text-dim);margin-top:4px}
    .anf-empty{padding:26px 16px;text-align:center;color:var(--text-dim);font-size:13px}
    .anf-set{padding:14px 16px;font-size:12.5px;color:var(--text-muted)}
    .anf-set h4{margin:0 0 8px;font-size:12px;color:var(--text-primary);text-transform:uppercase;letter-spacing:.04em}
    .anf-set label{display:flex;gap:8px;align-items:center;margin:6px 0;cursor:pointer}
    .anf-btn{margin-top:6px;padding:8px 14px;border-radius:50px;border:1px solid var(--aurora-teal);background:none;color:var(--aurora-teal);font-size:12.5px;font-weight:600;cursor:pointer}
    .anf-follow{margin-top:10px;padding:9px 18px;border-radius:50px;border:1px solid var(--aurora-teal);background:var(--glass);color:var(--aurora-teal);font-size:13px;font-weight:700;cursor:pointer}
    .anf-follow.on{background:var(--aurora-teal);color:#02050f}`;
    document.head.appendChild(st);
  }

  // ---------- time ----------
  const ago = iso => { const m = Math.floor((Date.now() - new Date(iso)) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + 'm ago'; const h = Math.floor(m / 60); if (h < 24) return h + 'h ago'; return Math.floor(h / 24) + 'd ago'; };

  // ---------- bell ----------
  function mountBell() {
    const nav = $('nav.navbar'); if (!nav || $('#anf-bell')) return;
    const b = document.createElement('button');
    b.id = 'anf-bell'; b.className = 'anf-bell'; b.type = 'button'; b.title = 'Notifications'; b.setAttribute('aria-label', 'Notifications');
    b.innerHTML = '🔔<span class="anf-badge" id="anf-badge"></span>';
    b.onclick = e => { e.stopPropagation(); togglePanel(); };
    const tt = nav.querySelector('.theme-toggle');
    tt ? nav.insertBefore(b, tt) : nav.appendChild(b);
    const p = document.createElement('div'); p.id = 'anf-panel'; p.className = 'anf-panel';
    p.onclick = e => e.stopPropagation();
    document.body.appendChild(p);
    document.addEventListener('click', () => { if (panelOpen) togglePanel(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && panelOpen) togglePanel(false); });
  }
  function setBadge(n) {
    const el = $('#anf-badge'); if (!el) return;
    el.textContent = n > 99 ? '99+' : n; el.style.display = n > 0 ? 'flex' : 'none';
  }
  async function refreshCount() {
    if (document.hidden) return;
    try { const { unread } = await api().get('/notifications/count'); setBadge(unread); } catch (e) {}
  }
  function togglePanel(force) {
    panelOpen = typeof force === 'boolean' ? force : !panelOpen;
    $('#anf-panel').classList.toggle('open', panelOpen);
    if (panelOpen) renderPanel();
  }

  async function renderPanel() {
    const p = $('#anf-panel');
    p.innerHTML = '<div class="anf-head">Notifications</div><div class="anf-empty">Loading…</div>';
    let list = [], unread = 0, prefs = { email_messages: true, email_products: true, email_reminders: true };
    try {
      const [n, pr] = await Promise.all([api().get('/notifications'), api().get('/notifications/prefs')]);
      list = n.notifications; unread = n.unread; prefs = pr.prefs;
    } catch (e) { p.innerHTML = `<div class="anf-head">Notifications</div><div class="anf-empty">${esc(e.message)}</div>`; return; }
    setBadge(unread);
    const pushOn = await pushState();
    p.innerHTML = `
      <div class="anf-head"><span>Notifications</span>${unread ? '<button class="anf-link" id="anf-readall">Mark all read</button>' : ''}</div>
      ${list.length ? list.map(n => `<button class="anf-item${n.read ? '' : ' unread'}" data-id="${n.id}" data-url="${esc(n.url)}">
          <div class="t">${esc(n.title)}</div><div class="b">${esc(n.body)}</div><div class="w">${esc(ago(n.createdAt))}</div></button>`).join('') : '<div class="anf-empty">Nothing yet. Follow a shop to hear about new products.</div>'}
      <div class="anf-set">
        <h4>Device alerts</h4>
        <div id="anf-push-msg">${esc(pushOn.text)}</div>
        ${pushOn.button ? `<button class="anf-btn" id="anf-push-btn">${esc(pushOn.button)}</button>` : ''}
        <h4 style="margin-top:14px">Email me about</h4>
        <label><input type="checkbox" data-pref="email_messages" ${prefs.email_messages ? 'checked' : ''}> Messages and order updates</label>
        <label><input type="checkbox" data-pref="email_products" ${prefs.email_products ? 'checked' : ''}> New products from shops I follow</label>
        <label><input type="checkbox" data-pref="email_reminders" ${prefs.email_reminders ? 'checked' : ''}> Cart reminders and picks</label>
      </div>`;
    p.querySelectorAll('.anf-item').forEach(el => el.onclick = async () => {
      try { await api().post('/notifications/read', { ids: [Number(el.dataset.id)] }); } catch (e) {}
      if (el.dataset.url) location.href = el.dataset.url; else renderPanel();
    });
    const ra = $('#anf-readall'); if (ra) ra.onclick = async () => { await api().post('/notifications/read', {}).catch(() => {}); renderPanel(); };
    p.querySelectorAll('[data-pref]').forEach(cb => cb.onchange = async () => {
      try { await api().post('/notifications/prefs', { [cb.dataset.pref]: cb.checked }); showToast('Saved'); }
      catch (e) { cb.checked = !cb.checked; showToast(e.message, 'error'); }
    });
    const pb = $('#anf-push-btn'); if (pb) pb.onclick = () => (pushOn.enabled ? disablePush() : enablePush());
  }

  // ---------- device push ----------
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia && matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  async function pushState() {
    if (!config.push) return { text: "Device alerts aren't switched on for Aurora yet.", button: null };
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return { text: isIOS && !standalone ? 'On iPhone: tap Share → "Add to Home Screen", then open Aurora from there to turn on alerts.' : "This browser can't show device alerts.", button: null };
    }
    if (Notification.permission === 'denied') return { text: 'Blocked in your browser settings. Allow notifications for this site, then reload.', button: null };
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js') || await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub && Notification.permission === 'granted') return { text: '✓ On for this device.', button: 'Turn off', enabled: true };
    } catch (e) {}
    return { text: 'Get a pop-up on this device for messages, orders and new products.', button: 'Turn on', enabled: false };
  }
  const keyBytes = b64 => { const pad = '='.repeat((4 - b64.length % 4) % 4); const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...raw].map(c => c.charCodeAt(0))); };
  async function enablePush() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { showToast('Notifications were not allowed.', 'error'); return renderPanel(); }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(config.pushKey) });
      await api().post('/notifications/push/subscribe', { subscription: sub.toJSON() });
      showToast('🔔 Device alerts are on');
    } catch (e) { showToast('Could not turn on alerts: ' + e.message, 'error'); }
    renderPanel();
  }
  async function disablePush() {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) { await api().post('/notifications/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
      showToast('Device alerts are off');
    } catch (e) { showToast(e.message, 'error'); }
    renderPanel();
  }

  // ---------- follow button (shop page) ----------
  let followedIds = null;
  async function mountFollow(shop) {
    const host = $('.shop-hero-info'); if (!host || !shop || $('#anf-follow')) return;
    css();
    const btn = document.createElement('button'); btn.id = 'anf-follow'; btn.className = 'anf-follow'; btn.type = 'button';
    host.appendChild(btn);
    let on = false;
    const paint = () => { btn.textContent = on ? '✓ Following' : '🔔 Follow'; btn.classList.toggle('on', on); };
    const u = await ensureUser();
    if (u) { try { followedIds = followedIds || (await api().get('/notifications/follows')).shopIds; on = followedIds.includes(shop.id); } catch (e) {} }
    paint();
    btn.onclick = async () => {
      if (!(await ensureUser())) { location.href = 'auth.html'; return; }
      btn.disabled = true;
      try {
        if (on) { await api().del('/notifications/follows/' + shop.id); on = false; followedIds = (followedIds || []).filter(i => i !== shop.id); showToast('Unfollowed ' + shop.name); }
        else {
          await api().post('/notifications/follows/' + shop.id); on = true; (followedIds = followedIds || []).push(shop.id);
          showToast('✓ Following ' + shop.name);
          if (config.push && 'Notification' in window && Notification.permission === 'default') { setTimeout(() => togglePanel(true), 700); } // invite them to turn on device alerts
        }
        paint();
      } catch (e) { showToast(e.message, 'error'); }
      btn.disabled = false;
    };
  }

  // ---------- cart copy on the server ----------
  let cartTimer = null;
  function syncCartSoon() {
    if (!user || typeof AuroraCart === 'undefined') return;
    clearTimeout(cartTimer);
    const items = AuroraCart.get();
    const send = () => api().post('/notifications/cart', { items }).catch(() => {});
    if (!items.length) send(); else cartTimer = setTimeout(send, 800); // clearing the cart is sent at once
  }
  function hookCart() {
    if (typeof AuroraCart === 'undefined' || AuroraCart.__anf) return;
    const orig = AuroraCart.save.bind(AuroraCart);
    AuroraCart.save = function (items) { orig(items); syncCartSoon(); };
    AuroraCart.__anf = true;
  }
  // A brand-new browser (no cart key at all) picks up the cart saved from another device.
  async function restoreCart() {
    try {
      if (typeof AuroraCart === 'undefined' || localStorage.getItem('aurora_cart') !== null) return;
      const { items } = await api().get('/notifications/cart');
      if (items && items.length) { localStorage.setItem('aurora_cart', JSON.stringify(items)); AuroraCart.updateBadges(); }
    } catch (e) {}
  }

  // ---------- start ----------
  async function ensureUser() {
    if (typeof AuroraAuth === 'undefined') return null;
    if (AuroraAuth._user === undefined) await AuroraAuth.refresh();
    user = AuroraAuth._user || null; return user;
  }
  async function start() {
    css();
    try { config = await (await fetch('/api/notifications/config')).json(); } catch (e) {}
    if (!(await ensureUser())) return;
    mountBell(); hookCart(); restoreCart();
    refreshCount(); timer = setInterval(refreshCount, 30000);
    if (/[?&]notif=1/.test(location.search)) togglePanel(true);
  }

  window.AuroraNotify = { mountFollow, togglePanel, enablePush };
  document.dispatchEvent(new Event('aurora-notify-ready'));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
