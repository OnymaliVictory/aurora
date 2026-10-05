const express = require('express');
const supabaseAdmin = require('../supabaseAdmin');
const { requireAuth } = require('../auth');
const { pushReady, emailReady } = require('../notify');

const router = express.Router();

// ---------- Public: what the browser needs to know ----------
router.get('/config', (req, res) => {
  res.json({ push: pushReady(), pushKey: pushReady() ? process.env.VAPID_PUBLIC_KEY : null, email: emailReady() });
});

// ---------- Inbox (the bell) ----------
router.get('/', requireAuth, async (req, res) => {
  const [{ data, error }, { count }] = await Promise.all([
    supabaseAdmin.from('notifications').select('id, kind, title, body, url, read_at, created_at')
      .eq('user_id', req.user.id).order('id', { ascending: false }).limit(30),
    supabaseAdmin.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id).is('read_at', null),
  ]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({
    unread: count || 0,
    notifications: data.map(n => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, url: n.url, read: !!n.read_at, createdAt: n.created_at })),
  });
});

router.get('/count', requireAuth, async (req, res) => {
  const { count, error } = await supabaseAdmin.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id).is('read_at', null);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ unread: count || 0 });
});

// { ids: [1,2] } marks those; no ids marks everything as read.
router.post('/read', requireAuth, async (req, res) => {
  let q = supabaseAdmin.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', req.user.id).is('read_at', null);
  const ids = req.body && Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger).slice(0, 100) : null;
  if (ids) q = q.in('id', ids);
  const { error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---------- Device pop-ups ----------
router.post('/push/subscribe', requireAuth, async (req, res) => {
  const sub = req.body && req.body.subscription;
  const endpoint = sub && sub.endpoint, p256dh = sub && sub.keys && sub.keys.p256dh, auth = sub && sub.keys && sub.keys.auth;
  if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || String(p256dh).length > 200 || String(auth).length > 100) {
    return res.status(400).json({ error: 'That device subscription looks invalid.' });
  }
  // One row per device. If the same browser was used by someone else before, it now belongs to this user.
  const { error } = await supabaseAdmin.from('push_subscriptions').upsert({ user_id: req.user.id, endpoint, p256dh, auth }, { onConflict: 'endpoint' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.post('/push/unsubscribe', requireAuth, async (req, res) => {
  const endpoint = req.body && req.body.endpoint;
  if (typeof endpoint !== 'string') return res.status(400).json({ error: 'endpoint is required.' });
  const { error } = await supabaseAdmin.from('push_subscriptions').delete().eq('user_id', req.user.id).eq('endpoint', endpoint);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---------- Email choices ----------
const PREF_KEYS = ['email_messages', 'email_products', 'email_reminders'];
router.get('/prefs', requireAuth, async (req, res) => {
  const { data } = await supabaseAdmin.from('notification_prefs').select('email_messages, email_products, email_reminders').eq('user_id', req.user.id).maybeSingle();
  res.json({ prefs: { email_messages: true, email_products: true, email_reminders: true, ...(data || {}) } });
});
router.post('/prefs', requireAuth, async (req, res) => {
  const row = { user_id: req.user.id };
  for (const k of PREF_KEYS) if (req.body && typeof req.body[k] === 'boolean') row[k] = req.body[k];
  const { error } = await supabaseAdmin.from('notification_prefs').upsert(row, { onConflict: 'user_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---------- Following shops ----------
const shopIdOf = req => { const n = Number(req.params.shopId); return Number.isInteger(n) && n > 0 ? n : null; };

router.get('/follows', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin.from('follows').select('shop_id').eq('buyer_id', req.user.id).limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ shopIds: data.map(f => f.shop_id) });
});

router.post('/follows/:shopId', requireAuth, async (req, res) => {
  const shopId = shopIdOf(req); if (!shopId) return res.status(400).json({ error: 'Bad shop id.' });
  const { data: shop } = await supabaseAdmin.from('shops').select('id, owner_id').eq('id', shopId).maybeSingle();
  if (!shop) return res.status(404).json({ error: 'Shop not found.' });
  if (shop.owner_id === req.user.id) return res.status(400).json({ error: "You can't follow your own shop." });
  const { error } = await supabaseAdmin.from('follows').upsert({ buyer_id: req.user.id, shop_id: shopId }, { onConflict: 'buyer_id,shop_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, following: true });
});

router.delete('/follows/:shopId', requireAuth, async (req, res) => {
  const shopId = shopIdOf(req); if (!shopId) return res.status(400).json({ error: 'Bad shop id.' });
  const { error } = await supabaseAdmin.from('follows').delete().eq('buyer_id', req.user.id).eq('shop_id', shopId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, following: false });
});

// ---------- Saved cart (so we can remind people, and so it follows them across devices) ----------
router.get('/cart', requireAuth, async (req, res) => {
  const { data } = await supabaseAdmin.from('carts').select('items').eq('user_id', req.user.id).maybeSingle();
  res.json({ items: (data && data.items) || [] });
});

router.post('/cart', requireAuth, async (req, res) => {
  const raw = req.body && Array.isArray(req.body.items) ? req.body.items : null;
  if (!raw) return res.status(400).json({ error: 'items must be a list.' });
  // Keep only the few fields we need, with sane sizes — never store whatever the browser sends.
  const items = raw.slice(0, 50).map(i => ({
    productId: Number(i.productId), name: String(i.name || '').slice(0, 120), price: Number(i.price) || 0,
    qty: Math.min(99, Math.max(1, Number(i.qty) || 1)), size: String(i.size || '').slice(0, 20), emoji: String(i.emoji || '').slice(0, 8),
  })).filter(i => Number.isInteger(i.productId) && i.productId > 0);

  if (!items.length) {
    await supabaseAdmin.from('carts').delete().eq('user_id', req.user.id);
    return res.json({ ok: true, items: 0 });
  }
  const { error } = await supabaseAdmin.from('carts').upsert({ user_id: req.user.id, items, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, items: items.length });
});

module.exports = router;
