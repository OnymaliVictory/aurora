const express = require('express');
const supabaseAdmin = require('../supabaseAdmin');
const { requireAuth } = require('../auth');
const { createOrdersFromCart, orderOut } = require('../orderCreation');

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

// Everything a receipt needs, looked up by tracking ID.
// Returns 404 (not 403) for someone else's order so IDs can't be probed.
router.get('/receipt/:trackingId', requireAuth, async (req, res) => {
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('*, shops(name, phone, address, area, city)')
    .eq('tracking_id', req.params.trackingId.toUpperCase())
    .maybeSingle();

  if (!order || order.buyer_id !== req.user.id) {
    return res.status(404).json({ error: 'Order not found.' });
  }
  const { shops, ...rest } = order;
  res.json({ order: orderOut(rest), shop: shops });
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