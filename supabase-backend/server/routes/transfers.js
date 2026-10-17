// Manual bank transfer payments: the buyer pays the shop's own account, uploads the receipt,
// the seller checks their bank app and confirms. Only then does the order count as paid.
const express = require('express');
const multer = require('multer');
const supabaseAdmin = require('../supabaseAdmin');
const { requireAuth } = require('../auth');
const { createOrdersFromCart } = require('../orderCreation');
const orderNotify = require('../orderNotify');
const { notify } = require('../notify');
const { rateLimit } = require('../security');
const T = require('../transfer');

const router = express.Router();
const BUCKET = 'payment-proofs';
const MAX_PROOFS = 6;
const naira = n => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
const takeProof = (req, res, next) => upload.single('proof')(req, res, err => {
  if (!err) return next();
  res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That image is too big (4 MB max). Take a screenshot instead of a photo.' : 'Could not read that file.' });
});

const bad = (res, status, error) => res.status(status).json({ error });

// ---------- who is asking? ----------
// Returns { order, shop, role } or sends 404 itself. Strangers get the same 404 as a missing order.
async function loadOrder(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { bad(res, 404, 'Order not found.'); return null; }
  const { data: order } = await supabaseAdmin.from('orders').select('*').eq('id', id).maybeSingle();
  const { data: shop } = order ? await supabaseAdmin.from('shops').select('id, name, owner_id, phone, address, city').eq('id', order.shop_id).maybeSingle() : { data: null };
  let role = null;
  if (order && req.user.id === order.buyer_id) role = 'buyer';
  else if (order && shop && req.user.id === shop.owner_id) role = 'seller';
  else if (order && req.user.role === 'admin') role = 'admin';
  if (!order || !role) { bad(res, 404, 'Order not found.'); return null; }
  return { order, shop, role };
}

async function accountOf(shopId) {
  const { data } = await supabaseAdmin.from('shop_transfer_accounts').select('*').eq('shop_id', shopId).maybeSingle();
  return data || null;
}

async function signedProofUrl(path) {
  if (!path) return null;
  try {
    const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 120);
    return (data && (data.signedUrl || data.signedURL)) || null;
  } catch { return null; }
}

// What each side of the order is allowed to see about a transfer.
async function transferOut(order, shop, role) {
  const acct = order.payment_method === 'manual' ? await accountOf(order.shop_id) : null;
  const markup = Number(order.markup_amount || 0);
  const hide = role === 'seller' ? markup : 0; // sellers never see Aurora's markup
  return {
    id: order.id,
    trackingId: order.tracking_id || null,
    status: order.status,
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    transferStatus: order.transfer_status || null,
    reference: order.transfer_reference || null,
    rejectReason: order.transfer_reject_reason || null,
    total: Number(order.total) - hide,
    deliveryFee: Number(order.delivery_fee),
    createdAt: order.created_at,
    proofUploadedAt: order.proof_uploaded_at || null,
    proofCount: order.proof_count || 0,
    proofsLeft: Math.max(0, MAX_PROOFS - (order.proof_count || 0)),
    confirmedAt: order.transfer_confirmed_at || null,
    items: (order.items || []).map(i => ({ name: i.name, qty: i.qty, size: i.size || '', emoji: i.emoji || '', price: role === 'seller' && i.basePrice != null ? Number(i.basePrice) : Number(i.price) })),
    shop: shop ? { id: shop.id, name: shop.name } : null,
    account: acct ? { bankName: acct.bank_name, accountNumber: acct.account_number, accountName: acct.account_name } : null,
    proofUrl: order.proof_path ? await signedProofUrl(order.proof_path) : null,
    // What the receipt scanner should look for (the seller's browser does the actual scanning).
    expected: acct ? { amount: Number(order.total) - hide, accountNumber: acct.account_number, accountName: acct.account_name, reference: order.transfer_reference, orderCreatedAt: order.created_at } : null,
  };
}

// ---------- seller: the account buyers pay into ----------
async function myShop(req) {
  const { data } = await supabaseAdmin.from('shops').select('id, name').eq('owner_id', req.user.id).maybeSingle();
  return data || null;
}
router.get('/account', requireAuth, async (req, res) => {
  const shop = await myShop(req);
  if (!shop) return bad(res, 404, "You don't have a shop yet.");
  const a = await accountOf(shop.id);
  res.json({ account: a ? { bankName: a.bank_name, accountNumber: a.account_number, accountName: a.account_name } : null });
});
router.put('/account', requireAuth, async (req, res) => {
  const shop = await myShop(req);
  if (!shop) return bad(res, 404, "You don't have a shop yet.");
  const c = T.cleanAccount(req.body);
  if (c.error) return bad(res, 400, c.error);
  const { error } = await supabaseAdmin.from('shop_transfer_accounts').upsert({ shop_id: shop.id, ...c.value, updated_at: new Date().toISOString() }, { onConflict: 'shop_id' });
  if (error) return bad(res, 500, error.message);
  res.json({ account: { bankName: c.value.bank_name, accountNumber: c.value.account_number, accountName: c.value.account_name } });
});
router.delete('/account', requireAuth, async (req, res) => {
  const shop = await myShop(req);
  if (!shop) return bad(res, 404, "You don't have a shop yet.");
  await supabaseAdmin.from('shop_transfer_accounts').delete().eq('shop_id', shop.id);
  res.json({ ok: true });
});

// ---------- buyer: place the order ----------
router.post('/checkout', requireAuth, rateLimit({ windowMs: 10 * 60_000, max: 20, key: r => 'tco:' + (r.user ? r.user.id : r.ip) }), async (req, res) => {
  let orders;
  try {
    orders = await createOrdersFromCart(req.user.id, req.user.phone, { ...req.body, paymentMethod: 'manual', directPay: true }, {
      // Refuse BEFORE anything is created if a shop in the cart cannot receive transfers.
      beforeCreate: async rawShopIds => {
        const shopIds = rawShopIds.map(Number);
        const { data: accts } = await supabaseAdmin.from('shop_transfer_accounts').select('shop_id').in('shop_id', shopIds);
        const have = new Set((accts || []).map(a => a.shop_id));
        const missing = shopIds.filter(id => !have.has(id));
        if (missing.length) {
          const { data: shops } = await supabaseAdmin.from('shops').select('id, name').in('id', missing);
          const names = (shops || []).map(s => s.name).join(', ') || 'A shop in your cart';
          throw Object.assign(new Error(`${names} hasn't set up bank-transfer payments yet. Pick another payment method.`), { status: 400 });
        }
      },
    });
  } catch (err) {
    return bad(res, err.status || 500, err.message);
  }

  const out = [];
  for (const o of orders) {
    // Reference (and a tracking ID, if the order has none yet) are random; on the very unlikely clash, draw again.
    let row = null;
    for (let attempt = 0; attempt < 5 && !row; attempt++) {
      const patch = { transfer_status: 'awaiting_proof', transfer_reference: T.newReference() };
      if (!o.tracking_id) patch.tracking_id = T.newTrackingId();
      const { data, error } = await supabaseAdmin.from('orders').update(patch).eq('id', o.id).select().single();
      if (!error && data) row = data;
    }
    if (!row) return bad(res, 500, 'Could not finish creating your order.');
    const { data: shop } = await supabaseAdmin.from('shops').select('id, name, owner_id').eq('id', row.shop_id).maybeSingle();
    out.push(await transferOut(row, shop, 'buyer'));
  }
  res.json({ orders: out });
});

router.get('/order/:id', requireAuth, async (req, res) => {
  const ctx = await loadOrder(req, res); if (!ctx) return;
  res.json({ order: await transferOut(ctx.order, ctx.shop, ctx.role), role: ctx.role });
});

// ---------- buyer: upload the receipt ----------
router.post('/order/:id/proof', requireAuth, rateLimit({ windowMs: 10 * 60_000, max: 12, key: r => 'proof:' + (r.user ? r.user.id : r.ip) }), takeProof, async (req, res) => {
  const ctx = await loadOrder(req, res); if (!ctx) return;
  const { order, shop } = ctx;
  if (ctx.role !== 'buyer') return bad(res, 403, 'Only the buyer can upload the receipt.');
  if (order.payment_method !== 'manual') return bad(res, 400, 'This order is not a bank-transfer order.');
  if (order.payment_status === 'paid') return bad(res, 400, 'This order is already confirmed as paid.');
  if (order.status === 'cancelled') return bad(res, 400, 'This order was cancelled.');
  if ((order.proof_count || 0) >= MAX_PROOFS) return bad(res, 400, 'Too many uploads for this order. Please message the seller instead.');
  if (!req.file) return bad(res, 400, 'Choose a screenshot or photo of your transfer receipt.');

  const kind = T.sniffImage(req.file.buffer);
  if (!kind) return bad(res, 400, 'Only JPG, PNG or WEBP images are accepted.');
  const hash = T.sha256(req.file.buffer);

  // The same receipt picture cannot pay for two different orders.
  const { data: dup } = await supabaseAdmin.from('orders').select('id').eq('proof_hash', hash).neq('id', order.id).limit(1);
  if (dup && dup.length) return bad(res, 409, 'This receipt image was already used for another order. Upload the receipt for THIS payment.');

  const path = `${order.id}/${Date.now()}-${Math.round(Math.random() * 1e9)}.${kind.ext}`;
  const up = await supabaseAdmin.storage.from(BUCKET).upload(path, req.file.buffer, { contentType: kind.mime, upsert: false });
  if (up.error) return bad(res, 500, 'Upload failed: ' + up.error.message);
  if (order.proof_path) supabaseAdmin.storage.from(BUCKET).remove([order.proof_path]).catch(() => {}); // best effort: drop the replaced file

  const { data: updated, error } = await supabaseAdmin.from('orders').update({
    transfer_status: 'proof_submitted', proof_path: path, proof_hash: hash,
    proof_uploaded_at: new Date().toISOString(), proof_count: (order.proof_count || 0) + 1, transfer_reject_reason: null,
  }).eq('id', order.id).select().single();
  if (error) return bad(res, 500, error.message);

  if (shop && shop.owner_id) {
    await notify(shop.owner_id, {
      kind: 'order', dedupeKey: `order:${order.id}:proof`, url: 'seller.html#orders',
      title: `Payment receipt for order #AUR-${order.id}`,
      body: `A buyer says they paid ${naira(order.total)} (ref ${order.transfer_reference}). Check your bank app, then confirm in Aurora.`,
    });
  }
  res.json({ order: await transferOut(updated, shop, 'buyer') });
});

// ---------- seller: "I received it" / "Not received" ----------
function sellerOnly(ctx, res) {
  if (ctx.role !== 'seller' && ctx.role !== 'admin') { bad(res, 403, 'Only the seller can do this.'); return false; }
  if (ctx.order.payment_method !== 'manual') { bad(res, 400, 'This order is not a bank-transfer order.'); return false; }
  if (ctx.order.payment_status === 'paid') { bad(res, 400, 'This order is already confirmed as paid.'); return false; }
  if (ctx.order.status === 'cancelled') { bad(res, 400, 'This order was cancelled.'); return false; }
  return true;
}

router.post('/order/:id/confirm', requireAuth, async (req, res) => {
  const ctx = await loadOrder(req, res); if (!ctx) return;
  if (!sellerOnly(ctx, res)) return;
  const { data: updated, error } = await supabaseAdmin.from('orders').update({
    payment_status: 'paid', paid_at: new Date().toISOString(),
    transfer_status: 'confirmed', transfer_confirmed_at: new Date().toISOString(), transfer_reject_reason: null,
    commission_amount: 0, payout_amount: 0, payout_status: 'not_ready', // money went straight to the seller; nothing to release
  }).eq('id', ctx.order.id).select().single();
  if (error) return bad(res, 500, error.message);
  await orderNotify.announceOrders([updated]); // seller: new paid order · buyer: confirmed + tracking ID
  res.json({ order: await transferOut(updated, ctx.shop, ctx.role) });
});

router.post('/order/:id/reject', requireAuth, async (req, res) => {
  const ctx = await loadOrder(req, res); if (!ctx) return;
  if (!sellerOnly(ctx, res)) return;
  const reason = String((req.body && req.body.reason) || '').trim();
  if (reason.length < 3) return bad(res, 400, 'Tell the buyer briefly what is wrong (for example: "I do not see ₦5,500 yet").');
  if (reason.length > 200) return bad(res, 400, 'Keep the reason under 200 characters.');
  const { data: updated, error } = await supabaseAdmin.from('orders').update({ transfer_status: 'rejected', transfer_reject_reason: reason }).eq('id', ctx.order.id).select().single();
  if (error) return bad(res, 500, error.message);
  await notify(ctx.order.buyer_id, {
    kind: 'order', dedupeKey: `order:${ctx.order.id}:payrej`, url: `transfer.html?o=${ctx.order.id}`,
    title: `Payment not confirmed — order #AUR-${ctx.order.id}`,
    body: `${ctx.shop ? ctx.shop.name : 'The seller'} could not confirm your payment: ${reason}`,
  });
  res.json({ order: await transferOut(updated, ctx.shop, ctx.role) });
});

// ---------- the Aurora receipt (any paid order, or a pay-on-delivery order) ----------
router.get('/receipt/:id', requireAuth, async (req, res) => {
  const ctx = await loadOrder(req, res); if (!ctx) return;
  const { order, shop, role } = ctx;
  const paid = order.payment_status === 'paid';
  if (!paid && order.payment_method !== 'pod') return bad(res, 409, 'A receipt is created once the payment is confirmed.');
  const { data: buyer } = await supabaseAdmin.from('profiles').select('first_name, last_name').eq('id', order.buyer_id).maybeSingle();
  const acct = order.payment_method === 'manual' ? await accountOf(order.shop_id) : null;
  const markup = role === 'seller' ? Number(order.markup_amount || 0) : 0;
  const METHOD = { manual: 'Bank transfer (to the shop)', card: 'Card / Paystack', transfer: 'Bank transfer (Paystack)', pod: 'Pay on delivery' };
  res.json({ receipt: {
    receiptNo: T.receiptNo(order.id), orderNo: 'AUR-' + order.id, trackingId: order.tracking_id || null,
    issuedAt: order.transfer_confirmed_at || order.paid_at || order.created_at, orderedAt: order.created_at,
    paid, method: METHOD[order.payment_method] || 'Online', reference: order.transfer_reference || order.paystack_reference || null,
    buyerName: buyer ? `${buyer.first_name} ${buyer.last_name}`.trim() : '',
    shop: shop ? { name: shop.name, phone: shop.phone || '', address: [shop.address, shop.city].filter(Boolean).join(', ') } : null,
    paidTo: acct ? { bankName: acct.bank_name, accountName: acct.account_name, accountMasked: T.maskAccount(acct.account_number) } : null,
    delivery: { type: order.delivery_type, fee: Number(order.delivery_fee), address: role === 'seller' || role === 'buyer' || role === 'admin' ? [order.address, order.area, order.city].filter(Boolean).join(', ') : '' },
    items: (order.items || []).map(i => ({ name: i.name, qty: i.qty, size: i.size || '', price: markup && i.basePrice != null ? Number(i.basePrice) : Number(i.price) })),
    subtotal: Number(order.subtotal) - markup, total: Number(order.total) - markup,
  }, role });
});

module.exports = router;
