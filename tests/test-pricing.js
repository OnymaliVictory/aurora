const Module = require('module'); const path = require('path'); const http = require('http'); const makeDb = require('./fakedb');
const W = '/tmp/claude-0/-home-claude/077028a5-d54d-55a6-a938-1eba76a5271d/scratchpad/w/aurora-build/supabase-backend/server/';
const { db, sb } = makeDb({
  platform_settings: [{ id: 1, markup_percent: 0, commission_percent: 5 }],
  shops: [{ id: 1, owner_id: 'seller-1', name: 'StarMart', slug: 'starmart' }, { id: 2, owner_id: 'seller-2', name: 'Other', slug: 'other' }],
  profiles: [{ id: 'buyer-a', first_name: 'J', last_name: 'B', phone: '0803', role: 'buyer' }, { id: 'admin-1', first_name: 'Ad', last_name: 'Min', role: 'admin' }],
  products: [{ id: 10, shop_id: 1, name: 'Shirt', price: 13000, stock: 5, sold: 0, emoji: '👕', created_at: '2026-01-01' }, { id: 11, shop_id: 1, name: 'Cap', price: 1999, stock: 5, sold: 0, created_at: '2026-01-02' }, { id: 20, shop_id: 2, name: 'Mug', price: 500, stock: 5, sold: 0, created_at: '2026-01-03' }],
  orders: [], admin_audit: [], follows: [],
});
sb.auth = { admin: { getUserById: async () => ({ data: { user: { email: 'b@x.com' } } }) } };
sb.rpc = async (fn) => fn === 'admin_earnings' ? { data: { markup: db.orders.filter(o => o.payment_status === 'paid').reduce((s, o) => s + Number(o.markup_amount || 0), 0), commission: db.orders.filter(o => o.payment_status === 'paid').reduce((s, o) => s + Number(o.commission_amount || 0), 0) } } : { data: null };
const USERS = { 'seller-1': { id: 'seller-1', role: 'seller' }, 'seller-2': { id: 'seller-2', role: 'seller' }, 'buyer-a': { id: 'buyer-a', role: 'buyer', email: 'b@x.com', phone: '0803' }, 'admin-1': { id: 'admin-1', role: 'admin' } };
const orig = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === '../supabaseAdmin' || req === './supabaseAdmin') return sb;
  if (req === '../auth') return { requireAuth: (rq, rs, next) => { const u = USERS[(rq.headers.authorization || '').replace('Bearer ', '')]; if (!u) return rs.status(401).json({ error: 'Please sign in.' }); rq.user = u; next(); } };
  if (req === '../uploads') return { upload: { single: () => (a, b, n) => n() }, uploadToSupabase: async () => ({}), deleteFromSupabase() {} };
  if (req === '../paystack') return { verifyTransaction: async () => ({ status: 'success' }), initializeTransaction: async (x) => ({ access_code: 'ac', authorization_url: 'u', _amount: x.amountKobo, _x: (global.__kobo = x.amountKobo) }), verifyWebhookSignature: () => true };
  if (req === '../orderNotify') return { announceOrders: async () => {}, announceStatus: async () => {} };
  if (req === '../notify') return { notify: async () => {}, notifyMany: async () => {}, clip: s => s };
  if (req === 'express') return orig.call(this, path.join(__dirname, 'node_modules/express'), parent, ...rest);
  return orig.call(this, req, parent, ...rest);
};
const express = require('express'); const app = express(); app.use(express.json());
app.use('/api/products', require(W + 'routes/products.js')); app.use('/api/orders', require(W + 'routes/orders.js'));
app.use('/api/payments', require(W + 'routes/payments.js')); app.use('/api/admin', require(W + 'routes/admin.js'));
let ok = true; const check = (n, got, want) => { const p = JSON.stringify(got) === JSON.stringify(want); if (!p) ok = false; console.log(p ? 'PASS' : 'FAIL', n, p ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); };
const srv = app.listen(0, async () => {
  const base = 'http://127.0.0.1:' + srv.address().port;
  const C = (m, p, { auth, body } = {}) => new Promise((resolve, reject) => { const d = body ? JSON.stringify(body) : null; const h = { 'Content-Type': 'application/json' }; if (auth) h.Authorization = 'Bearer ' + auth; if (d) h['Content-Length'] = Buffer.byteLength(d);
    const rq = http.request(base + p, { method: m, headers: h }, rs => { let b = ''; rs.on('data', x => (b += x)); rs.on('end', () => resolve([rs.statusCode, b ? JSON.parse(b) : {}])); }); rq.on('error', reject); if (d) rq.write(d); rq.end(); });
  const pricing = require(W + 'pricing.js');
  // --- permissions on the settings ---
  check('anon cannot read settings', (await C('GET', '/api/admin/settings'))[0], 401);
  check('seller cannot read settings', (await C('GET', '/api/admin/settings', { auth: 'seller-1' }))[0], 403);
  check('buyer cannot change settings', (await C('PUT', '/api/admin/settings', { auth: 'buyer-a', body: { markupPercent: 0, commissionPercent: 0 } }))[0], 403);
  check('seller cannot change settings', (await C('PUT', '/api/admin/settings', { auth: 'seller-1', body: { markupPercent: 99, commissionPercent: 0 } }))[0], 403);
  check('settings unchanged after refusals', db.platform_settings[0].markup_percent, 0);
  // --- validation ---
  for (const [m, c, label] of [[-1, 5, 'negative markup'], [51, 5, 'markup over 50'], [3, 31, 'commission over 30'], ['abc', 5, 'text'], ['1e3', 5, 'exponent'], [null, 5, 'null'], [undefined, 5, 'missing markup'], [true, 5, 'boolean'], [[], 5, 'array'], [3, '', 'blank commission']]) {
    const r = await C('PUT', '/api/admin/settings', { auth: 'admin-1', body: { markupPercent: m, commissionPercent: c } }); check('rejects ' + label, r[0], 400);
  }
  check('still unchanged', [db.platform_settings[0].markup_percent, db.admin_audit.length], [0, 0]);
  // --- at 0% markup nothing changes from the old behaviour ---
  let r = await C('GET', '/api/products/shop/1'); check('0% markup: buyers see seller price', r[1].products.map(p => p.price).sort((a,b)=>b-a), [13000, 1999]);
  // --- admin sets 3.5% ---
  r = await C('PUT', '/api/admin/settings', { auth: 'admin-1', body: { markupPercent: '3.5', commissionPercent: 0 } });
  check('admin can set 3.5% / 0%', [r[0], r[1].settings.markupPercent, r[1].settings.commissionPercent], [200, 3.5, 0]);
  check('change is audit-logged', [db.admin_audit.length, db.admin_audit[0].detail], [1, 'markup 0% → 3.5%, commission 5% → 0%']);
  r = await C('GET', '/api/products/shop/1'); check('buyers now see 13,455 and 2,069 (rounded up)', r[1].products.map(p => p.price).sort((a,b)=>b-a), [13455, 2069]);
  r = await C('GET', '/api/products/mine/1', { auth: 'seller-1' }); check('seller sees OWN price + what buyers pay', [r[1].products.map(p => p.price).sort((a,b)=>b-a), r[1].products.map(p => p.buyerPrice).sort((a,b)=>b-a), r[1].markupPercent], [[13000, 1999], [13455, 2069], 3.5]);
  check("another seller can't use /mine for my shop", (await C('GET', '/api/products/mine/1', { auth: 'seller-2' }))[0], 403);
  check('DB still holds seller price', db.products[0].price, 13000);
  // --- order is priced on the SERVER; a tampered cart price is ignored ---
  r = await C('POST', '/api/payments/checkout', { auth: 'buyer-a', body: { items: [{ productId: 10, qty: 2, price: 1 }, { productId: 11, qty: 1, price: 1 }], deliveryType: 'standard', address: '1 Rd' } });
  check('checkout ok', r[0], 200);
  const o = db.orders[0];
  check('subtotal = marked-up prices (2×13455 + 2069)', o.subtotal, 28979);
  check('total = subtotal + ₦1,500 delivery', o.total, 30479);
  check('markup amount = 28979 − (26000 + 1999)', o.markup_amount, 980);
  check('rates snapshot stored on the order', [o.markup_percent, o.commission_percent], [3.5, 0]);
  check('Paystack asked to charge exactly the total (kobo)', global.__kobo, 3047900);
  check('items store buyer price AND seller price', [o.items[0].price, o.items[0].basePrice], [13455, 13000]);
  // --- admin changes rates AFTER the order: old order keeps its rates ---
  await C('PUT', '/api/admin/settings', { auth: 'admin-1', body: { markupPercent: 10, commissionPercent: 10 } });
  const ref = o.paystack_reference;
  r = await C('GET', '/api/payments/verify/' + ref, { auth: 'buyer-a' });
  check('paid', r[1].paid, true);
  const paid = db.orders[0];
  check('seller payout = their prices + delivery (markup never reaches them), commission 0% as at order time', [paid.commission_amount, paid.payout_amount], [0, 29499]);
  // --- 2nd order under new rates: 10% markup + 10% commission ---
  r = await C('POST', '/api/payments/checkout', { auth: 'buyer-a', body: { items: [{ productId: 10, qty: 1 }], deliveryType: 'pickup' } });
  const o2 = db.orders[1];
  check('order 2 priced at 10%', [o2.subtotal, o2.total, o2.markup_amount], [14300, 14300, 1300]);
  await C('GET', '/api/payments/verify/' + o2.paystack_reference, { auth: 'buyer-a' });
  check('order 2: commission 10% of seller side (13,000) = 1,300, seller gets 11,700', [db.orders[1].commission_amount, db.orders[1].payout_amount], [1300, 11700]);
  check('Aurora keeps markup 1,300 + commission 1,300 on order 2', db.orders[1].markup_amount + db.orders[1].commission_amount, 2600);
  // --- seller view never shows the markup ---
  r = await C('GET', '/api/orders/shop', { auth: 'seller-1' });
  const so = r[1].orders.find(x => x.id === o.id);
  check('seller sees own subtotal/total, not buyer total', [so.subtotal, so.total, so.items[0].price, so.markupAmount], [27999, 29499, 13000, 0]);
  // --- buyer view = what they paid ---
  r = await C('GET', '/api/orders/mine', { auth: 'buyer-a' });
  check('buyer sees what they paid', r[1].orders.find(x => x.id === o.id).total, 30479);
  // --- admin sees breakdown + earnings ---
  r = await C('GET', '/api/admin/orders/' + o.id, { auth: 'admin-1' }); check('admin order shows markup', r[1].order.markup, 980);
  r = await C('GET', '/api/admin/settings', { auth: 'admin-1' }); check('earnings totals', r[1].earnings, { markup: 980 + 1300, commission: 1300 });
  // --- old orders (no markup columns) behave exactly as before ---
  db.orders.push({ id: 99, shop_id: 1, buyer_id: 'buyer-a', total: 10000, subtotal: 8500, delivery_fee: 1500, payment_status: 'unpaid', paystack_reference: 'old', items: [] });
  await C('GET', '/api/payments/verify/old', { auth: 'buyer-a' });
  const old = db.orders.find(x => x.id === 99); check('legacy order: 5% of total', [old.commission_amount, old.payout_amount], [500, 9500]);
  // --- 0% markup = prices untouched ---
  await C('PUT', '/api/admin/settings', { auth: 'admin-1', body: { markupPercent: 0, commissionPercent: 5 } });
  r = await C('GET', '/api/products/shop/1'); check('back to 0%: original prices', r[1].products.map(p => p.price).sort((a,b)=>b-a), [13000, 1999]);
  check('buyerPrice math', [pricing.buyerPrice(13000, 3.5), pricing.buyerPrice(100, 0), pricing.buyerPrice(1, 0.1), pricing.buyerPrice(10, 10)], [13455, 100, 2, 11]);
  console.log(ok ? '\nALL PASS' : '\nSOME FAILED'); srv.close(); process.exit(ok ? 0 : 1);
});
