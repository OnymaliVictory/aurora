const Module = require('module'); const path = require('path'); const makeDb = require('./fakedb');
const W = '/tmp/claude-0/-home-claude/077028a5-d54d-55a6-a938-1eba76a5271d/scratchpad/w/aurora-build/supabase-backend/server/';
const { db, sb } = makeDb({
  shops: [{ id: 1, owner_id: 'seller-1', name: 'StarMart', phone: '0803', address: '1 Road', city: 'PH' }, { id: 2, owner_id: 'seller-2', name: 'NoBank Store' }],
  profiles: [{ id: 'buyer-a', first_name: 'Jess', last_name: 'Buyer', phone: '08031112222', role: 'buyer' }, { id: 'buyer-b', first_name: 'Eve', last_name: 'Other', role: 'buyer' },
    { id: 'seller-1', first_name: 'S', last_name: 'One', role: 'seller' }, { id: 'seller-2', first_name: 'S', last_name: 'Two', role: 'seller' }, { id: 'admin-1', first_name: 'A', last_name: 'D', role: 'admin' }],
  products: [{ id: 1, shop_id: 1, name: 'Sneakers', price: 5000, stock: 10, sold: 0, emoji: '👟' }, { id: 2, shop_id: 2, name: 'Hat', price: 2000, stock: 5, sold: 0, emoji: '🎩' }],
  orders: [], platform_settings: [{ id: 1, markup_percent: 10, commission_percent: 5 }], shop_transfer_accounts: [], notifications: [], carts: [],
});
// in-memory private storage
const files = new Map(); const removed = [];
sb.storage = { from: bucket => ({
  upload: async (p, buf, o) => { files.set(bucket + '/' + p, { buf, ct: o.contentType }); return { error: null }; },
  remove: async ps => { ps.forEach(p => { files.delete(bucket + '/' + p); removed.push(p); }); return { error: null }; },
  createSignedUrl: async p => (files.has(bucket + '/' + p) ? { data: { signedUrl: `https://signed.test/${bucket}/${p}?token=abc` } } : { data: null, error: { message: 'nope' } }),
}) };
const sent = []; // notifications
const USERS = { 'seller-1': 1, 'seller-2': 1, 'buyer-a': 1, 'buyer-b': 1, 'admin-1': 1 };
const orig = Module._load;
Module._load = function (req, parent, ...rest) {
  if (/(^|\/)supabaseAdmin$/.test(req)) return sb;
  if (/(^|\/)notify$/.test(req) && parent && !/orderNotify/.test(parent.filename)) { /* routes: mock below */ }
  if (req === '../notify' || (req === './notify' && /orderNotify/.test(parent.filename))) return { notify: async (u, n) => { sent.push({ to: u, ...n }); }, adminIds: async () => ['admin-1'], clip: (s, n) => String(s).slice(0, n) };
  if (req === '../auth') return { requireAuth: (rq, rs, next) => { const t = (rq.headers.authorization || '').replace('Bearer ', ''); if (!USERS[t]) return rs.status(401).json({ error: 'Please sign in to continue.' }); rq.user = { ...db.profiles.find(p => p.id === t), email: t + '@x.com' }; next(); } };
  if (req === 'express' || req === 'multer') return orig.call(this, path.join(__dirname, 'node_modules', req), parent, ...rest);
  return orig.call(this, req, parent, ...rest);
};
const express = require('express'); const app = express(); app.use(express.json());
app.use('/api/transfers', require(W + 'routes/transfers.js'));
let ok = true; const check = (n, got, want) => { const pass = JSON.stringify(got) === JSON.stringify(want); if (!pass) ok = false; console.log(pass ? 'PASS' : 'FAIL', n, pass ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); };
const PNG = n => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('receipt-image-' + n)]);
const srv = app.listen(0, async () => {
  const base = 'http://127.0.0.1:' + srv.address().port + '/api/transfers';
  const C = async (m, p, { auth, body, file } = {}) => {
    const init = { method: m, headers: {} }; if (auth) init.headers.Authorization = 'Bearer ' + auth;
    if (file) { const fd = new FormData(); fd.append('proof', new Blob([file.buf], { type: file.type || 'image/png' }), file.name || 'r.png'); init.body = fd; }
    else if (body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const r = await fetch(base + p, init); let j = {}; try { j = await r.json(); } catch {} return [r.status, j];
  };
  const cart = [{ productId: 1, qty: 1 }]; const ship = { items: cart, deliveryType: 'standard', address: '5 Road', city: 'PH', area: 'GRA', phone: '08031112222' };

  // ---- seller account ----
  check('anon cannot read account', (await C('GET', '/account'))[0], 401);
  check('bad account number rejected', (await C('PUT', '/account', { auth: 'seller-1', body: { bankName: 'GTBank', accountNumber: '12345', accountName: 'Star Mart' } }))[0], 400);
  check('bad name rejected', (await C('PUT', '/account', { auth: 'seller-1', body: { bankName: 'GTBank', accountNumber: '0123456789', accountName: '<b>x' } }))[0], 400);
  const put = await C('PUT', '/account', { auth: 'seller-1', body: { bankName: 'GTBank', accountNumber: '0123 456 789', accountName: 'Star  Mart Ltd' } });
  check('valid account saved (spaces cleaned)', [put[0], put[1].account], [200, { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Star Mart Ltd' }]);
  check('buyer without a shop cannot set account', (await C('PUT', '/account', { auth: 'buyer-a', body: { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Star Mart' } }))[0], 404);
  check('seller-2 does not see seller-1 account', (await C('GET', '/account', { auth: 'seller-2' }))[1].account, null);

  // ---- checkout ----
  check('anon cannot check out', (await C('POST', '/checkout', { body: ship }))[0], 401);
  const noBank = await C('POST', '/checkout', { auth: 'buyer-a', body: { ...ship, items: [{ productId: 2, qty: 1 }] } });
  check('shop without a transfer account refuses, nothing created', [noBank[0], /NoBank Store/.test(noBank[1].error), db.orders.length], [400, true, 0]);
  const mixed = await C('POST', '/checkout', { auth: 'buyer-a', body: { ...ship, items: [{ productId: 1, qty: 1 }, { productId: 2, qty: 1 }] } });
  check('mixed cart refused as a whole, nothing created, stock untouched', [mixed[0], db.orders.length, db.products[0].stock], [400, 0, 10]);
  const co = await C('POST', '/checkout', { auth: 'buyer-a', body: { ...ship, items: [{ productId: 1, qty: 2 }] } });
  const o1 = co[1].orders && co[1].orders[0];
  check('checkout ok', co[0], 200);
  check('NO markup and NO commission on direct transfers (settings say 10% / 5%)', [o1.total, db.orders[0].markup_amount, db.orders[0].commission_percent, db.orders[0].subtotal], [11500, 0, 0, 10000]);
  check('reference + tracking id shapes', [/^AU[A-HJ-NP-Z2-9]{6}$/.test(o1.reference), /^AUR-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(o1.trackingId)], [true, true]);
  check('starts awaiting proof, unpaid, method manual', [o1.transferStatus, o1.paymentStatus, o1.paymentMethod], ['awaiting_proof', 'unpaid', 'manual']);
  check('buyer is shown the shop account', o1.account, { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Star Mart Ltd' });
  check('seller NOT notified until receipt/confirm', sent.filter(n => n.to === 'seller-1').length, 0);

  // ---- privacy of the order ----
  check('stranger buyer gets 404', (await C('GET', '/order/1', { auth: 'buyer-b' }))[0], 404);
  check('other seller gets 404', (await C('GET', '/order/1', { auth: 'seller-2' }))[0], 404);
  check('anon gets 401', (await C('GET', '/order/1'))[0], 401);
  const sv = await C('GET', '/order/1', { auth: 'seller-1' });
  check('owner seller can read; scanner expectations present', [sv[0], sv[1].role, sv[1].order.expected.amount, sv[1].order.expected.accountNumber, sv[1].order.proofUrl], [200, 'seller', 11500, '0123456789', null]);
  check('admin can read', (await C('GET', '/order/1', { auth: 'admin-1' }))[1].role, 'admin');
  check('bad id 404', (await C('GET', '/order/abc', { auth: 'buyer-a' }))[0], 404);

  // ---- receipt upload ----
  check('no file -> 400', (await C('POST', '/order/1/proof', { auth: 'buyer-a', body: {} }))[0], 400);
  check('text file pretending to be png rejected (magic bytes)', (await C('POST', '/order/1/proof', { auth: 'buyer-a', file: { buf: Buffer.from('<script>alert(1)</script> not an image at all'), type: 'image/png' } }))[0], 400);
  check('5MB file rejected', (await C('POST', '/order/1/proof', { auth: 'buyer-a', file: { buf: Buffer.concat([PNG(0), Buffer.alloc(5 * 1024 * 1024)]) } }))[0], 400);
  check('stranger cannot upload (404)', (await C('POST', '/order/1/proof', { auth: 'buyer-b', file: { buf: PNG(1) } }))[0], 404);
  check('seller cannot upload (403)', (await C('POST', '/order/1/proof', { auth: 'seller-1', file: { buf: PNG(1) } }))[0], 403);
  const up = await C('POST', '/order/1/proof', { auth: 'buyer-a', file: { buf: PNG(1) } });
  check('valid receipt accepted', [up[0], up[1].order.transferStatus, up[1].order.proofCount], [200, 'proof_submitted', 1]);
  check('stored in the PRIVATE bucket', [...files.keys()].every(k => k.startsWith('payment-proofs/1/')) && files.size === 1, true);
  const sn = sent.filter(n => n.to === 'seller-1');
  check('seller notified once with the reference', [sn.length, /AU[A-Z2-9]{6}/.test(sn[0] && sn[0].body)], [1, true]);
  const sv2 = await C('GET', '/order/1', { auth: 'seller-1' });
  check('seller gets a short-lived signed link', /^https:\/\/signed\.test\/payment-proofs\/1\//.test(sv2[1].order.proofUrl), true);
  check('stored file path is never exposed', JSON.stringify(sv2[1]).includes('proof_path'), false);

  // second order, same picture -> reuse blocked
  const co2 = await C('POST', '/checkout', { auth: 'buyer-a', body: ship });
  check('second order created', co2[0], 200);
  check('same receipt image cannot pay a different order', (await C('POST', '/order/2/proof', { auth: 'buyer-a', file: { buf: PNG(1) } }))[0], 409);
  // replacing on the SAME order is fine and removes the old file
  const re = await C('POST', '/order/1/proof', { auth: 'buyer-a', file: { buf: PNG(2) } });
  check('re-upload on same order ok, old file deleted', [re[0], re[1].order.proofCount, files.size, removed.length], [200, 2, 1, 1]);

  // ---- seller decision ----
  check('buyer cannot confirm their own payment', (await C('POST', '/order/1/confirm', { auth: 'buyer-a' }))[0], 403);
  check('other seller cannot confirm', (await C('POST', '/order/1/confirm', { auth: 'seller-2' }))[0], 404);
  check('receipt before confirmation -> 409', (await C('GET', '/receipt/1', { auth: 'buyer-a' }))[0], 409);
  const cf = await C('POST', '/order/1/confirm', { auth: 'seller-1' });
  const row = db.orders[0];
  check('confirm marks paid, no payout owed', [cf[0], row.payment_status, row.transfer_status, row.commission_amount, row.payout_amount, row.payout_status, !!row.paid_at], [200, 'paid', 'confirmed', 0, 0, 'not_ready', true]);
  check('buyer got "order confirmed" + tracking id', sent.some(n => n.to === 'buyer-a' && /Order confirmed/.test(n.title) && n.title.includes(row.tracking_id)), true);
  check('seller got "new order ... Bank transfer confirmed"', sent.some(n => n.to === 'seller-1' && /Bank transfer confirmed/.test(n.body)), true);
  check('confirming twice -> 400', (await C('POST', '/order/1/confirm', { auth: 'seller-1' }))[0], 400);
  check('upload after paid -> 400', (await C('POST', '/order/1/proof', { auth: 'buyer-a', file: { buf: PNG(9) } }))[0], 400);

  // ---- reject path on order 2 ----
  await C('POST', '/order/2/proof', { auth: 'buyer-a', file: { buf: PNG(3) } });
  check('reject needs a reason', (await C('POST', '/order/2/reject', { auth: 'seller-1', body: { reason: ' ' } }))[0], 400);
  const rj = await C('POST', '/order/2/reject', { auth: 'seller-1', body: { reason: 'I do not see the money yet' } });
  check('rejected with reason, still unpaid', [rj[0], rj[1].order.transferStatus, db.orders[1].payment_status], [200, 'rejected', 'unpaid']);
  check('buyer told why', sent.some(n => n.to === 'buyer-a' && /do not see the money/.test(n.body)), true);
  const again = await C('POST', '/order/2/proof', { auth: 'buyer-a', file: { buf: PNG(4) } });
  check('buyer can upload again after rejection; reason cleared', [again[0], again[1].order.transferStatus, again[1].order.rejectReason], [200, 'proof_submitted', null]);

  // ---- upload cap ----
  db.orders[1].proof_count = 6;
  check('upload cap (6) enforced', (await C('POST', '/order/2/proof', { auth: 'buyer-a', file: { buf: PNG(5) } }))[0], 400);

  // ---- the Aurora receipt ----
  const rc = await C('GET', '/receipt/1', { auth: 'buyer-a' }); const R = rc[1].receipt;
  check('receipt has number, tracking id, totals, reference', [rc[0], R.receiptNo, R.trackingId === row.tracking_id, R.total, R.subtotal, R.reference === row.transfer_reference, R.paid], [200, 'RCP-000001', true, 11500, 10000, true, true]);
  check('receipt shows where it was paid, masked', [R.paidTo.bankName, R.paidTo.accountMasked], ['GTBank', '••••••6789']);
  check('receipt does not leak full account number', JSON.stringify(rc[1]).includes('0123456789'), false);
  check('seller can open the receipt too', (await C('GET', '/receipt/1', { auth: 'seller-1' }))[0], 200);
  check('stranger cannot open the receipt', (await C('GET', '/receipt/1', { auth: 'buyer-b' }))[0], 404);
  console.log(ok ? '\nALL PASSED' : '\nSOME FAILED'); srv.close(); process.exit(ok ? 0 : 1);
});
