const express = require('express');
const supabaseAdmin = require('../supabaseAdmin');
const { requireAuth } = require('../auth');

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

module.exports = router;