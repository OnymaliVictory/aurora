const supabaseAdmin = require('./supabaseAdmin');

const crypto = require('crypto');

// No 0/O/1/I, so IDs are easy to read from a screenshot
const TRACK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateTrackingId() {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += TRACK_ALPHABET[bytes[i] % TRACK_ALPHABET.length];
  return `AUR-${out.slice(0, 4)}-${out.slice(4)}`; // e.g. AUR-7K4M-X9QP
}

const DELIVERY_FEES = { standard: 1500, express: 3500, pickup: 0 };

function orderOut(row, extra = {}) {
  return {
    id: row.id,
    buyer_id: row.buyer_id,
    shop_id: row.shop_id,
    status: row.status,
    trackingId: row.tracking_id,
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
    paymentStatus: row.payment_status,
    payoutStatus: row.payout_status,
    paystackReference: row.paystack_reference,
    commissionAmount: row.commission_amount != null ? Number(row.commission_amount) : null,
    payoutAmount: row.payout_amount != null ? Number(row.payout_amount) : null,
    deliveredAt: row.delivered_at,
    disputed: row.disputed,
    paidAt: row.paid_at,
    releasedAt: row.released_at,
    ...extra,
  };
}

// Creates one order per shop represented in the cart (a cart can span
// multiple shops). Does NOT touch payment — payment_status starts
// 'unpaid' regardless of paymentMethod; the caller decides what happens
// next (Pay on Delivery just leaves it unpaid, online payment moves it to
// 'paid' once Paystack confirms).
async function createOrdersFromCart(buyerId, buyerPhone, data) {
  const { items, deliveryType, address, city, area, phone, paymentMethod, note } = data || {};
  if (!Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error('Your cart is empty.'), { status: 400 });
  }
  if (deliveryType !== 'pickup' && !address) {
    throw Object.assign(new Error('Please add a delivery address.'), { status: 400 });
  }

  const productIds = [...new Set(items.map(i => Number(i.productId)))];
  const { data: products, error: prodErr } = await supabaseAdmin.from('products').select('*').in('id', productIds);
  if (prodErr) throw Object.assign(new Error(prodErr.message), { status: 500 });

  const byShop = {};
  for (const item of items) {
    const product = products.find(p => p.id === Number(item.productId));
    if (!product) throw Object.assign(new Error('A product in your cart is no longer available.'), { status: 400 });
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
      buyer_id: buyerId,
      shop_id: Number(shopId),
      status: 'pending',
      tracking_id: generateTrackingId(),
      delivery_type: deliveryType || 'standard',
      delivery_fee: fee,
      subtotal,
      total: subtotal + fee,
      address: address || '',
      city: city || '',
      area: area || '',
      phone: phone || buyerPhone || '',
      payment_method: paymentMethod || 'card',
      payment_status: 'unpaid',
      payout_status: 'not_ready',
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

    if (error) throw Object.assign(new Error(error.message), { status: 500 });

    for (const i of lineItems) {
      const newStock = Math.max(0, (i.product.stock || 0) - i.qty);
      await supabaseAdmin.from('products').update({ stock: newStock, sold: (i.product.sold || 0) + i.qty }).eq('id', i.product.id);
    }

    createdOrders.push(order);
  }

  return createdOrders;
}

module.exports = { createOrdersFromCart, orderOut, DELIVERY_FEES };