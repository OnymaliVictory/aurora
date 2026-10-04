const express = require('express');
const supabaseAdmin = require('../supabaseAdmin');

const router = express.Router();

const NOT_FOUND = "We couldn't find an order with that tracking ID. Check it and try again.";

// ---------- Tiny rate limiter ----------
// Stops someone hammering this endpoint to guess tracking IDs.
// Honest caveat: on Vercel each serverless instance has its own memory, so
// this is a speed bump, not a wall. The real protection is that IDs are
// long and random (about 1.1 trillion combinations).
const hits = new Map(); // ip -> [timestamps]
const WINDOW_MS = 10 * 60 * 1000;
const MAX_LOOKUPS = 30;

function rateLimited(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_LOOKUPS;
}

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
  if (rateLimited(req)) {
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

module.exports = router;