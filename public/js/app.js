// ---------- API ----------
// Talks to the real Express API in supabase-backend/, attaching the
// current Supabase session token so the server knows who's asking.
// Every page calls AuroraAPI, never Supabase directly (except for
// signup/login/logout, which go through supabaseClient.auth — see
// AuroraAuth below) — so this is the one place network behavior lives.
const AuroraAPI = {
  async authHeader() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session ? { Authorization: 'Bearer ' + session.access_token } : {};
  },
  async request(path, opts = {}) {
    const authHeader = await this.authHeader();
    const isFormData = typeof FormData !== 'undefined' && opts.body instanceof FormData;
    const headers = { ...authHeader };
    if (!isFormData && opts.body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers,
      body: isFormData ? opts.body : (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
    let data = {};
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  },
  get(path) { return this.request(path); },
  post(path, body) { return this.request(path, { method: 'POST', body }); },
  patch(path, body) { return this.request(path, { method: 'PATCH', body }); },
  del(path) { return this.request(path, { method: 'DELETE' }); },
};

// ---------- Theme ----------
const AuroraTheme = {
  key: 'aurora_theme',
  get() { try { return localStorage.getItem(this.key) || 'dark'; } catch { return 'dark'; } },
  apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(this.key, theme); } catch {}
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.textContent = theme === 'light' ? '🌙' : '☀️';
      btn.title = theme === 'light' ? 'Switch to night mode' : 'Switch to day mode';
    });
  },
  toggle() { this.apply(this.get() === 'light' ? 'dark' : 'light'); },
  init() { this.apply(this.get()); },
};

// ---------- Auth ----------
// Supabase Auth owns the actual session (sign up / sign in / sign out
// happen directly against supabaseClient.auth, in auth.html). This just
// wraps "is anyone signed in, and what's their Aurora profile".
const AuroraAuth = {
  _user: undefined, // undefined = not checked yet, null = checked & logged out
  async refresh() {
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) { this._user = null; return null; }
      const { user } = await AuroraAPI.get('/auth/me');
      this._user = user;
    } catch {
      this._user = null;
    }
    return this._user;
  },
  getCached() { return this._user; },
  async requireAuth(redirectTo = 'auth.html') {
    if (this._user === undefined) await this.refresh();
    if (!this._user) {
      window.location.href = redirectTo;
      return null;
    }
    return this._user;
  },
  async logout() {
    try { await supabaseClient.auth.signOut(); } catch {}
    this._user = null;

    window.location.href = 'index.html';
  },
};

// ---------- Cart (client-side until checkout; items reference real productId) ----------
const AuroraCart = {
  get() { try { return JSON.parse(localStorage.getItem('aurora_cart') || '[]'); } catch { return []; } },
  save(items) { localStorage.setItem('aurora_cart', JSON.stringify(items)); },
  add(item) {
    const cart = this.get();
    const idx = cart.findIndex(i => i.productId === item.productId && i.size === item.size);
    if (idx >= 0) cart[idx].qty += (item.qty || 1);
    else cart.push({ ...item, qty: item.qty || 1 });
    this.save(cart); this.updateBadges(); return cart;
  },
  remove(idx) { const c = this.get(); c.splice(idx, 1); this.save(c); this.updateBadges(); return c; },
  changeQty(idx, delta) {
    const c = this.get();
    if (c[idx]) { c[idx].qty = Math.max(1, (c[idx].qty || 1) + delta); this.save(c); }
    return c;
  },
  clear() { this.save([]); this.updateBadges(); },
  total() { return this.get().reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0); },
  count() { return this.get().reduce((s, i) => s + (i.qty || 1), 0); },
  updateBadges() {
    const c = this.count();
    document.querySelectorAll('.cart-count-badge').forEach(el => el.textContent = c);
  },
};

let _toastTimer;
function showToast(msg, type) {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.className = 'toast' + (type === 'error' ? ' error' : '');
  t.classList.add('show'); clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

function openCart() {
  document.getElementById('cart-overlay')?.classList.add('open');
  document.getElementById('cart-drawer')?.classList.add('open');
  renderCartDrawer();
}
function closeCart() {
  document.getElementById('cart-overlay')?.classList.remove('open');
  document.getElementById('cart-drawer')?.classList.remove('open');
}
function renderCartDrawer() {
  const list = document.getElementById('cart-items-list');
  const totalEl = document.getElementById('cart-total-val');
  if (!list) return;
  const cart = AuroraCart.get();
  if (cart.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:48px 20px;color:var(--text-dim)">
      <div style="font-size:40px;margin-bottom:12px">🛒</div>
      <p style="font-size:14px">Your cart is empty</p>
      <a href="buyer.html" style="color:var(--aurora-teal);font-size:13px;margin-top:8px;display:block">Explore nearby shops →</a>
    </div>`;
  } else {
    list.innerHTML = cart.map((item, i) => `
      <div class="cart-item">
        <div class="cart-item-emoji">${item.imageUrl ? `<img src="${item.imageUrl}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">` : (item.emoji || '📦')}</div>
        <div class="cart-item-info">
          <div class="cart-item-name">${escapeHtml(item.name)}</div>
          <div class="cart-item-shop">from ${escapeHtml(item.shop || 'Aurora Shop')}${item.size ? ' · Size ' + escapeHtml(item.size) : ''}</div>
          <div class="cart-qty">
            <button class="qty-btn" onclick="cartQty(${i},-1)">−</button>
            <span class="qty-num">${item.qty}</span>
            <button class="qty-btn" onclick="cartQty(${i},1)">+</button>
          </div>
        </div>
        <div style="text-align:right">
          <div class="cart-item-price">₦${(item.price * item.qty).toLocaleString()}</div>
          <div style="font-size:11px;color:var(--text-dim);cursor:pointer;margin-top:4px" onclick="cartRemove(${i})">Remove</div>
        </div>
      </div>`).join('');
  }
  if (totalEl) totalEl.textContent = '₦' + AuroraCart.total().toLocaleString();
}
function cartQty(i, d) { AuroraCart.changeQty(i, d); renderCartDrawer(); }
function cartRemove(i) { AuroraCart.remove(i); renderCartDrawer(); }

function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('sidebar-overlay')?.classList.toggle('open');
  document.getElementById('hamburger-btn')?.classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('open');
  document.getElementById('hamburger-btn')?.classList.remove('open');
}
function toggleMobileNav() {
  document.getElementById('nav-links')?.classList.toggle('mobile-open');
  document.getElementById('hamburger-btn')?.classList.toggle('open');
}

// ---------- Wishlist ----------
const AuroraWishlist = {
  get() { try { return JSON.parse(localStorage.getItem('aurora_wishlist') || '[]'); } catch { return []; } },
  save(items) { localStorage.setItem('aurora_wishlist', JSON.stringify(items)); },
  toggle(item) {
    const list = this.get();
    const idx = list.findIndex(i => i.productId ? i.productId === item.productId : i.name === item.name);
    if (idx >= 0) { list.splice(idx, 1); showToast('Removed from wishlist'); }
    else { list.push(item); showToast('❤️ Added to wishlist!'); }
    this.save(list); return list;
  },
  has(productIdOrName) {
    return this.get().some(i => i.productId === productIdOrName || i.name === productIdOrName);
  },
};

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return new Date(iso).toLocaleDateString();
}

document.addEventListener('DOMContentLoaded', () => {
  AuroraTheme.init();
  AuroraCart.updateBadges();
  document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);
  document.querySelectorAll('.theme-toggle').forEach(btn => btn.addEventListener('click', () => AuroraTheme.toggle()));
});

// Floating tracking assistant on every page (lives in js/track-bot.js)
(function () {
  const s = document.createElement('script');
  s.src = 'js/track-bot.js';
  document.head.appendChild(s);
})();

// Notifications bell, follow button and cart sync (lives in js/notify.js)
(function () {
  const s = document.createElement('script');
  s.src = 'js/notify.js';
  document.head.appendChild(s);
})();
