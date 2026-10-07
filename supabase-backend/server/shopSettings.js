// Checks and cleans what a seller sends when they edit their shop / what a user sends
// when they edit their account. Nothing from the browser is saved without passing here.

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const PHONE = /^[0-9+()\-\s]{5,30}$/;

// ---------- social links ----------
// Each platform: which hostnames are acceptable, and how to turn a plain @handle into a link.
const PLATFORMS = {
  instagram: { hosts: ['instagram.com'], handle: /^@?([A-Za-z0-9._]{1,30})$/, build: h => `https://instagram.com/${h}` },
  tiktok:    { hosts: ['tiktok.com'], handle: /^@?([A-Za-z0-9._]{1,24})$/, build: h => `https://tiktok.com/@${h}` },
  facebook:  { hosts: ['facebook.com', 'fb.com', 'fb.me'], handle: /^@?([A-Za-z0-9.]{5,50})$/, build: h => `https://facebook.com/${h}` },
  x:         { hosts: ['x.com', 'twitter.com'], handle: /^@?([A-Za-z0-9_]{1,15})$/, build: h => `https://x.com/${h}` },
  youtube:   { hosts: ['youtube.com', 'youtu.be'], handle: /^@([A-Za-z0-9._-]{3,30})$/, build: h => `https://youtube.com/@${h}` },
  whatsapp:  { hosts: ['wa.me', 'api.whatsapp.com'] },
  website:   { hosts: null },
};

const hostOf = u => u.hostname.toLowerCase().replace(/^www\./, '');
const hostAllowed = (host, list) => list.some(d => host === d || host.endsWith('.' + d));

function parseUrl(raw) {
  let s = String(raw).trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;       // "mysite.com" -> https://mysite.com
  let u; try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null; // blocks javascript:, data:, etc.
  if (u.username || u.password) return null;
  if (!u.hostname.includes('.')) return null;
  return u;
}

// Returns the cleaned https link, '' for "remove it", or null when it is not valid for that platform.
function normalizeSocial(platform, input) {
  const p = PLATFORMS[platform];
  if (!p) return null;
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return '';
  if (raw.length > 200) return null;

  if (platform === 'whatsapp') {
    const u = /^(https?:)?\/\//i.test(raw) || /wa\.me/i.test(raw) ? parseUrl(raw) : null;
    let digits = u ? (hostAllowed(hostOf(u), p.hosts) ? (u.pathname.replace(/\D/g, '') || u.searchParams.get('phone') || '') : '') : raw.replace(/[^\d]/g, '');
    digits = String(digits).replace(/\D/g, '');
    if (!u && /^0\d{10}$/.test(digits)) digits = '234' + digits.slice(1); // 0803... -> 234803...
    return digits.length >= 8 && digits.length <= 15 ? `https://wa.me/${digits}` : null;
  }
  if (platform === 'website') {
    const u = parseUrl(raw);
    return u ? `https://${hostOf(u)}${u.pathname === '/' ? '' : u.pathname.slice(0, 100)}` : null;
  }
  // handle form: "@name" or "name"
  const h = p.handle.exec(raw);
  if (h) return p.build(h[1]);
  const u = parseUrl(raw);
  if (!u || !hostAllowed(hostOf(u), p.hosts)) return null;
  const path = u.pathname.replace(/\/+$/, '').slice(0, 100);
  return `https://${hostOf(u)}${path}`;
}

function cleanSocials(input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return { error: 'Social links must be an object.' };
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (!PLATFORMS[k]) continue; // unknown platforms are ignored, never stored
    const link = normalizeSocial(k, v);
    if (link === null) return { error: `That ${k === 'x' ? 'X (Twitter)' : k} link doesn't look right. Use your @handle or the full link.` };
    if (link) out[k] = link;
  }
  return { value: out };
}

// ---------- shop ----------
const str = (v, max) => (typeof v === 'string' ? v.trim() : null) && String(v).trim().length <= max ? String(v).trim() : null;

function cleanShopPatch(body) {
  const b = body || {}; const patch = {};
  const bad = msg => ({ error: msg });

  const text = (key, col, max, { required = false, min = 0 } = {}) => {
    if (!(key in b)) return null;
    if (typeof b[key] !== 'string') return bad(`${key} must be text.`);
    const v = b[key].trim();
    if (required && !v) return bad(`${key} cannot be empty.`);
    if (v.length < min) return bad(`${key} is too short.`);
    if (v.length > max) return bad(`${key} is too long (max ${max} characters).`);
    patch[col] = v; return null;
  };
  let e;
  for (const args of [['name', 'name', 60, { required: true, min: 2 }], ['tagline', 'tagline', 100], ['description', 'description', 1000],
    ['category', 'category', 40, { required: true }], ['city', 'city', 60], ['area', 'area', 60], ['address', 'address', 200], ['emoji', 'emoji', 8]]) {
    if ((e = text(...args))) return e;
  }
  if ('phone' in b) { if (typeof b.phone !== 'string' || (b.phone.trim() && !PHONE.test(b.phone.trim()))) return bad('That phone number does not look right.'); patch.phone = b.phone.trim(); }
  if ('color' in b) { if (typeof b.color !== 'string' || !HEX.test(b.color)) return bad('Colour must look like #00ffb3.'); patch.color = b.color.toLowerCase(); }
  if ('openDays' in b) { if (!Array.isArray(b.openDays) || b.openDays.some(d => !DAYS.includes(d))) return bad('Choose valid opening days.'); patch.open_days = [...new Set(b.openDays)]; }
  for (const k of ['openTime', 'closeTime']) if (k in b) { if (typeof b[k] !== 'string' || !TIME.test(b[k])) return bad('Times must look like 09:00.'); patch[k === 'openTime' ? 'open_time' : 'close_time'] = b[k]; }
  for (const [k, col] of [['deliveryHome', 'delivery_home'], ['deliveryPickup', 'delivery_pickup'], ['payOnDelivery', 'pay_on_delivery']]) {
    if (k in b) { if (typeof b[k] !== 'boolean') return bad(`${k} must be true or false.`); patch[col] = b[k]; }
  }
  if ('socials' in b) { const s = cleanSocials(b.socials); if (s.error) return s; patch.socials = s.value; }
  return { patch };
}

// ---------- account ----------
function cleanProfilePatch(body) {
  const b = body || {}; const patch = {};
  const field = (key, col, max, required) => {
    if (!(key in b)) return null;
    if (typeof b[key] !== 'string') return { error: `${key} must be text.` };
    const v = b[key].trim();
    if (required && !v) return { error: `${key === 'firstName' ? 'First' : 'Last'} name cannot be empty.` };
    if (v.length > max) return { error: `${key} is too long.` };
    patch[col] = v; return null;
  };
  let e;
  for (const a of [['firstName', 'first_name', 40, true], ['lastName', 'last_name', 40, true], ['city', 'city', 60, false], ['area', 'area', 60, false]]) if ((e = field(...a))) return e;
  if ('phone' in b) { if (typeof b.phone !== 'string' || (b.phone.trim() && !PHONE.test(b.phone.trim()))) return { error: 'That phone number does not look right.' }; patch.phone = b.phone.trim(); }
  return { patch };
}

module.exports = { cleanShopPatch, cleanProfilePatch, cleanSocials, normalizeSocial, PLATFORMS };
