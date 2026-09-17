const express = require('express');
const supabaseAdmin = require('../supabaseAdmin');
const { requireAuth } = require('../auth');
const { upload, uploadToSupabase, deleteFromSupabase } = require('../uploads');

const router = express.Router();

function productOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    shop_id: row.shop_id,
    name: row.name,
    price: Number(row.price),
    stock: row.stock,
    sold: row.sold,
    category: row.category,
    description: row.description,
    emoji: row.emoji,
    imageUrl: row.image_url,
    sizes: row.sizes || [],
    created_at: row.created_at,
  };
}

function parseSizes(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) return raw.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

async function shopOwnedBy(shopId, userId) {
  const { data } = await supabaseAdmin.from('shops').select('id,owner_id').eq('id', shopId).maybeSingle();
  return data && data.owner_id === userId ? data : null;
}

router.get('/shop/:shopId', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('products').select('*').eq('shop_id', Number(req.params.shopId)).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ products: data.map(productOut) });
});

// Create a product. Accepts multipart/form-data with an optional 'image'
// file, or plain JSON with no image — either works.
router.post('/shop/:shopId', requireAuth, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  const shopId = Number(req.params.shopId);
  const shop = await shopOwnedBy(shopId, req.user.id);
  if (!shop) return res.status(403).json({ error: 'Not your shop.' });

  const { name, price, stock, category, description, emoji, sizes } = req.body || {};
  const numPrice = Number(price);
  if (!name || !numPrice || numPrice <= 0) {
    return res.status(400).json({ error: 'Product name and a valid price are required.' });
  }

  let imageUrl = null;
  if (req.file) {
    try {
      const uploaded = await uploadToSupabase(req.file);
      imageUrl = uploaded.url;
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const { data: product, error } = await supabaseAdmin.from('products').insert({
    shop_id: shopId,
    name: String(name).trim(),
    price: numPrice,
    stock: Number(stock) || 0,
    category: category || 'Other',
    description: description || '',
    emoji: emoji || '📦',
    image_url: imageUrl,
    sizes: parseSizes(sizes),
  }).select().single();

  if (error) { if (imageUrl) deleteFromSupabase(imageUrl); return res.status(500).json({ error: error.message }); }
  res.json({ product: productOut(product) });
});

router.post('/:id/image', requireAuth, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  const { data: product } = await supabaseAdmin.from('products').select('*').eq('id', Number(req.params.id)).maybeSingle();
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  const shop = await shopOwnedBy(product.shop_id, req.user.id);
  if (!shop) return res.status(403).json({ error: 'Not your product.' });
  if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });

  let uploaded;
  try {
    uploaded = await uploadToSupabase(req.file);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const { data: updated, error } = await supabaseAdmin.from('products').update({ image_url: uploaded.url }).eq('id', product.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (product.image_url) deleteFromSupabase(product.image_url);
  res.json({ product: productOut(updated) });
});

router.delete('/:id/image', requireAuth, async (req, res) => {
  const { data: product } = await supabaseAdmin.from('products').select('*').eq('id', Number(req.params.id)).maybeSingle();
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  const shop = await shopOwnedBy(product.shop_id, req.user.id);
  if (!shop) return res.status(403).json({ error: 'Not your product.' });

  const { data: updated, error } = await supabaseAdmin.from('products').update({ image_url: null }).eq('id', product.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (product.image_url) deleteFromSupabase(product.image_url);
  res.json({ product: productOut(updated) });
});

router.patch('/:id', requireAuth, async (req, res) => {
  const { data: product } = await supabaseAdmin.from('products').select('*').eq('id', Number(req.params.id)).maybeSingle();
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  const shop = await shopOwnedBy(product.shop_id, req.user.id);
  if (!shop) return res.status(403).json({ error: 'Not your product.' });

  const map = { name: 'name', price: 'price', stock: 'stock', category: 'category', description: 'description', emoji: 'emoji', sizes: 'sizes' };
  const patch = {};
  Object.entries(map).forEach(([camel, col]) => { if (camel in (req.body || {})) patch[col] = req.body[camel]; });

  const { data: updated, error } = await supabaseAdmin.from('products').update(patch).eq('id', product.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ product: productOut(updated) });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const { data: product } = await supabaseAdmin.from('products').select('*').eq('id', Number(req.params.id)).maybeSingle();
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  const shop = await shopOwnedBy(product.shop_id, req.user.id);
  if (!shop) return res.status(403).json({ error: 'Not your product.' });

  const { error } = await supabaseAdmin.from('products').delete().eq('id', product.id);
  if (error) return res.status(500).json({ error: error.message });
  if (product.image_url) deleteFromSupabase(product.image_url);
  res.json({ ok: true });
});

module.exports = router;
