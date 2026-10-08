// Admin-controlled pricing. Two separate levers (both set in Admin → Pricing):
//   markup_percent     — added ON TOP of the seller's price; the buyer pays it, Aurora keeps it.
//   commission_percent — taken OUT of what the seller receives.
// products.price in the database is ALWAYS the seller's own price.
const supabaseAdmin = require('./supabaseAdmin');

const DEFAULTS = { markupPercent: 0, commissionPercent: 5 };
let cache = null, cacheAt = 0;
const TTL_MS = 15_000; // short, so an admin change shows up quickly even across serverless instances

async function getSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cacheAt < TTL_MS) return cache;
  try {
    const { data } = await supabaseAdmin.from('platform_settings').select('*').eq('id', 1).maybeSingle();
    if (data) cache = { markupPercent: Number(data.markup_percent), commissionPercent: Number(data.commission_percent), updatedAt: data.updated_at };
    else cache = { ...DEFAULTS };
  } catch (e) { cache = cache || { ...DEFAULTS }; }
  cacheAt = Date.now();
  return cache;
}
function clearCache() { cache = null; cacheAt = 0; }

// Whole naira, rounded UP so Aurora never loses a fraction. ₦13,000 at 3.5% → ₦13,455.
function buyerPrice(base, markupPercent) {
  const b = Number(base) || 0;
  if (!markupPercent) return b;
  return Math.ceil(b * (1 + markupPercent / 100) - 1e-9);
}
const round2 = n => Math.round(n * 100) / 100;

module.exports = { getSettings, clearCache, buyerPrice, round2, DEFAULTS };
