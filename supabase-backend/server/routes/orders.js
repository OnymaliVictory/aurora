const express = require('express');
const supabaseAdmin = require('../supabaseAdmin');
const { requireAuth } = require('../auth');
const { createOrdersFromCart, orderOut } = require('../orderCreation');
const orderNotify = require('../orderNotify');

const router = express.Router();

// Pay on Delivery only. Online payment (card/transfer) goes through
// POST /api/payments/checkout instead, which creates the order the same
// way but also starts a real Paystack transaction.
router.post('/', requireAuth, async (req, res) => {
  if (req.body && req.body.paymentMethod && req.body.paymentMethod !== 'pod') {
    return res.status(400).json({ error: 'Card and bank transfer payments go through /api/payments/checkout.' });
  }
  try {
    const orders = await createOrdersFromCart(req.user.id, req.user.phone, { ...req.body, paymentMethod: 'pod' });
    await orderNotify.announceOrders(orders); // tells the seller + confirms to the buyer; never throws
    res.json({ orders: orders.map(o => orderOut(o)) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/mine', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin.from('orders').select('*, shops(*)').eq('buyer_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const orders = data.map(row => {
    const shop = row.shops;
    const { shops, ...rest } = row;
    return orderOut(rest, { shop: shop ? { id: shop.id, name: shop.name, slug: shop.slug } : null });
  });
  res.json({ orders });
});

router.get('/shop', requireAuth, async (req, res) => {
  const { data: shop } = await supabaseAdmin.from('shops').select('id').eq('owner_id', req.user.id).maybeSingle();
  if (!shop) return res.json({ orders: [] });

  const { data, error } = await supabaseAdmin.from('orders').select('*').eq('shop_id', shop.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const buyerIds = [...new Set(data.map(o => o.buyer_id))];
  const { data: buyers } = buyerIds.length
    ? await supabaseAdmin.from('profiles').select('id, first_name, last_name').in('id', buyerIds)
    : { data: [] };

  const orders = data.map(row => {
    const buyer = buyers.find(b => b.id === row.buyer_id);
    return orderOut(row, { buyer: buyer ? { id: buyer.id, name: `${buyer.first_name} ${buyer.last_name}` } : null });
  });
  res.json({ orders });
});

// ---------- Seller side of the order chat ----------
// Only the owner of the shop an order belongs to may read or write its chat.
async function loadSellerOrder(req, res) {
  const { data: order } = await supabaseAdmin.from('orders').select('id, shop_id, buyer_id, tracking_id').eq('id', Number(req.params.id)).maybeSingle();
  if (!order) { res.status(404).json({ error: 'Order not found.' }); return null; }
  const { data: shop } = await supabaseAdmin.from('shops').select('owner_id').eq('id', order.shop_id).maybeSingle();
  if (!shop || shop.owner_id !== req.user.id) { res.status(403).json({ error: 'Not your order.' }); return null; }
  return order;
}

// ---------- List of order chats for the seller's Messages inbox ----------
// One row per order that has at least one chat message, newest first.
router.get('/chats', requireAuth, async (req, res) => {
  const { data: shop } = await supabaseAdmin.from('shops').select('id').eq('owner_id', req.user.id).maybeSingle();
  if (!shop) return res.json({ chats: [] });

  const { data: orders, error: oErr } = await supabaseAdmin.from('orders').select('id, buyer_id').eq('shop_id', shop.id);
  if (oErr) return res.status(500).json({ error: oErr.message });
  if (!orders.length) return res.json({ chats: [] });

  const { data: msgs, error } = await supabaseAdmin
    .from('order_messages')
    .select('id, order_id, sender_role, body, created_at')
    .in('order_id', orders.map(o => o.id)).eq('channel', 'seller')
    .order('id', { ascending: false }).limit(500);
  if (error) return res.status(500).json({ error: error.message });

  // Newest first, so the first message we meet for an order is its latest.
  const latest = new Map();
  for (const m of msgs) if (!latest.has(m.order_id)) latest.set(m.order_id, m);

  const buyerIds = [...new Set(orders.filter(o => latest.has(o.id)).map(o => o.buyer_id).filter(Boolean))];
  const { data: buyers } = buyerIds.length
    ? await supabaseAdmin.from('profiles').select('id, first_name, last_name').in('id', buyerIds)
    : { data: [] };

  const chats = [...latest.values()].map(m => {
    const order = orders.find(o => o.id === m.order_id);
    const b = buyers.find(x => x.id === order.buyer_id);
    return {
      orderId: m.order_id,
      buyerName: b ? `${b.first_name} ${b.last_name}`.trim() : 'Buyer',
      lastBody: m.body,
      lastRole: m.sender_role,
      lastAt: m.created_at,
    };
  });
  res.json({ chats });
});

router.get('/:id/chat', requireAuth, async (req, res) => {
  const order = await loadSellerOrder(req, res);
  if (!order) return;
  const after = Number(req.query.after) || 0;
  const { data, error } = await supabaseAdmin
    .from('order_messages')
    .select('id, sender_role, body, created_at')
    .eq('order_id', order.id).eq('channel', 'seller')
    .gt('id', after).order('id', { ascending: true }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ messages: data.map(m => ({ id: m.id, role: m.sender_role, body: m.body, createdAt: m.created_at })) });
});

router.post('/:id/chat', requireAuth, async (req, res) => {
  const order = await loadSellerOrder(req, res);
  if (!order) return;
  const body = String((req.body && req.body.body) || '').trim();
  if (!body) return res.status(400).json({ error: 'Message cannot be empty.' });
  if (body.length > 1000) return res.status(400).json({ error: 'Message is too long (1000 characters max).' });
  const { error } = await supabaseAdmin
    .from('order_messages')
    .insert({ order_id: order.id, channel: 'seller', sender_role: 'seller', body });
  if (error) return res.status(500).json({ error: error.message });
  await orderNotify.sellerToBuyer(order, body);
  res.json({ ok: true });
});

router.patch('/:id/status', requireAuth, async (req, res) => {
  const { data: order } = await supabaseAdmin.from('orders').select('*').eq('id', Number(req.params.id)).maybeSingle();
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const { data: shop } = await supabaseAdmin.from('shops').select('owner_id').eq('id', order.shop_id).maybeSingle();
  if (!shop || shop.owner_id !== req.user.id) return res.status(403).json({ error: 'Not your order to update.' });

  const allowedStatuses = ['pending', 'processing', 'delivered', 'cancelled'];
  if (!allowedStatuses.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status.' });

  const patch = { status: req.body.status };

  // Marking a paid order "delivered" starts the 3-day escrow countdown.
  // Pay-on-Delivery orders never went through online payment, so there's
  // no held money to release — their payout_status stays 'not_ready'.
  if (req.body.status === 'delivered') {
    patch.delivered_at = new Date().toISOString();
    if (order.payment_status === 'paid') patch.payout_status = 'pending';
  }

  const { data: updated, error } = await supabaseAdmin.from('orders').update(patch).eq('id', order.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (updated.status !== order.status) await orderNotify.announceStatus(updated);
  res.json({ order: orderOut(updated) });
});

// Buyer disputes a delivered order — freezes the escrow release. Real
// dispute handling (support review, refund path) is a future feature;
// for now this just stops the automatic 3-day payout so a human can look.
router.post('/:id/dispute', requireAuth, async (req, res) => {
  const { data: order } = await supabaseAdmin.from('orders').select('*').eq('id', Number(req.params.id)).maybeSingle();
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.buyer_id !== req.user.id) return res.status(403).json({ error: 'Not your order.' });
  if (order.payout_status === 'released') return res.status(400).json({ error: 'This order has already been paid out and can no longer be disputed here — please contact support.' });

  const { data: updated, error } = await supabaseAdmin.from('orders').update({ disputed: true }).eq('id', order.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ order: orderOut(updated) });
});

module.exports = router;