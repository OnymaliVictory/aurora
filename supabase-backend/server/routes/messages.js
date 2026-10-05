const express = require('express');
const supabaseAdmin = require('../supabaseAdmin');
const { requireAuth } = require('../auth');
const orderNotify = require('../orderNotify');

const router = express.Router();

router.get('/thread/:shopId', requireAuth, async (req, res) => {
  const shopId = Number(req.params.shopId);
  const { data: shop } = await supabaseAdmin.from('shops').select('id, owner_id').eq('id', shopId).maybeSingle();
  if (!shop) return res.status(404).json({ error: 'Shop not found.' });

  const buyerId = shop.owner_id === req.user.id ? req.query.buyerId : req.user.id;
  if (!buyerId) return res.status(400).json({ error: 'buyerId is required.' });

  const { data, error } = await supabaseAdmin.from('messages').select('*').eq('shop_id', shopId).eq('buyer_id', buyerId).order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ messages: data });
});

router.get('/conversations', requireAuth, async (req, res) => {
  const { data: myShop } = await supabaseAdmin.from('shops').select('id').eq('owner_id', req.user.id).maybeSingle();

  if (myShop) {
    const { data: msgs, error } = await supabaseAdmin.from('messages').select('*').eq('shop_id', myShop.id).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    const seen = new Set();
    const latest = msgs.filter(m => { if (seen.has(m.buyer_id)) return false; seen.add(m.buyer_id); return true; });
    const buyerIds = latest.map(m => m.buyer_id);
    const { data: buyers } = buyerIds.length ? await supabaseAdmin.from('profiles').select('id, first_name, last_name').in('id', buyerIds) : { data: [] };
    const conversations = latest.map(m => {
      const b = buyers.find(x => x.id === m.buyer_id);
      return { buyerId: m.buyer_id, buyerName: b ? `${b.first_name} ${b.last_name}` : 'Buyer', lastMessage: m.body, lastAt: m.created_at };
    });
    return res.json({ conversations, role: 'seller' });
  }

  const { data: msgs, error } = await supabaseAdmin.from('messages').select('*').eq('buyer_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const seen = new Set();
  const latest = msgs.filter(m => { if (seen.has(m.shop_id)) return false; seen.add(m.shop_id); return true; });
  const shopIds = latest.map(m => m.shop_id);
  const { data: shops } = shopIds.length ? await supabaseAdmin.from('shops').select('id, name').in('id', shopIds) : { data: [] };
  const conversations = latest.map(m => {
    const s = shops.find(x => x.id === m.shop_id);
    return { shopId: m.shop_id, shopName: s ? s.name : 'Shop', lastMessage: m.body, lastAt: m.created_at };
  });
  res.json({ conversations, role: 'buyer' });
});

router.post('/thread/:shopId', requireAuth, async (req, res) => {
  const shopId = Number(req.params.shopId);
  const { data: shop } = await supabaseAdmin.from('shops').select('id, owner_id, name').eq('id', shopId).maybeSingle();
  if (!shop) return res.status(404).json({ error: 'Shop not found.' });

  const { body, buyerId } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'Message cannot be empty.' });

  const isOwner = shop.owner_id === req.user.id;
  const resolvedBuyerId = isOwner ? buyerId : req.user.id;
  if (isOwner && !resolvedBuyerId) return res.status(400).json({ error: 'buyerId is required when replying as the shop.' });

  const { data: message, error } = await supabaseAdmin.from('messages').insert({
    shop_id: shopId,
    buyer_id: resolvedBuyerId,
    sender: isOwner ? 'seller' : 'buyer',
    sender_id: req.user.id,
    body: body.trim(),
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  await orderNotify.directMessage({ shop, fromSeller: isOwner, buyerId: resolvedBuyerId, text: body.trim() });
  res.json({ message });
});

module.exports = router;
