const express = require('express');
const supabaseAdmin = require('../supabaseAdmin');
const paystack = require('../paystack');

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

module.exports = router;