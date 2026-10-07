// Central security helpers. Each one exists because of a specific attack —
// see LEARN.md for the story behind every function.

// ── Lesson 2: filter injection ────────────────────────────────────────────
// PostgREST's .or('a.ilike.%X%,b.ilike.%X%') takes ONE string that it parses
// itself: commas separate conditions, dots separate field/operator/value and
// parentheses group. If X contains those characters the attacker is no longer
// supplying a value — they are supplying query STRUCTURE.
// Fix: allow-list. Keep only letters/numbers/space/hyphen/apostrophe, cap length.
function safeSearch(input, max = 60) {
  if (typeof input !== 'string') return '';           // ?q[]=a&q[]=b gives an array
  return input
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} '\-]/gu, ' ')               // drops , . ( ) % * \ " : etc
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// ── Lesson 1: vanity links ────────────────────────────────────────────────
// /starmart is routed to the shop page, so a shop must never be able to claim
// a slug that is also one of our own pages or system paths.
const RESERVED_SLUGS = new Set([
  'index','buyer','seller','auth','admin','api','checkout','track','settings','create-shop',
  'reset-password','login','logout','register','signup','signin','terms','privacy','refund',
  'help','support','about','contact','shop','shops','products','product','orders','order',
  'cart','account','profile','static','public','css','js','assets','images','img','sw',
  'www','mail','app','dashboard','aurora','root','status','blog','docs','null','undefined',
]);
function safeSlug(name) {
  let s = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40)
    .replace(/-$/, '');
  if (!s) s = 'my-store';
  if (RESERVED_SLUGS.has(s)) s = `${s}-shop`;
  return s;
}

// ── Lesson 3: don't leak internals ────────────────────────────────────────
// Raw database errors reveal table names, column names and constraint names —
// a free map of your schema for an attacker. Log in full, answer generically.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error('[error]', req.method, req.path, err && err.stack || err);
  if (res.headersSent) return;
  const status = err && (err.status || err.statusCode);
  if (status === 400 && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  if (status === 413) return res.status(413).json({ error: 'Request too large.' });
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}
// Wrap res.json so any {error: <db message>} on a 5xx becomes generic.
function maskServerErrors(req, res, next) {
  const orig = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500 && body && typeof body === 'object' && body.error) {
      console.error('[5xx]', req.method, req.originalUrl.split('?')[0], body.error);
      body = { ...body, error: 'Something went wrong. Please try again.' };
    }
    return orig(body);
  };
  next();
}

// ── Lesson 4: brute-force / abuse limits ──────────────────────────────────
// Per-serverless-instance memory: a speed bump, not a wall (each Vercel
// instance has its own counter). Real protection = Supabase's own auth rate
// limits + a shared store (Upstash/Redis) later.
function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now(), k = key(req);
    let h = hits.get(k);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(k, h); }
    if (++h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    if (hits.size > 5000) for (const [kk, v] of hits) if (v.reset < now) hits.delete(kk);
    next();
  };
}

// Strings only, trimmed, capped. Anything else becomes ''.
function str(v, max = 200) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }

module.exports = { safeSearch, safeSlug, RESERVED_SLUGS, errorHandler, maskServerErrors, rateLimit, str };
