const express = require('express');
const crypto = require('crypto');
const supabaseAdmin = require('../supabaseAdmin');
const orderNotify = require('../orderNotify');

const router = express.Router();

const NOT_FOUND = "We couldn't find an order with that tracking ID. Check it and try again.";

// ---------- Tiny rate limiter ----------
// Honest caveat: on Vercel each serverless instance has its own memory, so
// this is a speed bump, not a wall. The real protection is that tracking IDs
// are long and random (about 1.1 trillion combinations).
const buckets = new Map(); // key -> [timestamps]

function recent(key, windowMs) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter(t => now - t < windowMs);
  buckets.set(key, list);
  return list;
}
function addHit(key, windowMs) {
  const list = recent(key, windowMs);
  list.push(Date.now());
  return list.length;
}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

const LOOKUP_WINDOW_MS = 10 * 60 * 1000;
const MAX_LOOKUPS = 30;
const CODE_WINDOW_MS = 15 * 60 * 1000;
const MAX_BAD_CODES = 8;

// Accepts "aur-7k4m-x9qp", "AUR7K4MX9QP", " AUR 7K4M X9QP " ... and returns
// the canonical "AUR-7K4M-X9QP", or null if it can't possibly be valid.
function normalizeTrackingId(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== 11 || !s.startsWith('AUR')) return null;
  return `AUR-${s.slice(3, 7)}-${s.slice(7)}`;
}

// Turns an order row into the list of steps the timeline shows.
function buildSteps(o) {
  const status = o.status;
  const placed = { key: 'placed', label: 'Order placed', done: true, at: o.created_at };

  if (status === 'cancelled') {
    return [placed, { key: 'cancelled', label: 'Order cancelled', done: true, failed: true }];
  }

  const isPod = o.payment_method === 'pod';
  const payment = isPod
    ? { key: 'payment', label: 'Pay when your order arrives', done: status === 'delivered' }
    : { key: 'payment', label: 'Payment confirmed', done: o.payment_status === 'paid', at: o.paid_at };

  const steps = [
    placed,
    payment,
    { key: 'preparing', label: 'Seller is preparing your order', done: status === 'processing' || status === 'delivered' },
    { key: 'delivered', label: o.delivery_type === 'pickup' ? 'Picked up' : 'Delivered', done: status === 'delivered', at: o.delivered_at },
  ];

  // Mark the first unfinished step as "current" so the UI can highlight it.
  const firstPending = steps.findIndex(s => !s.done);
  if (firstPending !== -1) steps[firstPending].current = true;
  return steps;
}

// PUBLIC: no login needed, because guests must be able to track too.
// So it only returns what is safe for anyone holding the ID to see:
// NO address, NO phone number, NO buyer name.
router.get('/:trackingId', async (req, res) => {
  if (addHit('lookup:' + clientIp(req), LOOKUP_WINDOW_MS) > MAX_LOOKUPS) {
    return res.status(429).json({ error: 'Too many lookups. Please wait a few minutes and try again.' });
  }

  const trackingId = normalizeTrackingId(req.params.trackingId);
  if (!trackingId) return res.status(404).json({ error: NOT_FOUND });

  const { data: o, error } = await supabaseAdmin
    .from('orders')
    .select('id, tracking_id, status, delivery_type, payment_method, payment_status, created_at, paid_at, delivered_at, total, items, shops(name)')
    .eq('tracking_id', trackingId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  if (!o) return res.status(404).json({ error: NOT_FOUND });

  res.json({
    tracking: {
      trackingId: o.tracking_id,
      orderNumber: `AUR-${o.id}`,
      status: o.status,
      deliveryType: o.delivery_type,
      total: Number(o.total),
      createdAt: o.created_at,
      shopName: o.shops ? o.shops.name : null,
      items: (o.items || []).map(i => ({ name: i.name, qty: i.qty, size: i.size || '', emoji: i.emoji || '' })),
      steps: buildSteps(o),
    },
  });
});

// ---------- Buyer-side chat (works for guests) ----------
// The tracking ID alone is NOT enough to read or write messages. The buyer
// must also send the last 4 digits of the phone number used at checkout, in
// an "x-order-code" header. Two secrets instead of one.
//
// Returns the order row, or sends the error response itself and returns null.
async function authorizeBuyerChat(req, res) {
  const trackingId = normalizeTrackingId(req.params.trackingId);
  if (!trackingId) { res.status(404).json({ error: NOT_FOUND }); return null; }

  // Only WRONG codes count toward the limit, so normal chatting never trips it.
  const key = `code:${clientIp(req)}:${trackingId}`;
  if (recent(key, CODE_WINDOW_MS).length >= MAX_BAD_CODES) {
    res.status(429).json({ error: 'Too many wrong codes. Please wait 15 minutes and try again.' });
    return null;
  }

  const { data: order, error } = await supabaseAdmin
    .from('orders').select('id, phone, shop_id, buyer_id, tracking_id').eq('tracking_id', trackingId).maybeSingle();
  if (error) { res.status(500).json({ error: 'Something went wrong. Please try again.' }); return null; }
  if (!order) { res.status(404).json({ error: NOT_FOUND }); return null; }

  const real = String(order.phone || '').replace(/\D/g, '').slice(-4);
  if (real.length < 4) {
    res.status(403).json({ error: 'This order has no phone number on file, so chat is unavailable. Please contact the seller another way.' });
    return null;
  }

  const supplied = String(req.headers['x-order-code'] || '').replace(/\D/g, '');
  // timingSafeEqual compares in constant time, so response speed can't leak digits.
  const ok = supplied.length === 4 && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(real));
  if (!ok) {
    addHit(key, CODE_WINDOW_MS);
    res.status(403).json({ error: 'That code does not match this order.', needsCode: true });
    return null;
  }
  return order;
}

// ?channel=support talks to Aurora support; anything else talks to the seller.
const channelOf = req => (req.query.channel === 'support' ? 'support' : 'seller');

router.get('/:trackingId/chat', async (req, res) => {
  const order = await authorizeBuyerChat(req, res);
  if (!order) return;

  // ?after=12 means "only messages newer than id 12", so polling stays cheap.
  const after = Number(req.query.after) || 0;
  const { data, error } = await supabaseAdmin
    .from('order_messages')
    .select('id, sender_role, body, created_at')
    .eq('order_id', order.id).eq('channel', channelOf(req))
    .gt('id', after).order('id', { ascending: true }).limit(200);
  if (error) return res.status(500).json({ error: 'Could not load messages.' });

  res.json({ messages: data.map(m => ({ id: m.id, role: m.sender_role, body: m.body, createdAt: m.created_at })) });
});

router.post('/:trackingId/chat', async (req, res) => {
  const order = await authorizeBuyerChat(req, res);
  if (!order) return;

  const body = String((req.body && req.body.body) || '').trim();
  if (!body) return res.status(400).json({ error: 'Message cannot be empty.' });
  if (body.length > 1000) return res.status(400).json({ error: 'Message is too long (1000 characters max).' });

  const channel = channelOf(req);
  const { error } = await supabaseAdmin
    .from('order_messages')
    .insert({ order_id: order.id, channel, sender_role: 'buyer', body });
  if (error) return res.status(500).json({ error: 'Could not send your message.' });

  // A buyer writing to support opens the ticket, or reopens it if it was resolved.
  if (channel === 'support') {
    const { error: tErr } = await supabaseAdmin
      .from('support_tickets')
      .upsert({ order_id: order.id, status: 'open', updated_at: new Date().toISOString() }, { onConflict: 'order_id' });
    if (tErr) return res.status(500).json({ error: 'Your message was sent, but the ticket could not be opened. Please try again.' });
    await orderNotify.buyerToSupport(order, body);
  } else {
    await orderNotify.buyerToSeller(order, body);
  }
  res.json({ ok: true });
});

module.exports = router;
