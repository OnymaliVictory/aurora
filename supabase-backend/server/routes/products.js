const express = require('express');
const supabaseAdmin = require('../supabaseAdmin');
const { requireAuth } = require('../auth');
const { upload, uploadToSupabase, deleteFromSupabase } = require('../uploads');
const { notifyMany, clip } = require('../notify');
const { str } = require('../security');
const { getSettings, buyerPrice } = require('../pricing');

const router = express.Router();

// `markup` = percent added for BUYERS. Pass null/undefined for the seller's own view (their real price).
function productOut(row, markup) {
  if (!row) return null;
  const forBuyer = markup !== undefined && markup !== null;
  return {
    id: row.id,
    shop_id: row.shop_id,
    name: row.name,
    price: forBuyer ? buyerPrice(row.price, markup) : Number(row.price),
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
  const { data } = await supabaseAdmin.from('shops').select('id,owner_id,name,slug').eq('id', shopId).maybeSingle();
  return data && data.owner_id === userId ? data : null;
}

// Public: what BUYERS see (seller price + Aurora markup).
router.get('/shop/:shopId', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('products').select('*').eq('shop_id', Number(req.params.shopId)).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const { markupPercent } = await getSettings();
  res.json({ products: data.map(r => productOut(r, markupPercent)) });
});

// Seller only: their own products with THEIR price, plus what buyers will pay.
router.get('/mine/:shopId', requireAuth, async (req, res) => {
  const shop = await shopOwnedBy(Number(req.params.shopId), req.user.id);
  if (!shop) return res.status(403).json({ error: 'Not your shop.' });
  const { data, error } = await supabaseAdmin.from('products').select('*').eq('shop_id', shop.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const { markupPercent } = await getSettings();
  res.json({ products: data.map(r => ({ ...productOut(r), buyerPrice: buyerPrice(r.price, markupPercent) })), markupPercent });
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

  const b = req.body || {};
  const name = str(b.name, 120), category = str(b.category, 60), description = str(b.description, 2000), emoji = str(b.emoji, 8);
  const { price, stock, sizes } = b;
  const numPrice = Number(price);
  if (!name || !Number.isFinite(numPrice) || numPrice <= 0 || numPrice > 1e9) {
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
    name,
    price: numPrice,
    stock: Math.max(0, Math.min(1e6, Math.floor(Number(stock)) || 0)),
    category: category || 'Other',
    description: description || '',
    emoji: emoji || '📦',
    image_url: imageUrl,
    sizes: parseSizes(sizes).map(x => str(x, 20)).filter(Boolean).slice(0, 20),
  }).select().single();

  if (error) { if (imageUrl) deleteFromSupabase(imageUrl); return res.status(500).json({ error: error.message }); }

  // Tell everyone who follows this shop (in-app + device pop-up + email). Never blocks or breaks the upload.
  try {
    const { data: followers } = await supabaseAdmin.from('follows').select('buyer_id').eq('shop_id', shopId).limit(2000);
    if (followers && followers.length) {
      await notifyMany(followers.map(f => f.buyer_id), {
        kind: 'new_product', dedupeKey: `shop:${shopId}:new`, url: `shop.html?slug=${encodeURIComponent(shop.slug)}`,
        title: `${shop.name} just added something new`,
        body: `${clip(product.name, 80)} · ₦${buyerPrice(product.price, (await getSettings()).markupPercent).toLocaleString('en-NG')}`,
      });
    }
  } catch (err) { console.error('[notify] new product:', err.message); }

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

  const patch = {};
  const b = req.body || {};
  if ('name' in b) { patch.name = str(b.name, 120); if (!patch.name) return res.status(400).json({ error: 'Name cannot be empty.' }); }
  if ('price' in b) { const n = Number(b.price); if (!Number.isFinite(n) || n <= 0 || n > 1e9) return res.status(400).json({ error: 'Invalid price.' }); patch.price = n; }
  if ('stock' in b) { const n = Math.floor(Number(b.stock)); if (!Number.isFinite(n) || n < 0 || n > 1e6) return res.status(400).json({ error: 'Invalid stock.' }); patch.stock = n; }
  if ('category' in b) patch.category = str(b.category, 60) || 'Other';
  if ('description' in b) patch.description = str(b.description, 2000);
  if ('emoji' in b) patch.emoji = str(b.emoji, 8) || '📦';
  if ('sizes' in b) patch.sizes = parseSizes(b.sizes).map(x => str(x, 20)).filter(Boolean).slice(0, 20);
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update.' });

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
