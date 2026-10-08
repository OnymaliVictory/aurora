const express = require('express');
const supabaseAdmin = require('../supabaseAdmin');
const { requireAuth } = require('../auth');
const orderNotify = require('../orderNotify');
const pricing = require('../pricing');

const router = express.Router();

// Every route in this file is admin-only. The role is read from the database
// by requireAuth (never from anything the browser sends), and the database
// itself refuses to let users change their own role (see migration-support-admin.sql).
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
  next();
}
router.use(requireAuth, requireAdmin);

const orderIdOf = req => {
  const n = Number(req.params.orderId);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ---------- Ticket list ----------
// ?status=open (default) | resolved | all
router.get('/tickets', async (req, res) => {
  const wanted = ['open', 'resolved', 'all'].includes(req.query.status) ? req.query.status : 'open';

  const { data: allTickets, error } = await supabaseAdmin.from('support_tickets').select('order_id, status, created_at, updated_at');
  if (error) return res.status(500).json({ error: error.message });

  const counts = {
    open: allTickets.filter(t => t.status === 'open').length,
    resolved: allTickets.filter(t => t.status === 'resolved').length,
  };
  const tickets = wanted === 'all' ? allTickets : allTickets.filter(t => t.status === wanted);
  if (!tickets.length) return res.json({ tickets: [], counts });

  const orderIds = tickets.map(t => t.order_id);
  const [{ data: orders }, { data: msgs, error: mErr }] = await Promise.all([
    supabaseAdmin.from('orders').select('id, tracking_id, status, total, phone, shop_id, buyer_id').in('id', orderIds),
    supabaseAdmin.from('order_messages').select('id, order_id, sender_role, body, created_at')
      .in('order_id', orderIds).eq('channel', 'support').order('id', { ascending: false }).limit(1000),
  ]);
  if (mErr) return res.status(500).json({ error: mErr.message });

  const shopIds = [...new Set(orders.map(o => o.shop_id))];
  const buyerIds = [...new Set(orders.map(o => o.buyer_id).filter(Boolean))];
  const [{ data: shops }, { data: buyers }] = await Promise.all([
    shopIds.length ? supabaseAdmin.from('shops').select('id, name').in('id', shopIds) : { data: [] },
    buyerIds.length ? supabaseAdmin.from('profiles').select('id, first_name, last_name').in('id', buyerIds) : { data: [] },
  ]);

  const latest = new Map(); // newest first, so the first one we meet per order is its latest
  for (const m of msgs) if (!latest.has(m.order_id)) latest.set(m.order_id, m);

  const rows = tickets.map(t => {
    const o = orders.find(x => x.id === t.order_id) || {};
    const s = shops.find(x => x.id === o.shop_id);
    const b = buyers.find(x => x.id === o.buyer_id);
    const m = latest.get(t.order_id);
    return {
      orderId: t.order_id,
      trackingId: o.tracking_id || null,
      ticketStatus: t.status,
      orderStatus: o.status || null,
      total: o.total != null ? Number(o.total) : null,
      shopName: s ? s.name : null,
      buyerName: b ? `${b.first_name} ${b.last_name}`.trim() : 'Guest',
      phone: o.phone || '',
      lastBody: m ? m.body : '',
      lastRole: m ? m.sender_role : null,
      lastAt: m ? m.created_at : t.updated_at,
    };
  }).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

  res.json({ tickets: rows, counts });
});

// ---------- One ticket's conversation ----------
router.get('/tickets/:orderId/chat', async (req, res) => {
  const orderId = orderIdOf(req);
  if (!orderId) return res.status(400).json({ error: 'Bad order id.' });
  const after = Number(req.query.after) || 0;
  const { data, error } = await supabaseAdmin.from('order_messages')
    .select('id, sender_role, body, created_at')
    .eq('order_id', orderId).eq('channel', 'support')
    .gt('id', after).order('id', { ascending: true }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ messages: data.map(m => ({ id: m.id, role: m.sender_role, body: m.body, createdAt: m.created_at })) });
});

router.post('/tickets/:orderId/chat', async (req, res) => {
  const orderId = orderIdOf(req);
  if (!orderId) return res.status(400).json({ error: 'Bad order id.' });

  const body = String((req.body && req.body.body) || '').trim();
  if (!body) return res.status(400).json({ error: 'Message cannot be empty.' });
  if (body.length > 1000) return res.status(400).json({ error: 'Message is too long (1000 characters max).' });

  // Admins reply to tickets buyers opened; they don't start new ones.
  const { data: ticket } = await supabaseAdmin.from('support_tickets').select('order_id').eq('order_id', orderId).maybeSingle();
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

  const { error } = await supabaseAdmin.from('order_messages')
    .insert({ order_id: orderId, channel: 'support', sender_role: 'support', body });
  if (error) return res.status(500).json({ error: error.message });
  await orderNotify.supportToBuyer(orderId, body);
  res.json({ ok: true });
});

// ---------- Resolve / reopen ----------
router.patch('/tickets/:orderId', async (req, res) => {
  const orderId = orderIdOf(req);
  if (!orderId) return res.status(400).json({ error: 'Bad order id.' });
  const status = req.body && req.body.status;
  if (!['open', 'resolved'].includes(status)) return res.status(400).json({ error: 'Status must be open or resolved.' });

  const { data, error } = await supabaseAdmin.from('support_tickets')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('order_id', orderId).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Ticket not found.' });
  res.json({ ok: true, status: data.status });
});

// ============================================================
// DASHBOARD
// ============================================================

// ---------- Overview numbers (counted inside the database) ----------
router.get('/stats', async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc('admin_stats');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ stats: data });
});

// ---------- Users ----------
// ?q=text searches email, name or phone.
router.get('/users', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const { data, error } = await supabaseAdmin.rpc('admin_list_users', { search: q, lim: 100 });
  if (error) return res.status(500).json({ error: error.message });
  res.json({
    users: data.map(u => ({
      id: u.id, email: u.email, name: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
      phone: u.phone || '', role: u.role, city: u.city || '',
      createdAt: u.created_at, lastSignInAt: u.last_sign_in_at,
    })),
  });
});

// ---------- Shops ----------
router.get('/shops', async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc('admin_list_shops');
  if (error) return res.status(500).json({ error: error.message });
  res.json({
    shops: data.map(s => ({
      id: s.id, name: s.name, slug: s.slug, category: s.category, city: s.city,
      ownerName: s.owner_name, ownerEmail: s.owner_email,
      products: Number(s.products), orders: Number(s.orders), paidTotal: Number(s.paid_total),
      payoutReady: !!s.payout_ready, createdAt: s.created_at,
    })),
  });
});

// ============================================================
// PRICING (markup + commission)
// ============================================================
// Both numbers are validated here on the server — the page's own checks are only for friendliness.
const pct = (v, max) => {
  if (typeof v !== 'number' && typeof v !== 'string') return null; // null / missing / true / [] must NOT silently become 0
  if (typeof v === 'string' && !/^\d{1,3}(\.\d{1,2})?$/.test(v.trim())) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : null;
};

router.get('/settings', async (req, res) => {
  const settings = await pricing.getSettings({ fresh: true });
  const { data: earn } = await supabaseAdmin.rpc('admin_earnings');
  res.json({ settings, earnings: earn || { markup: 0, commission: 0 } });
});

router.put('/settings', async (req, res) => {
  const b = req.body || {};
  const markup = pct(b.markupPercent, 50), commission = pct(b.commissionPercent, 30);
  if (markup === null) return res.status(400).json({ error: 'Markup must be a number from 0 to 50.' });
  if (commission === null) return res.status(400).json({ error: 'Commission must be a number from 0 to 30.' });
  const before = await pricing.getSettings({ fresh: true });
  const { error } = await supabaseAdmin.from('platform_settings').upsert({
    id: 1, markup_percent: markup, commission_percent: commission, updated_at: new Date().toISOString(), updated_by: req.user.id,
  }, { onConflict: 'id' });
  if (error) { console.error('[admin] settings save', error.message); return res.status(500).json({ error: 'Could not save the settings.' }); }
  pricing.clearCache();
  const { error: aErr } = await supabaseAdmin.from('admin_audit').insert({
    admin_id: req.user.id, action: 'pricing_changed',
    detail: `markup ${before.markupPercent}% → ${markup}%, commission ${before.commissionPercent}% → ${commission}%`,
  });
  if (aErr) console.error('[admin] audit log failed for settings change', aErr.message);
  res.json({ settings: await pricing.getSettings({ fresh: true }) });
});

// ---------- Orders ----------
const ORDER_COLS = 'id, tracking_id, status, payment_status, payment_method, payout_status, disputed, total, markup_amount, commission_amount, payout_amount, delivery_type, created_at, shop_id, buyer_id, phone';

async function namesFor(orders) {
  const shopIds = [...new Set(orders.map(o => o.shop_id).filter(Boolean))];
  const buyerIds = [...new Set(orders.map(o => o.buyer_id).filter(Boolean))];
  const [{ data: shops }, { data: buyers }] = await Promise.all([
    shopIds.length ? supabaseAdmin.from('shops').select('id, name').in('id', shopIds) : { data: [] },
    buyerIds.length ? supabaseAdmin.from('profiles').select('id, first_name, last_name').in('id', buyerIds) : { data: [] },
  ]);
  return {
    shopName: id => { const s = (shops || []).find(x => x.id === id); return s ? s.name : null; },
    buyerName: id => { const b = (buyers || []).find(x => x.id === id); return b ? `${b.first_name} ${b.last_name}`.trim() : 'Guest'; },
  };
}

const orderRow = (o, n) => ({
  id: o.id, trackingId: o.tracking_id || null, status: o.status,
  paymentStatus: o.payment_status, paymentMethod: o.payment_method, payoutStatus: o.payout_status,
  disputed: !!o.disputed, total: Number(o.total), commission: o.commission_amount != null ? Number(o.commission_amount) : null,
  payout: o.payout_amount != null ? Number(o.payout_amount) : null, markup: Number(o.markup_amount || 0),
  createdAt: o.created_at, shopName: n.shopName(o.shop_id), buyerName: n.buyerName(o.buyer_id),
});

// ?status= &payment= &disputed=1 &q=(order number or tracking ID)
router.get('/orders', async (req, res) => {
  let query = supabaseAdmin.from('orders').select(ORDER_COLS).order('id', { ascending: false }).limit(100);

  if (['pending', 'processing', 'delivered', 'cancelled'].includes(req.query.status)) query = query.eq('status', req.query.status);
  if (['unpaid', 'paid', 'refunded', 'failed'].includes(req.query.payment)) query = query.eq('payment_status', req.query.payment);
  if (req.query.disputed === '1') query = query.eq('disputed', true);

  const q = String(req.query.q || '').trim();
  if (q) {
    const asNumber = Number(q.replace(/^#?(AUR-)?/i, ''));
    const tid = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (tid.length === 11 && tid.startsWith('AUR')) query = query.eq('tracking_id', `AUR-${tid.slice(3, 7)}-${tid.slice(7)}`);
    else if (Number.isInteger(asNumber) && asNumber > 0) query = query.eq('id', asNumber);
    else return res.json({ orders: [] }); // nothing else is searchable here
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  const n = await namesFor(data);
  res.json({ orders: data.map(o => orderRow(o, n)) });
});

// One order in full. Admins may see the address and phone (needed to settle problems).
router.get('/orders/:orderId', async (req, res) => {
  const orderId = orderIdOf(req);
  if (!orderId) return res.status(400).json({ error: 'Bad order id.' });
  const { data: o, error } = await supabaseAdmin.from('orders').select('*').eq('id', orderId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!o) return res.status(404).json({ error: 'Order not found.' });

  const n = await namesFor([o]);
  let buyerEmail = null;
  if (o.buyer_id) {
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(o.buyer_id);
    buyerEmail = u && u.user ? u.user.email : null;
  }
  const { data: audit } = await supabaseAdmin.from('admin_audit')
    .select('id, action, detail, created_at').eq('order_id', orderId).order('id', { ascending: false }).limit(20);

  res.json({
    order: {
      ...orderRow(o, n),
      subtotal: Number(o.subtotal), deliveryFee: Number(o.delivery_fee), deliveryType: o.delivery_type,
      address: o.address, city: o.city, area: o.area, phone: o.phone, note: o.note,
      buyerEmail, paystackReference: o.paystack_reference || null,
      paidAt: o.paid_at, deliveredAt: o.delivered_at, releasedAt: o.released_at,
      items: (o.items || []).map(i => ({ name: i.name, qty: i.qty, price: Number(i.price) || 0, size: i.size || '', emoji: i.emoji || '' })),
    },
    audit: (audit || []).map(a => ({ id: a.id, action: a.action, detail: a.detail, createdAt: a.created_at })),
  });
});

// ---------- Disputes ----------
router.get('/disputes', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('orders').select(ORDER_COLS)
    .eq('disputed', true).neq('payout_status', 'released').order('id', { ascending: false }).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  const n = await namesFor(data);
  res.json({ orders: data.map(o => orderRow(o, n)) });
});

// action 'dismiss'  -> the complaint is rejected; the normal payout schedule resumes.
// action 'refunded' -> you have refunded the buyer in the Paystack dashboard;
//                      this only RECORDS it and stops the seller's payout.
// This route never moves money by itself.
router.post('/orders/:orderId/resolve-dispute', async (req, res) => {
  const orderId = orderIdOf(req);
  if (!orderId) return res.status(400).json({ error: 'Bad order id.' });
  const action = req.body && req.body.action;
  if (!['dismiss', 'refunded'].includes(action)) return res.status(400).json({ error: 'Action must be dismiss or refunded.' });
  const note = String((req.body && req.body.note) || '').trim().slice(0, 300);

  const { data: o, error } = await supabaseAdmin.from('orders').select('id, disputed, payment_status, payout_status').eq('id', orderId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  if (!o.disputed) return res.status(400).json({ error: 'This order is not under dispute.' });
  if (o.payout_status === 'released') return res.status(400).json({ error: 'The seller has already been paid for this order, so it cannot be changed here.' });
  if (action === 'refunded' && o.payment_status !== 'paid') return res.status(400).json({ error: 'Only a paid order can be marked refunded.' });

  const changes = action === 'dismiss'
    ? { disputed: false }
    : { disputed: false, payment_status: 'refunded', payout_status: 'not_ready' };

  // The extra .eq filters make this safe even if two admins click at once,
  // or the payout cron runs between our check and this update.
  const { data: updated, error: uErr } = await supabaseAdmin.from('orders').update(changes)
    .eq('id', orderId).eq('disputed', true).neq('payout_status', 'released').select('id').maybeSingle();
  if (uErr) return res.status(500).json({ error: uErr.message });
  if (!updated) return res.status(409).json({ error: 'This order changed while you were looking at it. Reload and check again.' });

  const { error: aErr } = await supabaseAdmin.from('admin_audit')
    .insert({ admin_id: req.user.id, action: action === 'dismiss' ? 'dispute_dismissed' : 'dispute_refunded', order_id: orderId, detail: note });
  if (aErr) console.error('[admin] audit log failed for order', orderId, aErr.message); // the change itself already succeeded
  res.json({ ok: true });
});

// ---------- Recent admin actions ----------
router.get('/audit', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('admin_audit')
    .select('id, admin_id, action, order_id, detail, created_at').order('id', { ascending: false }).limit(30);
  if (error) return res.status(500).json({ error: error.message });
  const ids = [...new Set(data.map(a => a.admin_id))];
  const { data: admins } = ids.length ? await supabaseAdmin.from('profiles').select('id, first_name, last_name').in('id', ids) : { data: [] };
  res.json({
    audit: data.map(a => {
      const p = (admins || []).find(x => x.id === a.admin_id);
      return { id: a.id, action: a.action, orderId: a.order_id, detail: a.detail, createdAt: a.created_at, adminName: p ? `${p.first_name} ${p.last_name}`.trim() : 'Admin' };
    }),
  });
});

module.exports = router;
