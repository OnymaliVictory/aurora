// Aurora OS (supermarket software): plans, buying by bank transfer, my licence.
const express = require('express');
const multer = require('multer');
const supabaseAdmin = require('../supabaseAdmin');
const { requireAuth } = require('../auth');
const { notifyMany, adminIds } = require('../notify');
const { rateLimit, str } = require('../security');
const T = require('../transfer');
const core = require('../osCore');

const router = express.Router();
const BUCKET = 'payment-proofs';
const bad = (res, status, error) => res.status(status).json({ error });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
const takeProof = (req, res, next) => upload.single('proof')(req, res, err => {
  if (!err) return next();
  bad(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'That image is too big (4 MB max). Take a screenshot instead of a photo.' : 'Could not read that file.');
});

const publicSettings = s => ({ enabled: s.enabled, monthly: Number(s.monthly_price), yearly: Number(s.yearly_price), version: s.app_version,
  yearlySavingPercent: Math.max(0, Math.round((1 - Number(s.yearly_price) / (Number(s.monthly_price) * 12)) * 100)) });

// Anyone can see the prices (the sales page works before signing in).
router.get('/plans', async (req, res) => res.json(publicSettings(await core.getSettings())));

const sellerOnly = (req, res, next) => (['seller', 'admin'].includes(req.user.role) ? next()
  : bad(res, 403, 'Aurora OS is for sellers. Please create a seller account to continue.'));

function orderOut(o, settings) {
  const waiting = ['awaiting_proof', 'proof_submitted'].includes(o.status);
  return {
    id: o.id, plan: o.plan, kind: o.kind, amount: Number(o.amount), reference: o.reference, status: o.status,
    businessName: o.business_name, rejectReason: o.reject_reason || null, createdAt: o.created_at,
    proofUploadedAt: o.proof_uploaded_at || null, confirmedAt: o.confirmed_at || null, periodEnd: o.period_end || null,
    account: waiting && settings.account_number ? { bankName: settings.bank_name, accountNumber: settings.account_number, accountName: settings.account_name } : null,
  };
}

// Everything the sales page needs about ME in one call.
router.get('/me', requireAuth, async (req, res) => {
  const [settings, { data: lic }, { data: orders }] = await Promise.all([
    core.getSettings(),
    supabaseAdmin.from('os_licenses').select('*').eq('user_id', req.user.id).maybeSingle(),
    supabaseAdmin.from('os_orders').select('*').eq('user_id', req.user.id).order('id', { ascending: false }).limit(20),
  ]);
  const license = core.describe(lic);
  res.json({
    role: req.user.role, plans: publicSettings(settings), license,
    canDownload: !!(license && license.state !== 'revoked' && settings.download_url),
    listed: lic ? lic.listed !== false : true,
    orders: (orders || []).map(o => orderOut(o, settings)),
  });
});

// ---- start a purchase / renewal ----
router.post('/orders', requireAuth, sellerOnly, rateLimit({ windowMs: 10 * 60_000, max: 15, key: r => 'osord:' + r.user.id }), async (req, res) => {
  const settings = await core.getSettings();
  if (!settings.enabled) return bad(res, 409, 'Aurora OS sales are paused for now. Please check back soon.');
  if (!settings.account_number) return bad(res, 409, 'Payments are not open yet — Aurora is still setting up its bank account. Please try again soon.');
  const plan = req.body && req.body.plan;
  if (!['monthly', 'yearly'].includes(plan)) return bad(res, 400, 'Choose monthly or yearly.');
  const business = str(req.body.businessName, 80);
  if (business.length < 2) return bad(res, 400, 'Enter your supermarket or business name.');

  // One unpaid order at a time keeps the admin list clean.
  const { data: open } = await supabaseAdmin.from('os_orders').select('*').eq('user_id', req.user.id).in('status', ['awaiting_proof', 'proof_submitted']).maybeSingle();
  if (open) return res.json({ order: orderOut(open, settings), existing: true });

  const { data: lic } = await supabaseAdmin.from('os_licenses').select('user_id').eq('user_id', req.user.id).maybeSingle();
  const row = { user_id: req.user.id, business_name: business, plan, kind: lic ? 'renewal' : 'new', amount: core.priceOf(settings, plan) };
  for (let i = 0; i < 5; i++) {                       // reference clashes are astronomically rare; retry anyway
    const { data, error } = await supabaseAdmin.from('os_orders').insert({ ...row, reference: 'OS' + T.newReference().slice(2) }).select().single();
    if (!error) return res.json({ order: orderOut(data, settings) });
    if (!/duplicate|unique/i.test(error.message)) return bad(res, 500, error.message);
  }
  bad(res, 500, 'Could not create the order. Please try again.');
});

async function myOrder(req, res) {
  const id = Number(req.params.id);
  const { data } = Number.isInteger(id) && id > 0 ? await supabaseAdmin.from('os_orders').select('*').eq('id', id).eq('user_id', req.user.id).maybeSingle() : { data: null };
  if (!data) { bad(res, 404, 'Order not found.'); return null; }
  return data;
}

router.post('/orders/:id/proof', requireAuth, rateLimit({ windowMs: 10 * 60_000, max: 20, key: r => 'osproof:' + r.user.id }), takeProof, async (req, res) => {
  const order = await myOrder(req, res); if (!order) return;
  if (!['awaiting_proof', 'proof_submitted'].includes(order.status)) return bad(res, 409, 'This order is already closed.');
  if (!req.file) return bad(res, 400, 'Choose your payment receipt (a screenshot is fine).');
  const kind = T.sniffImage(req.file.buffer);
  if (!kind) return bad(res, 400, 'That file is not a JPG, PNG or WEBP picture.');
  const hash = T.sha256(req.file.buffer);
  const { data: dup } = await supabaseAdmin.from('os_orders').select('id').eq('proof_hash', hash).neq('id', order.id).limit(1);
  if (dup && dup.length) return bad(res, 409, 'That exact receipt was already used for another payment. Upload this payment\'s own receipt.');
  const path = `os/${order.id}-${Date.now()}.${kind.ext}`;
  const up = await supabaseAdmin.storage.from(BUCKET).upload(path, req.file.buffer, { contentType: kind.mime, upsert: false });
  if (up.error) return bad(res, 500, 'Upload failed: ' + up.error.message);
  const { data, error } = await supabaseAdmin.from('os_orders').update({
    status: 'proof_submitted', proof_path: path, proof_hash: hash, proof_uploaded_at: new Date().toISOString(), reject_reason: null,
  }).eq('id', order.id).select().single();
  if (error) return bad(res, 500, error.message);
  notifyMany(await adminIds(), { kind: 'os', dedupeKey: 'os:pending', url: 'admin.html#supermarket',
    title: 'Aurora OS payment to review', body: `${order.business_name} sent a receipt for ${core.naira(order.amount)} (${order.plan}, ref ${order.reference}).` }).catch(() => {});
  res.json({ order: orderOut(data, await core.getSettings()) });
});

router.post('/orders/:id/cancel', requireAuth, async (req, res) => {
  const order = await myOrder(req, res); if (!order) return;
  if (order.status !== 'awaiting_proof') return bad(res, 409, 'Only an order with no receipt yet can be cancelled.');
  await supabaseAdmin.from('os_orders').update({ status: 'cancelled' }).eq('id', order.id);
  res.json({ ok: true });
});

// Download link: only for people whose licence is not revoked (active OR expired — they need it to reinstall and renew).
router.get('/download', requireAuth, async (req, res) => {
  const [settings, { data: lic }] = await Promise.all([core.getSettings(), supabaseAdmin.from('os_licenses').select('status').eq('user_id', req.user.id).maybeSingle()]);
  if (!lic || lic.status === 'revoked') return bad(res, 403, 'Subscribe to download Aurora OS.');
  if (!settings.download_url) return bad(res, 404, 'The download is not ready yet. We will email you when it is.');
  res.json({ url: settings.download_url, version: settings.app_version });
});

// ---- public directory: supermarkets that run Aurora OS (their shop details are already public on their shop page) ----
router.get('/directory', rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
  const { data: lics } = await supabaseAdmin.from('os_licenses').select('user_id, expires_at, status, listed').eq('status', 'active').neq('listed', false).gte('expires_at', new Date().toISOString());
  const ids = (lics || []).map(l => l.user_id);
  if (!ids.length) return res.json({ shops: [] });
  const { data: shops } = await supabaseAdmin.from('shops').select('*').in('owner_id', ids).order('name');
  res.json({ shops: (shops || []).map(r => ({
    name: r.name, slug: r.slug, emoji: r.emoji || '🛒', color: /^#[0-9a-f]{6}$/i.test(r.color || '') ? r.color : null, logoUrl: r.logo_url || null,
    tagline: r.tagline || '', city: r.city || '', area: r.area || '', address: r.address || '', phone: r.phone || '',
    openDays: r.open_days || '', openTime: r.open_time || '', closeTime: r.close_time || '',
    deliveryHome: !!r.delivery_home, deliveryPickup: !!r.delivery_pickup, payOnDelivery: !!r.pay_on_delivery,
    rating: r.rating || 0, reviewCount: r.review_count || 0 })) });
});

// The subscriber chooses whether their supermarket appears in that directory.
router.post('/listing', requireAuth, async (req, res) => {
  const listed = !!(req.body && req.body.listed);
  const { data, error } = await supabaseAdmin.from('os_licenses').update({ listed }).eq('user_id', req.user.id).select('user_id');
  if (error) return bad(res, 500, error.message);
  if (!data || !data.length) return bad(res, 404, 'You do not have a subscription yet.');
  res.json({ ok: true, listed });
});

module.exports = router;
