// ============================================================
// LocalDB — a stand-in "database" that lives entirely in the browser
// (localStorage). No server, no setup, works the moment you open the
// page. When you're ready to connect Supabase, only app.js's AuroraAPI
// needs to change — every page already talks to AuroraAPI, not to this
// file directly, so nothing else has to be rewritten.
//
// Data is NOT secure or private in this mode — anyone using the same
// browser can see it via devtools, and it doesn't sync between devices.
// That's expected for this stage; supabase/schema.sql has the real
// schema ready for when you connect a real backend.
// ============================================================
const LocalDB = (() => {
  const KEY = 'aurora_db';
  const SESSION_KEY = 'aurora_session_user_id';

  function emptyDB() {
    return { users: [], shops: [], products: [], orders: [], messages: [], _seq: { users: 0, shops: 0, products: 0, orders: 0, messages: 0 } };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : emptyDB();
    } catch {
      return emptyDB();
    }
  }
  function save(db) {
    localStorage.setItem(KEY, JSON.stringify(db));
  }
  function nextId(db, table) {
    db._seq[table] = (db._seq[table] || 0) + 1;
    return db._seq[table];
  }

  async function hashPassword(password) {
    const enc = new TextEncoder().encode(password);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function currentUserId() {
    try { return localStorage.getItem(SESSION_KEY); } catch { return null; }
  }
  function setCurrentUserId(id) {
    try { id ? localStorage.setItem(SESSION_KEY, id) : localStorage.removeItem(SESSION_KEY); } catch {}
  }
  function publicUser(u) {
    if (!u) return null;
    const { password_hash, ...rest } = u;
    return rest;
  }
  function validEmail(e) {
    return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  }

  // ---------------- Accounts ----------------
  async function signUp({ email, password, firstName, lastName, phone, role }) {
    const db = load();
    const normalized = String(email || '').trim().toLowerCase();
    if (!firstName || !lastName || !validEmail(normalized) || !password) {
      throw new Error('Please fill in your name, a valid email, and a password.');
    }
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');
    if (db.users.find(u => u.email === normalized)) throw new Error('An account with that email already exists.');

    const user = {
      id: 'u' + nextId(db, 'users'),
      first_name: firstName.trim(), last_name: lastName.trim(), email: normalized,
      phone: phone || '', password_hash: await hashPassword(password),
      role: role === 'seller' ? 'seller' : 'buyer', city: '', area: '',
      created_at: new Date().toISOString(),
    };
    db.users.push(user); save(db);
    setCurrentUserId(user.id);
    return publicUser(user);
  }

  async function signIn({ email, password }) {
    const db = load();
    const normalized = String(email || '').trim().toLowerCase();
    if (!validEmail(normalized) || !password) throw new Error('Please enter a valid email and password.');
    const user = db.users.find(u => u.email === normalized);
    if (!user || (await hashPassword(password)) !== user.password_hash) {
      throw new Error('Incorrect email or password.');
    }
    setCurrentUserId(user.id);
    return publicUser(user);
  }

  function signOut() { setCurrentUserId(null); }

  function getCurrentUser() {
    const db = load();
    const id = currentUserId();
    if (!id) return null;
    const user = db.users.find(u => u.id === id);
    return user ? publicUser(user) : null;
  }

  // ---------------- Shops ----------------
  function slugify(name) {
    return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }
  function shopWithComputed(db, shop) {
    return {
      ...shop,
      productCount: db.products.filter(p => p.shop_id === shop.id).length,
      orderCount: db.orders.filter(o => o.shop_id === shop.id).length,
    };
  }

  function createShop(data) {
    const db = load();
    const uid = currentUserId();
    if (!uid) throw new Error('Please sign in to continue.');
    if (db.shops.find(s => s.owner_id === uid)) throw new Error('You already have a shop.');
    if (!data.name || !data.category) throw new Error('Shop name and category are required.');

    let slug = slugify(data.name), unique = slug, n = 1;
    while (db.shops.find(s => s.slug === unique)) unique = `${slug}-${++n}`;

    const shop = {
      id: nextId(db, 'shops'), owner_id: uid, name: data.name.trim(), slug: unique,
      category: data.category, description: data.description || '', color: data.color || '#00ffb3',
      city: data.city || '', area: data.area || '', address: data.address || '', phone: data.phone || '',
      openDays: Array.isArray(data.openDays) ? data.openDays : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      openTime: data.openTime || '09:00', closeTime: data.closeTime || '21:00',
      deliveryHome: !!data.deliveryHome, deliveryPickup: !!data.deliveryPickup, payOnDelivery: !!data.payOnDelivery,
      emoji: '🏪', rating: null, reviewCount: 0, created_at: new Date().toISOString(),
    };
    db.shops.push(shop);
    const user = db.users.find(u => u.id === uid);
    if (user && user.role !== 'seller') user.role = 'seller';
    save(db);
    return shopWithComputed(db, shop);
  }

  function myShop() {
    const db = load();
    const uid = currentUserId();
    if (!uid) return null;
    const shop = db.shops.find(s => s.owner_id === uid);
    return shop ? shopWithComputed(db, shop) : null;
  }

  function getShop(idOrSlug) {
    const db = load();
    const isNum = /^\d+$/.test(idOrSlug);
    const shop = isNum ? db.shops.find(s => s.id === Number(idOrSlug)) : db.shops.find(s => s.slug === idOrSlug);
    if (!shop) throw new Error('Shop not found.');
    return shopWithComputed(db, shop);
  }

  function listShops({ q, category } = {}) {
    const db = load();
    let shops = db.shops;
    if (category && category !== 'all') shops = shops.filter(s => s.category.toLowerCase().includes(category.toLowerCase()));
    if (q) { const needle = q.toLowerCase(); shops = shops.filter(s => s.name.toLowerCase().includes(needle) || s.category.toLowerCase().includes(needle)); }
    return shops.map(s => shopWithComputed(db, s)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  function updateShop(shopId, patch) {
    const db = load();
    const uid = currentUserId();
    const shop = db.shops.find(s => s.id === Number(shopId));
    if (!shop) throw new Error('Shop not found.');
    if (shop.owner_id !== uid) throw new Error('Not your shop.');
    Object.assign(shop, patch);
    save(db);
    return shopWithComputed(db, shop);
  }

  // ---------------- Products ----------------
  function listProducts(shopId) {
    const db = load();
    return db.products.filter(p => p.shop_id === Number(shopId)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  function addProduct(shopId, data) {
    const db = load();
    const uid = currentUserId();
    const shop = db.shops.find(s => s.id === Number(shopId));
    if (!shop) throw new Error('Shop not found.');
    if (shop.owner_id !== uid) throw new Error('Not your shop.');
    const price = Number(data.price);
    if (!data.name || !price || price <= 0) throw new Error('Product name and a valid price are required.');

    const product = {
      id: nextId(db, 'products'), shop_id: Number(shopId), name: String(data.name).trim(), price,
      stock: Number(data.stock) || 0, sold: 0, category: data.category || 'Other', description: data.description || '',
      emoji: data.emoji || '📦', imageUrl: data.imageUrl || null, sizes: Array.isArray(data.sizes) ? data.sizes : [],
      created_at: new Date().toISOString(),
    };
    db.products.push(product); save(db);
    return product;
  }

  function setProductImage(productId, imageUrl) {
    const db = load();
    const uid = currentUserId();
    const product = db.products.find(p => p.id === Number(productId));
    if (!product) throw new Error('Product not found.');
    const shop = db.shops.find(s => s.id === product.shop_id);
    if (!shop || shop.owner_id !== uid) throw new Error('Not your product.');
    product.imageUrl = imageUrl;
    save(db);
    return product;
  }

  function updateProduct(productId, patch) {
    const db = load();
    const uid = currentUserId();
    const product = db.products.find(p => p.id === Number(productId));
    if (!product) throw new Error('Product not found.');
    const shop = db.shops.find(s => s.id === product.shop_id);
    if (!shop || shop.owner_id !== uid) throw new Error('Not your product.');
    Object.assign(product, patch);
    save(db);
    return product;
  }

  function deleteProduct(productId) {
    const db = load();
    const uid = currentUserId();
    const idx = db.products.findIndex(p => p.id === Number(productId));
    if (idx === -1) throw new Error('Product not found.');
    const shop = db.shops.find(s => s.id === db.products[idx].shop_id);
    if (!shop || shop.owner_id !== uid) throw new Error('Not your product.');
    db.products.splice(idx, 1);
    save(db);
    return true;
  }

  // ---------------- Orders ----------------
  const DELIVERY_FEES = { standard: 1500, express: 3500, pickup: 0 };

  function placeOrder(data) {
    const db = load();
    const uid = currentUserId();
    if (!uid) throw new Error('Please sign in to continue.');
    const items = data.items || [];
    if (!items.length) throw new Error('Your cart is empty.');
    if (data.deliveryType !== 'pickup' && !data.address) throw new Error('Please add a delivery address.');

    const byShop = {};
    for (const item of items) {
      const product = db.products.find(p => p.id === Number(item.productId));
      if (!product) throw new Error('A product in your cart is no longer available.');
      const qty = Math.max(1, Number(item.qty) || 1);
      (byShop[product.shop_id] = byShop[product.shop_id] || []).push({ product, qty, size: item.size || '' });
    }

    const fee = DELIVERY_FEES[data.deliveryType] ?? DELIVERY_FEES.standard;
    const createdOrders = [];
    Object.keys(byShop).forEach(shopId => {
      const lineItems = byShop[shopId];
      const subtotal = lineItems.reduce((s, i) => s + i.product.price * i.qty, 0);
      const order = {
        id: nextId(db, 'orders'), buyer_id: uid, shop_id: Number(shopId), status: 'pending',
        deliveryType: data.deliveryType || 'standard', deliveryFee: fee, subtotal, total: subtotal + fee,
        address: data.address || '', city: data.city || '', area: data.area || '', phone: data.phone || '',
        paymentMethod: data.paymentMethod || 'card', note: data.note || '',
        items: lineItems.map(i => ({
          productId: i.product.id, name: i.product.name, price: i.product.price, qty: i.qty,
          size: i.size, emoji: i.product.emoji, imageUrl: i.product.imageUrl || null,
        })),
        created_at: new Date().toISOString(),
      };
      db.orders.push(order);
      lineItems.forEach(i => {
        i.product.stock = Math.max(0, (i.product.stock || 0) - i.qty);
        i.product.sold = (i.product.sold || 0) + i.qty;
      });
      createdOrders.push(order);
    });
    save(db);
    return createdOrders;
  }

  function myOrders() {
    const db = load();
    const uid = currentUserId();
    return db.orders.filter(o => o.buyer_id === uid)
      .map(o => ({ ...o, shop: (() => { const s = db.shops.find(x => x.id === o.shop_id); return s ? { id: s.id, name: s.name, slug: s.slug } : null; })() }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  function shopOrders() {
    const db = load();
    const uid = currentUserId();
    const shop = db.shops.find(s => s.owner_id === uid);
    if (!shop) return [];
    return db.orders.filter(o => o.shop_id === shop.id)
      .map(o => ({ ...o, buyer: (() => { const b = db.users.find(u => u.id === o.buyer_id); return b ? { id: b.id, name: `${b.first_name} ${b.last_name}` } : null; })() }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  function updateOrderStatus(orderId, status) {
    const db = load();
    const uid = currentUserId();
    const order = db.orders.find(o => o.id === Number(orderId));
    if (!order) throw new Error('Order not found.');
    const shop = db.shops.find(s => s.id === order.shop_id);
    if (!shop || shop.owner_id !== uid) throw new Error('Not your order to update.');
    const allowed = ['pending', 'processing', 'delivered', 'cancelled'];
    if (!allowed.includes(status)) throw new Error('Invalid status.');
    order.status = status;
    save(db);
    return order;
  }

  // ---------------- Messages ----------------
  function sendMessage(shopId, body, buyerIdOverride) {
    const db = load();
    const uid = currentUserId();
    if (!uid) throw new Error('Please sign in to continue.');
    const shop = db.shops.find(s => s.id === Number(shopId));
    if (!shop) throw new Error('Shop not found.');
    if (!body || !body.trim()) throw new Error('Message cannot be empty.');

    const isOwner = shop.owner_id === uid;
    const buyerId = isOwner ? buyerIdOverride : uid;
    if (isOwner && !buyerId) throw new Error('buyerId is required when replying as the shop.');

    const message = {
      id: nextId(db, 'messages'), shop_id: Number(shopId), buyer_id: buyerId,
      sender: isOwner ? 'seller' : 'buyer', sender_id: uid, body: body.trim(),
      created_at: new Date().toISOString(),
    };
    db.messages.push(message); save(db);
    return message;
  }

  function getThread(shopId, buyerIdOverride) {
    const db = load();
    const uid = currentUserId();
    const shop = db.shops.find(s => s.id === Number(shopId));
    if (!shop) throw new Error('Shop not found.');
    const buyerId = shop.owner_id === uid ? buyerIdOverride : uid;
    if (!buyerId) throw new Error('buyerId is required.');
    return db.messages.filter(m => m.shop_id === Number(shopId) && String(m.buyer_id) === String(buyerId))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }

  function getConversations() {
    const db = load();
    const uid = currentUserId();
    const myShopRow = db.shops.find(s => s.owner_id === uid);

    if (myShopRow) {
      const msgs = db.messages.filter(m => m.shop_id === myShopRow.id);
      const byBuyer = {};
      msgs.forEach(m => { if (!byBuyer[m.buyer_id] || new Date(m.created_at) > new Date(byBuyer[m.buyer_id].created_at)) byBuyer[m.buyer_id] = m; });
      const conversations = Object.values(byBuyer)
        .map(m => { const b = db.users.find(u => u.id === m.buyer_id); return { buyerId: m.buyer_id, buyerName: b ? `${b.first_name} ${b.last_name}` : 'Buyer', lastMessage: m.body, lastAt: m.created_at }; })
        .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
      return { conversations, role: 'seller' };
    }

    const msgs = db.messages.filter(m => m.buyer_id === uid);
    const byShop = {};
    msgs.forEach(m => { if (!byShop[m.shop_id] || new Date(m.created_at) > new Date(byShop[m.shop_id].created_at)) byShop[m.shop_id] = m; });
    const conversations = Object.values(byShop)
      .map(m => { const s = db.shops.find(x => x.id === m.shop_id); return { shopId: m.shop_id, shopName: s ? s.name : 'Shop', lastMessage: m.body, lastAt: m.created_at }; })
      .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
    return { conversations, role: 'buyer' };
  }

  const api = {
    signUp, signIn, signOut, getCurrentUser,
    createShop, myShop, getShop, listShops, updateShop,
    listProducts, addProduct, setProductImage, updateProduct, deleteProduct,
    placeOrder, myOrders, shopOrders, updateOrderStatus,
    sendMessage, getThread, getConversations,
  };

  // Allow this file to be loaded in Node for testing, while still working
  // as a plain global in the browser.
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
