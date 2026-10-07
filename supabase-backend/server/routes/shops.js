const express = require('express');
const supabaseAdmin = require('../supabaseAdmin');
const { requireAuth } = require('../auth');
const { upload, uploadToSupabase, deleteFromSupabase } = require('../uploads');
const { cleanShopPatch } = require('../shopSettings');
const { safeSearch, safeSlug, str } = require('../security');

const router = express.Router();

function slugify(name) { return safeSlug(name); }

// DB rows are snake_case; the frontend expects the same camelCase shape the
// old JSON-file version used, so we translate at the boundary and leave the
// rest of the frontend untouched.
function shopOut(row, productCount = 0, orderCount = 0) {
  if (!row) return null;
  return {
    id: row.id,
    owner_id: row.owner_id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    description: row.description,
    color: row.color,
    city: row.city,
    area: row.area,
    address: row.address,
    phone: row.phone,
    openDays: row.open_days,
    openTime: row.open_time,
    closeTime: row.close_time,
    deliveryHome: row.delivery_home,
    deliveryPickup: row.delivery_pickup,
    payOnDelivery: row.pay_on_delivery,
    emoji: row.emoji,
    tagline: row.tagline || '',
    socials: row.socials || {},
    logoUrl: row.logo_url || null,
    bannerUrl: row.banner_url || null,
    rating: row.rating,
    reviewCount: row.review_count,
    created_at: row.created_at,
    productCount,
    orderCount,
  };
}

async function withComputed(row) {
  const [{ count: productCount }, { count: orderCount }] = await Promise.all([
    supabaseAdmin.from('products').select('id', { count: 'exact', head: true }).eq('shop_id', row.id),
    supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }).eq('shop_id', row.id),
  ]);
  return shopOut(row, productCount || 0, orderCount || 0);
}

router.get('/', async (req, res) => {
  // User text NEVER goes straight into a filter string (PostgREST filter injection).
  const q = safeSearch(req.query.q);
  const category = safeSearch(req.query.category);
  let query = supabaseAdmin.from('shops').select('*').order('created_at', { ascending: false });
  if (category && category.toLowerCase() !== 'all') query = query.ilike('category', `%${category}%`);
  if (q) query = query.or(`name.ilike.%${q}%,category.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  const shops = await Promise.all(data.map(withComputed));
  res.json({ shops });
});

router.get('/mine', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin.from('shops').select('*').eq('owner_id', req.user.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.json({ shop: null });
  res.json({ shop: await withComputed(data) });
});

router.get('/:idOrSlug', async (req, res) => {
  const key = req.params.idOrSlug;
  const isNumeric = /^\d+$/.test(key);
  const query = supabaseAdmin.from('shops').select('*');
  const { data, error } = isNumeric
    ? await query.eq('id', Number(key)).maybeSingle()
    : await query.eq('slug', key).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Shop not found.' });
  res.json({ shop: await withComputed(data) });
});

router.post('/', requireAuth, async (req, res) => {
  const { data: existing } = await supabaseAdmin.from('shops').select('*').eq('owner_id', req.user.id).maybeSingle();
  if (existing) return res.status(409).json({ error: 'You already have a shop.', shop: await withComputed(existing) });

  const b = req.body || {};
  const { openDays, openTime, closeTime, deliveryHome, deliveryPickup, payOnDelivery } = b;
  const name = str(b.name, 60), category = str(b.category, 60), description = str(b.description, 1000);
  const color = /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : '';
  const city = str(b.city, 60), area = str(b.area, 80), address = str(b.address, 200), phone = str(b.phone, 20);

  if (!name || !category) {
    return res.status(400).json({ error: 'Shop name and category are required.' });
  }

  let slug = slugify(name);
  let unique = slug, n = 1;
  while (true) {
    const { data: taken } = await supabaseAdmin.from('shops').select('id').eq('slug', unique).maybeSingle();
    if (!taken) break;
    unique = `${slug}-${++n}`;
  }

  const { data: shop, error } = await supabaseAdmin.from('shops').insert({
    owner_id: req.user.id,
    name,
    slug: unique,
    category,
    description: description || '',
    color: color || '#00ffb3',
    city: city || '',
    area: area || '',
    address: address || '',
    phone: phone || '',
    open_days: Array.isArray(openDays) ? openDays.filter(d => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].includes(d)) : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    open_time: /^\d{2}:\d{2}$/.test(openTime || '') ? openTime : '09:00',
    close_time: /^\d{2}:\d{2}$/.test(closeTime || '') ? closeTime : '21:00',
    delivery_home: !!deliveryHome,
    delivery_pickup: !!deliveryPickup,
    pay_on_delivery: !!payOnDelivery,
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  if (req.user.role !== 'seller') {
    await supabaseAdmin.from('profiles').update({ role: 'seller' }).eq('id', req.user.id);
  }

  res.json({ shop: await withComputed(shop) });
});

// Shop owner only. Everything is checked by cleanShopPatch (lengths, colours, times, social links...)
// before it reaches the database, and the shop's slug/owner/rating/bank fields can never be set here.
async function ownShop(req, res) {
  const { data: shop } = await supabaseAdmin.from('shops').select('*').eq('id', Number(req.params.id)).maybeSingle();
  if (!shop) { res.status(404).json({ error: 'Shop not found.' }); return null; }
  if (shop.owner_id !== req.user.id) { res.status(403).json({ error: 'Not your shop.' }); return null; }
  return shop;
}

router.patch('/:id', requireAuth, async (req, res) => {
  const shop = await ownShop(req, res); if (!shop) return;
  const { patch, error: bad } = cleanShopPatch(req.body);
  if (bad) return res.status(400).json({ error: bad });
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change.' });

  const { data: updated, error } = await supabaseAdmin.from('shops').update(patch).eq('id', shop.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ shop: await withComputed(updated) });
});

// Logo and banner: POST /shops/:id/logo | /banner (multipart "image"), DELETE to remove.
const IMAGE_COL = { logo: 'logo_url', banner: 'banner_url' };
for (const kind of Object.keys(IMAGE_COL)) {
  const col = IMAGE_COL[kind];
  router.post(`/:id/${kind}`, requireAuth, (req, res, next) => {
    upload.single('image')(req, res, err => (err ? res.status(400).json({ error: err.message }) : next()));
  }, async (req, res) => {
    const shop = await ownShop(req, res); if (!shop) return;
    if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
    let uploaded;
    try { uploaded = await uploadToSupabase(req.file); } catch (err) { return res.status(500).json({ error: err.message }); }
    const { data: updated, error } = await supabaseAdmin.from('shops').update({ [col]: uploaded.url }).eq('id', shop.id).select().single();
    if (error) { deleteFromSupabase(uploaded.url); return res.status(500).json({ error: error.message }); }
    if (shop[col]) deleteFromSupabase(shop[col]); // replace = remove the old file
    res.json({ shop: await withComputed(updated) });
  });
  router.delete(`/:id/${kind}`, requireAuth, async (req, res) => {
    const shop = await ownShop(req, res); if (!shop) return;
    const { data: updated, error } = await supabaseAdmin.from('shops').update({ [col]: null }).eq('id', shop.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    if (shop[col]) deleteFromSupabase(shop[col]);
    res.json({ shop: await withComputed(updated) });
  });
}

module.exports = router;
