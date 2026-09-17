const express = require('express');
const supabaseAdmin = require('../supabaseAdmin');
const { requireAuth } = require('../auth');

const router = express.Router();

const DELIVERY_FEES = { standard: 1500, express: 3500, pickup: 0 };

function orderOut(row, extra = {}) {
  return {
    id: row.id,
    buyer_id: row.buyer_id,
    shop_id: row.shop_id,
    status: row.status,
    deliveryType: row.delivery_type,
    deliveryFee: Number(row.delivery_fee),
    subtotal: Number(row.subtotal),
    total: Number(row.total),
    address: row.address,
    city: row.city,
    area: row.area,
    phone: row.phone,
    paymentMethod: row.payment_method,
    note: row.note,
    items: row.items,
    created_at: row.created_at,
    ...extra,
  };
}

router.post('/', requireAuth, async (req, res) => {
  const { items, deliveryType, address, city, area, phone, paymentMethod, note } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Your cart is empty.' });
  }
  if (deliveryType !== 'pickup' && !address) {
    return res.status(400).json({ error: 'Please add a delivery address.' });
  }

  const productIds = [...new Set(items.map(i => Number(i.productId)))];
  const { data: products, error: prodErr } = await supabaseAdmin.from('products').select('*').in('id', productIds);
  if (prodErr) return res.status(500).json({ error: prodErr.message });

  const byShop = {};
  for (const item of items) {
    const product = products.find(p => p.id === Number(item.productId));
    if (!product) return res.status(400).json({ error: 'A product in your cart is no longer available.' });
    const qty = Math.max(1, Number(item.qty) || 1);
    if (!byShop[product.shop_id]) byShop[product.shop_id] = [];
    byShop[product.shop_id].push({ product, qty, size: item.size || '' });
  }

  const fee = DELIVERY_FEES[deliveryType] ?? DELIVERY_FEES.standard;
  const createdOrders = [];

  for (const shopId of Object.keys(byShop)) {
    const lineItems = byShop[shopId];
    const subtotal = lineItems.reduce((s, i) => s + Number(i.product.price) * i.qty, 0);

    const { data: order, error } = await supabaseAdmin.from('orders').insert({
      buyer_id: req.user.id,
      shop_id: Number(shopId),
      status: 'pending',
      delivery_type: deliveryType || 'standard',
      delivery_fee: fee,
      subtotal,
      total: subtotal + fee,
      address: address || '',
      city: city || '',
      area: area || '',
      phone: phone || req.user.phone || '',
      payment_method: paymentMethod || 'card',
      note: note || '',
      items: lineItems.map(i => ({
        productId: i.product.id,
        name: i.product.name,
        price: Number(i.product.price),
        qty: i.qty,
        size: i.size,
        emoji: i.product.emoji,
        imageUrl: i.product.image_url || null,
      })),
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });

    for (const i of lineItems) {
      const newStock = Math.max(0, (i.product.stock || 0) - i.qty);
      await supabaseAdmin.from('products').update({ stock: newStock, sold: (i.product.sold || 0) + i.qty }).eq('id', i.product.id);
    }

    createdOrders.push(orderOut(order));
  }

  res.json({ orders: createdOrders });
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

router.patch('/:id/status', requireAuth, async (req, res) => {
  const { data: order } = await supabaseAdmin.from('orders').select('*').eq('id', Number(req.params.id)).maybeSingle();
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const { data: shop } = await supabaseAdmin.from('shops').select('owner_id').eq('id', order.shop_id).maybeSingle();
  if (!shop || shop.owner_id !== req.user.id) return res.status(403).json({ error: 'Not your order to update.' });

  const allowedStatuses = ['pending', 'processing', 'delivered', 'cancelled'];
  if (!allowedStatuses.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status.' });

  const { data: updated, error } = await supabaseAdmin.from('orders').update({ status: req.body.status }).eq('id', order.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ order: orderOut(updated) });
});

module.exports = router;
