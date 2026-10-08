const express = require('express');
const supabaseAdmin = require('../supabaseAdmin');
const paystack = require('../paystack');
const { notify } = require('../notify');
const { getSettings, buyerPrice } = require('../pricing');

const router = express.Router();

const ESCROW_HOLD_DAYS = 3;

// Vercel automatically attaches "Authorization: Bearer <CRON_SECRET>" when
// it invokes a scheduled Cron Job, using the env var of that exact name —
// so as long as CRON_SECRET is set in your Vercel project, only Vercel's
// own scheduler (or someone who knows the secret) can trigger this.
function requireCronSecret(req, res, next) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(500).json({ error: 'CRON_SECRET is not configured on the server.' });
  const header = req.headers.authorization || '';
  if (header !== `Bearer ${expected}`) return res.status(401).json({ error: 'Unauthorized.' });
  next();
}

router.get('/release-payouts', requireCronSecret, async (req, res) => {
  const cutoff = new Date(Date.now() - ESCROW_HOLD_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: dueOrders, error } = await supabaseAdmin
    .from('orders')
    .select('*, shops(name, paystack_recipient_code)')
    .eq('payment_status', 'paid')
    .eq('payout_status', 'pending')
    .eq('disputed', false)
    .lte('delivered_at', cutoff);

  if (error) return res.status(500).json({ error: error.message });

  const results = { released: [], skipped: [], failed: [] };

  for (const order of dueOrders || []) {
    const shop = order.shops;
    if (!shop || !shop.paystack_recipient_code) {
      // Seller hasn't set up a payout account yet — leave it pending so
      // it releases automatically the moment they do.
      results.skipped.push({ orderId: order.id, reason: 'Seller has no payout account set up yet.' });
      continue;
    }

    try {
      const transfer = await paystack.initiateTransfer({
        recipientCode: shop.paystack_recipient_code,
        amountKobo: Math.round(Number(order.payout_amount) * 100),
        reason: `Aurora order #${order.id} — ${shop.name}`,
        reference: `payout_${order.id}_${Date.now()}`,
      });

      await supabaseAdmin.from('orders').update({
        payout_status: 'released',
        released_at: new Date().toISOString(),
      }).eq('id', order.id);

      results.released.push({ orderId: order.id, transferCode: transfer.transfer_code });
    } catch (err) {
      await supabaseAdmin.from('orders').update({ payout_status: 'failed' }).eq('id', order.id);
      results.failed.push({ orderId: order.id, error: err.message });
    }
  }

  res.json(results);
});


// ============================================================
// Daily nudges: abandoned-cart reminders + "a few older products" digest.
// Vercel's free plan can only run a cron once a day, so this is a daily job.
// It stops itself after ~40 seconds; whoever is left is picked up tomorrow.
// ============================================================
const CART_IDLE_HOURS = 24;        // remind after the cart sat untouched this long...
const CART_MAX_DAYS = 14;          // ...but not for carts older than this
const DIGEST_EVERY_DAYS = 4;       // at most one digest per person per 4 days
const OLD_PRODUCT_DAYS = 7;        // "older" = added more than a week ago
const BUDGET_MS = 40 * 1000;
const naira = n => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
const hoursAgo = h => new Date(Date.now() - h * 3600 * 1000).toISOString();

async function remindCarts(deadline) {
  const out = { reminded: 0, skipped: 0 };
  const { data: carts } = await supabaseAdmin.from('carts').select('user_id, items, updated_at')
    .lt('updated_at', hoursAgo(CART_IDLE_HOURS)).gt('updated_at', hoursAgo(CART_MAX_DAYS * 24))
    .order('updated_at', { ascending: true }).limit(200);

  for (const cart of carts || []) {
    if (Date.now() > deadline) break;
    const { data: prefs } = await supabaseAdmin.from('notification_prefs').select('last_cart_reminder_at').eq('user_id', cart.user_id).maybeSingle();
    // One reminder per cart state: if we already reminded since the last change, leave it.
    if (prefs && prefs.last_cart_reminder_at && prefs.last_cart_reminder_at >= cart.updated_at) { out.skipped++; continue; }

    // Use today's real names/prices, and drop anything deleted or sold out.
    const ids = [...new Set((cart.items || []).map(i => Number(i.productId)))];
    const { data: products } = ids.length ? await supabaseAdmin.from('products').select('id, name, price, stock').in('id', ids) : { data: [] };
    const live = (cart.items || []).map(i => ({ item: i, p: (products || []).find(p => p.id === Number(i.productId)) })).filter(x => x.p && x.p.stock > 0);
    if (!live.length) { out.skipped++; continue; }

    const mk = (await getSettings()).markupPercent;
    const total = live.reduce((s, x) => s + buyerPrice(x.p.price, mk) * (Number(x.item.qty) || 1), 0);
    const names = live.map(x => x.p.name);
    const shown = names.slice(0, 2).join(', ') + (names.length > 2 ? ` and ${names.length - 2} more` : '');
    await notify(cart.user_id, {
      kind: 'cart', dedupeKey: 'cart:reminder', url: 'checkout.html',
      title: `You left ${live.length} item${live.length === 1 ? '' : 's'} in your cart`,
      body: `${shown} — ${naira(total)}. They're still waiting for you.`,
    });
    await supabaseAdmin.from('notification_prefs').upsert({ user_id: cart.user_id, last_cart_reminder_at: new Date().toISOString() }, { onConflict: 'user_id' });
    out.reminded++;
  }
  return out;
}

async function sendDigests(deadline) {
  const out = { sent: 0, skipped: 0 };
  const { data: rows } = await supabaseAdmin.from('follows').select('buyer_id').limit(1000);
  const buyers = [...new Set((rows || []).map(r => r.buyer_id))];

  for (const buyerId of buyers) {
    if (Date.now() > deadline) break;
    const { data: prefs } = await supabaseAdmin.from('notification_prefs').select('last_digest_at, digest_seen').eq('user_id', buyerId).maybeSingle();
    if (prefs && prefs.last_digest_at && prefs.last_digest_at > hoursAgo(DIGEST_EVERY_DAYS * 24)) { out.skipped++; continue; }
    let seen = (prefs && prefs.digest_seen) || [];
    if (seen.length > 60) seen = []; // start over once they've seen a lot

    const { data: follows } = await supabaseAdmin.from('follows').select('shop_id').eq('buyer_id', buyerId).limit(200);
    const shopIds = (follows || []).map(f => f.shop_id);
    if (!shopIds.length) { out.skipped++; continue; }

    const { data: products } = await supabaseAdmin.from('products').select('id, name, price, shop_id, stock, created_at')
      .in('shop_id', shopIds).gt('stock', 0).lt('created_at', hoursAgo(OLD_PRODUCT_DAYS * 24)).order('created_at', { ascending: false }).limit(60);
    let fresh = (products || []).filter(p => !seen.includes(p.id));
    if (!fresh.length && (products || []).length) { seen = []; fresh = products; } // they've seen them all: start the rotation again
    const picks = fresh.slice(0, 3);
    const settingsNow = await getSettings();
    if (!picks.length) { out.skipped++; continue; }

    const { data: shops } = await supabaseAdmin.from('shops').select('id, name, slug').in('id', [...new Set(picks.map(p => p.shop_id))]);
    const first = (shops || []).find(s => s.id === picks[0].shop_id);
    await notify(buyerId, {
      kind: 'digest', dedupeKey: 'digest:picks', url: first ? `shop.html?slug=${encodeURIComponent(first.slug)}` : 'buyer.html',
      title: 'A few picks from shops you follow',
      body: picks.map(p => `${p.name} (${naira(buyerPrice(p.price, (settingsNow || {}).markupPercent))})`).join(' · '),
    });
    await supabaseAdmin.from('notification_prefs').upsert({ user_id: buyerId, last_digest_at: new Date().toISOString(), digest_seen: [...seen, ...picks.map(p => p.id)] }, { onConflict: 'user_id' });
    out.sent++;
  }
  return out;
}

router.get('/daily-nudges', requireCronSecret, async (req, res) => {
  const deadline = Date.now() + BUDGET_MS;
  try {
    const carts = await remindCarts(deadline);
    const digests = await sendDigests(deadline);
    res.json({ carts, digests });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;