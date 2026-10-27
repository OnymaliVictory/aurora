// Admin: watch Aurora OS sales and licences, confirm payments, manage prices and the download link.
const express = require('express');
const supabaseAdmin = require('../supabaseAdmin');
const { requireAuth } = require('../auth');
const { notify } = require('../notify');
const { str } = require('../security');
const lic = require('../license');
const core = require('../osCore');

const router = express.Router();
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
  next();
}
router.use(requireAuth, requireAdmin);
const bad = (res, status, error) => res.status(status).json({ error });
const idOf = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const isUuid = v => /^[0-9a-f-]{36}$/i.test(String(v || ''));

async function peopleByIds(ids) {
  const out = new Map();
  ids = [...new Set(ids)].filter(Boolean);
  if (!ids.length) return out;
  const { data } = await supabaseAdmin.from('profiles').select('id, first_name, last_name, phone').in('id', ids);
  for (const p of data || []) out.set(p.id, { name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || '—', phone: p.phone || '' });
  await Promise.all(ids.map(async id => {
    try { const { data: u } = await supabaseAdmin.auth.admin.getUserById(id); out.set(id, { ...(out.get(id) || {}), email: u && u.user ? u.user.email : '' }); } catch { /* ignore */ }
  }));
  return out;
}

// ---------- the numbers ----------
router.get('/stats', async (req, res) => {
  const [{ data: lics }, { data: paid }, { count: pending }, settings] = await Promise.all([
    supabaseAdmin.from('os_licenses').select('plan, status, expires_at'),
    supabaseAdmin.from('os_orders').select('amount, confirmed_at, plan, kind').eq('status', 'confirmed').neq('kind', 'grant').gte('confirmed_at', new Date(Date.now() - 200 * 86400000).toISOString()),
    supabaseAdmin.from('os_orders').select('id', { count: 'exact', head: true }).eq('status', 'proof_submitted'),
    core.getSettings(),
  ]);
  const now = new Date();
  const c = { active: 0, expiring: 0, expired: 0, revoked: 0, monthly: 0, yearly: 0 };
  let mrr = 0;
  for (const l of lics || []) {
    const d = core.describe({ ...l, business_name: '', token: '' }, now);
    if (d.state === 'revoked') { c.revoked++; continue; }
    if (d.state === 'expired') { c.expired++; continue; }
    c.active++; if (d.state === 'expiring') c.expiring++;
    c[l.plan]++;
    mrr += l.plan === 'yearly' ? Number(settings.yearly_price) / 12 : Number(settings.monthly_price);
  }
  const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }), total: 0 }); }
  let revenue = 0;
  for (const o of paid || []) { const m = months.find(x => x.key === String(o.confirmed_at).slice(0, 7)); if (m) m.total += Number(o.amount); revenue += Number(o.amount); }
  res.json({ licenses: c, pendingPayments: pending || 0, mrr: Math.round(mrr), revenue6mo: revenue, months });
});

// ---------- payments ----------
router.get('/orders', async (req, res) => {
  const wanted = ['proof_submitted', 'awaiting_proof', 'confirmed', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : null;
  let q = supabaseAdmin.from('os_orders').select('*').order('id', { ascending: false }).limit(200);
  if (wanted) q = q.eq('status', wanted);
  const { data, error } = await q;
  if (error) return bad(res, 500, error.message);
  const people = await peopleByIds((data || []).map(o => o.user_id));
  res.json({ orders: (data || []).map(o => ({ id: o.id, businessName: o.business_name, plan: o.plan, kind: o.kind, amount: Number(o.amount), reference: o.reference,
    status: o.status, createdAt: o.created_at, proofUploadedAt: o.proof_uploaded_at, confirmedAt: o.confirmed_at, periodEnd: o.period_end, rejectReason: o.reject_reason,
    userId: o.user_id, user: people.get(o.user_id) || {} })) });
});

router.get('/orders/:id', async (req, res) => {
  const id = idOf(req.params.id); if (!id) return bad(res, 404, 'Order not found.');
  const { data: o } = await supabaseAdmin.from('os_orders').select('*').eq('id', id).maybeSingle();
  if (!o) return bad(res, 404, 'Order not found.');
  let proofUrl = null;
  if (o.proof_path) { const { data } = await supabaseAdmin.storage.from('payment-proofs').createSignedUrl(o.proof_path, 300); proofUrl = data && (data.signedUrl || data.signedURL) || null; }
  const people = await peopleByIds([o.user_id]);
  res.json({ order: { ...o, amount: Number(o.amount), proofUrl, user: people.get(o.user_id) || {} } });
});

router.post('/orders/:id/confirm', async (req, res) => {
  const id = idOf(req.params.id); if (!id) return bad(res, 404, 'Order not found.');
  if (!lic.ready()) return bad(res, 409, 'The licence signing key is not set up on the server yet (OS_LICENSE_PRIVATE_KEY in Vercel).');
  const { data: o } = await supabaseAdmin.from('os_orders').select('*').eq('id', id).maybeSingle();
  if (!o) return bad(res, 404, 'Order not found.');
  if (o.status === 'confirmed') return bad(res, 409, 'Already confirmed.');
  if (o.status === 'cancelled') return bad(res, 409, 'The customer cancelled this order.');
  // Claim the order first, so double-clicking can never issue two periods.
  const { data: claimed } = await supabaseAdmin.from('os_orders').update({ status: 'confirmed' }).eq('id', id).in('status', ['awaiting_proof', 'proof_submitted', 'rejected']).select('id');
  if (!claimed || !claimed.length) return bad(res, 409, 'This order was just handled by someone else.');
  try {
    const l = await core.applyPeriod({ userId: o.user_id, business: o.business_name, plan: o.plan, orderId: id, adminId: req.user.id });
    const when = l.periodEnd.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    notify(o.user_id, { kind: 'os', dedupeKey: 'os:confirmed:' + id, url: 'supermarket.html',
      title: 'Aurora OS payment confirmed ✓', body: `Your ${o.plan} subscription is active until ${when}. Open the Supermarket OS page to copy your licence key.` }).catch(() => {});
    res.json({ ok: true, expiresAt: l.expires_at });
  } catch (err) {
    await supabaseAdmin.from('os_orders').update({ status: o.status }).eq('id', id);   // put it back so it can be retried
    bad(res, 500, err.message);
  }
});

router.post('/orders/:id/reject', async (req, res) => {
  const id = idOf(req.params.id); if (!id) return bad(res, 404, 'Order not found.');
  const reason = str(req.body && req.body.reason, 200);
  if (reason.length < 3) return bad(res, 400, 'Tell the customer why (a few words).');
  const { data: o } = await supabaseAdmin.from('os_orders').select('*').eq('id', id).maybeSingle();
  if (!o || ['confirmed', 'cancelled'].includes(o.status)) return bad(res, 409, 'This order cannot be rejected.');
  await supabaseAdmin.from('os_orders').update({ status: 'rejected', reject_reason: reason }).eq('id', id);
  notify(o.user_id, { kind: 'os', dedupeKey: 'os:rejected:' + id, url: 'supermarket.html',
    title: 'Aurora OS payment not confirmed', body: `We could not confirm your payment (ref ${o.reference}): ${reason}. You can upload a new receipt on the Supermarket OS page.` }).catch(() => {});
  res.json({ ok: true });
});

// ---------- licences ----------
router.get('/licenses', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('os_licenses').select('*').order('expires_at', { ascending: true }).limit(500);
  if (error) return bad(res, 500, error.message);
  const people = await peopleByIds((data || []).map(l => l.user_id));
  let rows = (data || []).map(l => { const d = core.describe(l); return { userId: l.user_id, businessName: l.business_name, plan: l.plan, state: d.state, daysLeft: d.daysLeft, startedAt: l.started_at, expiresAt: l.expires_at, user: people.get(l.user_id) || {} }; });
  const f = req.query.filter;
  if (['active', 'expiring', 'expired', 'revoked'].includes(f)) rows = rows.filter(r => (f === 'active' ? ['active', 'expiring'].includes(r.state) : r.state === f));
  res.json({ licenses: rows });
});

async function findLicense(req, res) {
  if (!isUuid(req.params.userId)) { bad(res, 404, 'Licence not found.'); return null; }
  const { data } = await supabaseAdmin.from('os_licenses').select('*').eq('user_id', req.params.userId).maybeSingle();
  if (!data) { bad(res, 404, 'Licence not found.'); return null; }
  return data;
}
router.post('/licenses/:userId/revoke', async (req, res) => {
  const l = await findLicense(req, res); if (!l) return;
  await supabaseAdmin.from('os_licenses').update({ status: 'revoked', updated_at: new Date().toISOString() }).eq('user_id', l.user_id);
  res.json({ ok: true, note: 'Blocks renewals and downloads. A key already on a computer works until its end date.' });
});
router.post('/licenses/:userId/restore', async (req, res) => {
  const l = await findLicense(req, res); if (!l) return;
  await supabaseAdmin.from('os_licenses').update({ status: 'active', updated_at: new Date().toISOString() }).eq('user_id', l.user_id);
  res.json({ ok: true });
});
router.post('/licenses/:userId/extend', async (req, res) => {
  const l = await findLicense(req, res); if (!l) return;
  const days = Number(req.body && req.body.days);
  if (!Number.isInteger(days) || days < 1 || days > 366) return bad(res, 400, 'Days must be between 1 and 366.');
  if (!lic.ready()) return bad(res, 409, 'Licence signing key is not set up.');
  const base = new Date(l.expires_at) > new Date() ? new Date(l.expires_at) : new Date();
  const end = new Date(base.getTime() + days * 86400000);
  const token = lic.issue({ userId: l.user_id, business: l.business_name, plan: l.plan, expiresAt: end, startedAt: l.started_at });
  await supabaseAdmin.from('os_licenses').update({ expires_at: end.toISOString(), token, reminders: {}, updated_at: new Date().toISOString() }).eq('user_id', l.user_id);
  notify(l.user_id, { kind: 'os', dedupeKey: 'os:extended', url: 'supermarket.html', title: 'Aurora OS extended', body: `We added ${days} days to your Aurora OS subscription. Copy your new key from the Supermarket OS page.` }).catch(() => {});
  res.json({ ok: true, expiresAt: end.toISOString() });
});

// Give someone a licence without payment (your own shop, a test customer, a partner).
router.post('/grant', async (req, res) => {
  if (!lic.ready()) return bad(res, 409, 'Licence signing key is not set up.');
  const email = str(req.body && req.body.email, 120).toLowerCase();
  const plan = req.body && req.body.plan;
  const months = Number(req.body && req.body.months);
  if (!['monthly', 'yearly'].includes(plan)) return bad(res, 400, 'Choose a plan.');
  if (!Number.isInteger(months) || months < 1 || months > 36) return bad(res, 400, 'Months must be 1 to 36.');
  let user = null;
  for (let page = 1; page <= 10 && !user; page++) {
    const { data } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    const list = (data && data.users) || [];
    user = list.find(u => (u.email || '').toLowerCase() === email) || null;
    if (list.length < 200) break;
  }
  if (!user) return bad(res, 404, 'No account has that email. They must sign up on Aurora first.');
  const business = str(req.body.businessName, 80) || 'Aurora OS customer';
  const { data: o } = await supabaseAdmin.from('os_orders').insert({ user_id: user.id, business_name: business, plan, kind: 'grant', amount: 0,
    reference: 'GR' + Math.random().toString(36).slice(2, 8).toUpperCase(), status: 'proof_submitted' }).select().single();
  // A grant of N months = N monthly periods, built on the same renewal rule.
  let l;
  for (let i = 0; i < (plan === 'yearly' ? Math.ceil(months / 12) : months); i++) l = await core.applyPeriod({ userId: user.id, business, plan, orderId: i === 0 ? o.id : null, adminId: req.user.id });
  notify(user.id, { kind: 'os', dedupeKey: 'os:granted', url: 'supermarket.html', title: 'You have Aurora OS', body: 'Your Aurora OS licence is ready. Open the Supermarket OS page to copy your key and download the app.' }).catch(() => {});
  res.json({ ok: true, expiresAt: l.expires_at });
});

// ---------- settings ----------
router.get('/settings', async (req, res) => res.json({ settings: await core.getSettings(), signingReady: lic.ready() }));
router.put('/settings', async (req, res) => {
  const b = req.body || {};
  const patch = { updated_at: new Date().toISOString() };
  for (const k of ['monthly_price', 'yearly_price']) {
    if (b[k] !== undefined) { const n = Number(b[k]); if (!(n >= 0 && n <= 100000000)) return bad(res, 400, 'Prices must be a positive number.'); patch[k] = Math.round(n); }
  }
  if (b.bank_name !== undefined) patch.bank_name = str(b.bank_name, 60);
  if (b.account_name !== undefined) patch.account_name = str(b.account_name, 80);
  if (b.account_number !== undefined) { const a = String(b.account_number).replace(/\s+/g, ''); if (a && !/^\d{10}$/.test(a)) return bad(res, 400, 'Account number must be 10 digits.'); patch.account_number = a; }
  if (b.app_version !== undefined) patch.app_version = str(b.app_version, 20);
  if (b.download_url !== undefined) { const u = str(b.download_url, 500); if (u && !/^https:\/\//i.test(u)) return bad(res, 400, 'The download link must start with https://'); patch.download_url = u; }
  if (b.enabled !== undefined) patch.enabled = !!b.enabled;
  const { error } = await supabaseAdmin.from('os_settings').update(patch).eq('id', 1);
  if (error) return bad(res, 500, error.message);
  res.json({ ok: true });
});

module.exports = router;
