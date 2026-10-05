const express = require('express');
const crypto = require('crypto');
const supabaseAdmin = require('../supabaseAdmin');
const { requireAuth } = require('../auth');
const { createOrdersFromCart, orderOut } = require('../orderCreation');
const orderNotify = require('../orderNotify');
const paystack = require('../paystack');

const router = express.Router();

const COMMISSION_PERCENT = 5; // Aurora's cut. One number — change here to adjust platform-wide.

function reference(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

// ---------- Banks (for the seller payout-setup dropdown) ----------
router.get('/banks', async (req, res) => {
  try {
    const banks = await paystack.listBanks();
    res.json({ banks: banks.map(b => ({ name: b.name, code: b.code })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Seller payout account setup ----------
router.post('/payout-account', requireAuth, async (req, res) => {
  const { data: shop } = await supabaseAdmin.from('shops').select('*').eq('owner_id', req.user.id).maybeSingle();
  if (!shop) return res.status(404).json({ error: "You don't have a shop yet." });

  const { accountNumber, bankCode, bankName } = req.body || {};
  if (!accountNumber || !bankCode) return res.status(400).json({ error: 'Bank and account number are required.' });

  try {
    const resolved = await paystack.resolveAccountNumber(accountNumber, bankCode);
    const recipient = await paystack.createTransferRecipient({
      name: resolved.account_name,
      accountNumber,
      bankCode,
    });

    const { data: updated, error } = await supabaseAdmin.from('shops').update({
      bank_code: bankCode,
      bank_name: bankName || '',
      account_number: accountNumber,
      account_name: resolved.account_name,
      paystack_recipient_code: recipient.recipient_code,
    }).eq('id', shop.id).select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({
      accountName: updated.account_name,
      bankName: updated.bank_name,
      accountNumber: updated.account_number,
    });
  } catch (err) {
    // Paystack's resolve endpoint gives a clear message ("Could not resolve
    // account name") when the account number/bank combo is wrong — pass
    // that straight through rather than a generic error.
    res.status(400).json({ error: err.message });
  }
});

router.get('/payout-account', requireAuth, async (req, res) => {
  const { data: shop } = await supabaseAdmin.from('shops').select('account_name, bank_name, account_number, paystack_recipient_code').eq('owner_id', req.user.id).maybeSingle();
  if (!shop) return res.status(404).json({ error: "You don't have a shop yet." });
  res.json({
    connected: !!shop.paystack_recipient_code,
    accountName: shop.account_name,
    bankName: shop.bank_name,
    accountNumber: shop.account_number,
  });
});

// ---------- Checkout (card / bank transfer) ----------
router.post('/checkout', requireAuth, async (req, res) => {
  let orders;
  try {
    orders = await createOrdersFromCart(req.user.id, req.user.phone, req.body);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }

  const total = orders.reduce((s, o) => s + Number(o.total), 0);
  const ref = reference('aurora');

  // One Paystack transaction can cover several orders (a cart that spans
  // multiple shops becomes one order per shop, but the buyer only pays
  // once) — tag every order it covers with the same reference so the
  // webhook can mark them all paid together.
  await supabaseAdmin.from('orders').update({ paystack_reference: ref }).in('id', orders.map(o => o.id));

  try {
    const tx = await paystack.initializeTransaction({
      email: req.user.email,
      amountKobo: Math.round(total * 100),
      reference: ref,
      metadata: { order_ids: orders.map(o => o.id), buyer_id: req.user.id },
    });
    res.json({
      reference: ref,
      accessCode: tx.access_code,
      authorizationUrl: tx.authorization_url,
      orders: orders.map(o => orderOut(o)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Shared by both the webhook and the manual-verify fallback — actually
// applies a confirmed payment to every order under its reference.
async function markPaid(ref) {
  const { data: orders } = await supabaseAdmin.from('orders').select('*').eq('paystack_reference', ref);
  if (!orders || !orders.length) return [];
  if (orders[0].payment_status === 'paid') return orders; // already processed — webhook can fire more than once

  const updated = [];
  for (const order of orders) {
    const commission = Math.round(Number(order.total) * (COMMISSION_PERCENT / 100) * 100) / 100;
    const payout = Math.round((Number(order.total) - commission) * 100) / 100;
    const { data } = await supabaseAdmin.from('orders').update({
      payment_status: 'paid',
      paid_at: new Date().toISOString(),
      commission_amount: commission,
      payout_amount: payout,
    }).eq('id', order.id).select().single();
    updated.push(data);
  }
  await orderNotify.announceOrders(updated.filter(Boolean)); // payment confirmed: tell the seller, confirm to the buyer
  return updated;
}

// Paystack calls this directly — never trust a frontend "success" callback
// alone, since that can be spoofed or interrupted. This is the real source
// of truth for whether money actually moved.
//
// IMPORTANT: this route needs the raw request body to verify Paystack's
// signature, so the app mounting this router must apply express.raw() to
// this exact path BEFORE express.json() runs globally — see api/index.js
// and supabase-backend/server/index.js.
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const valid = paystack.verifyWebhookSignature(req.body, signature);
  if (!valid) return res.status(401).send('Invalid signature');

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).send('Bad payload');
  }

  if (event.event === 'charge.success') {
    await markPaid(event.data.reference);
  }

  res.sendStatus(200);
});

// Fallback for the frontend to poll right after the Paystack popup closes,
// in case the webhook hasn't landed yet — double-checks with Paystack
// directly rather than trusting the popup's own "success" event.
router.get('/verify/:reference', requireAuth, async (req, res) => {
  try {
    const tx = await paystack.verifyTransaction(req.params.reference);
    if (tx.status !== 'success') return res.json({ paid: false, status: tx.status });
    const orders = await markPaid(req.params.reference);
    res.json({ paid: true, orders: orders.map(o => orderOut(o)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;