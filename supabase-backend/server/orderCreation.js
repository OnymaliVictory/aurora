const supabaseAdmin = require('./supabaseAdmin');
const { getSettings, buyerPrice } = require('./pricing');

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
    paymentStatus: row.payment_status,
    payoutStatus: row.payout_status,
    paystackReference: row.paystack_reference,
    commissionAmount: row.commission_amount != null ? Number(row.commission_amount) : null,
    payoutAmount: row.payout_amount != null ? Number(row.payout_amount) : null,
    markupAmount: Number(row.markup_amount || 0),
    deliveredAt: row.delivered_at,
    disputed: row.disputed,
    paidAt: row.paid_at,
    releasedAt: row.released_at,
    ...extra,
  };
}

// The SELLER's view of an order: their own prices only. Aurora's markup is never shown to them.
function orderOutForSeller(row, extra = {}) {
  const o = orderOut(row, extra);
  const m = Number(row.markup_amount || 0);
  return {
    ...o,
    subtotal: o.subtotal - m,
    total: o.total - m,
    markupAmount: 0,
    items: (row.items || []).map(i => ({ ...i, price: i.basePrice != null ? Number(i.basePrice) : Number(i.price), basePrice: undefined })),
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

  // Prices are ALWAYS recomputed here from the database + current admin settings.
  // Whatever price the browser's cart shows is ignored.
  const { markupPercent, commissionPercent } = await getSettings({ fresh: true });
  const fee = DELIVERY_FEES[deliveryType] ?? DELIVERY_FEES.standard;
  const createdOrders = [];

  for (const shopId of Object.keys(byShop)) {
    const lineItems = byShop[shopId];
    const baseSubtotal = lineItems.reduce((s, i) => s + Number(i.product.price) * i.qty, 0);
    const subtotal = lineItems.reduce((s, i) => s + buyerPrice(i.product.price, markupPercent) * i.qty, 0);
    const markupAmount = subtotal - baseSubtotal;

    const { data: order, error } = await supabaseAdmin.from('orders').insert({
      buyer_id: buyerId,
      shop_id: Number(shopId),
      status: 'pending',
      delivery_type: deliveryType || 'standard',
      delivery_fee: fee,
      subtotal,
      total: subtotal + fee,
      markup_percent: markupPercent,
      markup_amount: markupAmount,
      commission_percent: commissionPercent,
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
        price: buyerPrice(i.product.price, markupPercent),
        basePrice: Number(i.product.price),
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

module.exports = { createOrdersFromCart, orderOut, orderOutForSeller, DELIVERY_FEES };