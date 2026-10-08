// "What should we tell whom?" for orders and chats. Each function is safe to
// call and `await` — it never throws (see notify.js).
const supabaseAdmin = require('./supabaseAdmin');
const { notify, adminIds, clip } = require('./notify');

const naira = n => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
const trackUrl = t => (t ? `track.html?id=${encodeURIComponent(t)}` : 'buyer.html');

async function shopOf(shopId) {
  const { data } = await supabaseAdmin.from('shops').select('id, name, slug, owner_id').eq('id', shopId).maybeSingle();
  return data || null;
}

// A brand-new order exists (Pay on Delivery) or has just been paid (card).
async function announceOrders(orders) {
  try {
    for (const o of orders || []) {
      const shop = await shopOf(o.shop_id);
      const count = (o.items || []).reduce((s, i) => s + (Number(i.qty) || 1), 0);
      if (shop && shop.owner_id) {
        await notify(shop.owner_id, {
          kind: 'order', dedupeKey: `order:${o.id}:new`, url: 'seller.html',
          title: `New order #AUR-${o.id}`,
          body: `${count} item${count === 1 ? '' : 's'} · ${naira(Number(o.total) - Number(o.markup_amount || 0))} · ${o.payment_method === 'pod' ? 'Pay on delivery' : 'Paid online'}`,
        });
      }
      if (o.buyer_id) {
        await notify(o.buyer_id, {
          kind: 'order', dedupeKey: `order:${o.id}:buyer`, url: trackUrl(o.tracking_id),
          title: `Order confirmed${o.tracking_id ? ' — ' + o.tracking_id : ''}`,
          body: `Your order from ${shop ? shop.name : 'the seller'} (${naira(o.total)}) is in.${o.tracking_id ? ' Keep your tracking ID: ' + o.tracking_id : ''}`,
        });
        // They just ordered, so their saved cart is no longer a reminder candidate.
        await supabaseAdmin.from('carts').delete().eq('user_id', o.buyer_id);
      }
    }
  } catch (err) { console.error('[notify] announceOrders:', err.message); }
}

const STATUS_TEXT = {
  processing: ['Your order is being prepared', 'The seller has started preparing it.'],
  delivered: ['Your order was delivered', "If anything is wrong, open the order and report a problem within 3 days."],
  cancelled: ['Your order was cancelled', 'Contact the seller or support if you did not expect this.'],
};
async function announceStatus(order) {
  try {
    const t = STATUS_TEXT[order.status];
    if (!t || !order.buyer_id) return;
    const shop = await shopOf(order.shop_id);
    await notify(order.buyer_id, {
      kind: 'order', dedupeKey: `order:${order.id}:status`, url: trackUrl(order.tracking_id),
      title: t[0], body: `Order #AUR-${order.id}${shop ? ' from ' + shop.name : ''}. ${t[1]}`,
    });
  } catch (err) { console.error('[notify] announceStatus:', err.message); }
}

// ---------- chats ----------
async function sellerToBuyer(order, text) {
  try {
    if (!order.buyer_id) return;
    const shop = await shopOf(order.shop_id);
    await notify(order.buyer_id, {
      kind: 'chat', dedupeKey: `chat:order:${order.id}:buyer`, url: trackUrl(order.tracking_id),
      title: `${shop ? shop.name : 'The seller'} sent you a message`, body: clip(text, 160),
    });
  } catch (err) { console.error('[notify] sellerToBuyer:', err.message); }
}
async function buyerToSeller(order, text) {
  try {
    const shop = await shopOf(order.shop_id);
    if (!shop || !shop.owner_id) return;
    await notify(shop.owner_id, {
      kind: 'chat', dedupeKey: `chat:order:${order.id}:seller`, url: 'seller.html#messages',
      title: `New message on order #AUR-${order.id}`, body: clip(text, 160),
    });
  } catch (err) { console.error('[notify] buyerToSeller:', err.message); }
}
async function buyerToSupport(order, text) {
  try {
    const ids = await adminIds();
    for (const id of ids) {
      await notify(id, {
        kind: 'support', dedupeKey: `support:order:${order.id}`, url: 'admin.html#support',
        title: `Support: order #AUR-${order.id}`, body: clip(text, 160),
      });
    }
  } catch (err) { console.error('[notify] buyerToSupport:', err.message); }
}
async function supportToBuyer(orderId, text) {
  try {
    const { data: o } = await supabaseAdmin.from('orders').select('id, buyer_id, tracking_id').eq('id', orderId).maybeSingle();
    if (!o || !o.buyer_id) return;
    await notify(o.buyer_id, {
      kind: 'support', dedupeKey: `support:order:${o.id}:buyer`, url: trackUrl(o.tracking_id),
      title: 'Aurora Support replied', body: clip(text, 160),
    });
  } catch (err) { console.error('[notify] supportToBuyer:', err.message); }
}
// The older shop <-> buyer direct messages (messages.js)
async function directMessage({ shop, fromSeller, buyerId, text }) {
  try {
    if (fromSeller) {
      await notify(buyerId, { kind: 'chat', dedupeKey: `chat:shop:${shop.id}:buyer`, url: `shop.html?id=${shop.id}`, title: `${shop.name} sent you a message`, body: clip(text, 160) });
    } else {
      await notify(shop.owner_id, { kind: 'chat', dedupeKey: `chat:shop:${shop.id}:${buyerId}`, url: 'seller.html#messages', title: 'New message from a buyer', body: clip(text, 160) });
    }
  } catch (err) { console.error('[notify] directMessage:', err.message); }
}

module.exports = { announceOrders, announceStatus, sellerToBuyer, buyerToSeller, buyerToSupport, supportToBuyer, directMessage, naira };
