const Module = require('module'); const path = require('path'); const http = require('http');
const W = '/tmp/claude-0/-home-claude/077028a5-d54d-55a6-a938-1eba76a5271d/scratchpad/w/aurora-build/';
const seen = []; // every filter string that would reach PostgREST
const chain = (log) => { const c = { select: () => c, order: () => c, eq: () => c, ilike: (...a) => (log.push(['ilike', ...a]), c), or: (s) => (log.push(['or', s]), c),
  then: (res) => res({ data: [], error: null }), maybeSingle: async () => ({ data: null }), insert: () => c, single: async () => ({ data: { id: 1, slug: 'x' }, error: { message: 'duplicate key value violates unique constraint "shops_slug_key"' } }) }; return c; };
const sb = { from: () => chain(seen) };
const orig = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === '../supabaseAdmin' || req.endsWith('/supabaseAdmin')) return sb;
  if (req === '../auth') return { requireAuth: (rq, rs, n) => { rq.user = { id: 'u1', role: 'seller' }; n(); } };
  if (req === '../uploads') return { upload: { single: () => (a, b, n) => n() }, uploadToSupabase: async () => ({}), deleteFromSupabase() {} };
  if (req === 'express') return orig.call(this, path.join(__dirname, 'node_modules/express'), parent, ...rest);
  return orig.call(this, req, parent, ...rest);
};
const sec = require(W + 'supabase-backend/server/security.js');
const express = require('express'); const app = express(); app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' })); app.use(sec.maskServerErrors);
app.use('/api/shops', require(W + 'supabase-backend/server/routes/shops.js'));
app.get('/boom', (q, r) => r.status(500).json({ error: 'relation "orders" does not exist' }));
app.get('/throw', () => { throw new Error('secret stack'); });
app.use('/lim', sec.rateLimit({ windowMs: 60000, max: 3 })); app.get('/lim', (q, r) => r.json({ ok: 1 }));
app.use(sec.errorHandler);
let ok = true; const check = (n, got, want) => { const p = JSON.stringify(got) === JSON.stringify(want); if (!p) ok = false; console.log(p ? 'PASS' : 'FAIL', n, p ? '' : `\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); };
const srv = app.listen(0, async () => {
  const base = 'http://127.0.0.1:' + srv.address().port;
  const G = (p, m = 'GET', body) => new Promise((res, rej) => { const d = body && JSON.stringify(body); const rq = http.request(base + p, { method: m, headers: { 'Content-Type': 'application/json', ...(d ? { 'Content-Length': Buffer.byteLength(d) } : {}) } }, rs => { let b = ''; rs.on('data', x => b += x); rs.on('end', () => { let j; try { j = JSON.parse(b) } catch { j = b } res([rs.statusCode, j]); }); }); rq.on('error', rej); if (d) rq.write(d); rq.end(); });
  // --- the attack: break out of the ilike value and add our own condition ---
  const evil = "x%,id.gt.0,is_verified.eq.true,name.ilike.%";
  const vulnerable = `name.ilike.%${evil}%,category.ilike.%${evil}%`;
  check('OLD code would hand PostgREST 3+ extra conditions (the bug)', vulnerable.split(',').length > 2, true);
  await G('/api/shops?q=' + encodeURIComponent(evil));
  const orArg = seen.find(s => s[0] === 'or')[1];
  check('NEW: search string contains no commas/dots/parens from the attacker', /[,().*]/.test(orArg.replace(/name\.ilike\.%|,category\.ilike\.%/g, '').replace(/%$/, '')), false);
  check('NEW: exactly 2 conditions', orArg.split(',').length, 2);
  seen.length = 0; await G('/api/shops?category=' + encodeURIComponent("a,b.c)")); 
  check('category sanitised too', seen[0].slice(2), ["%a b c%"]);
  seen.length = 0; await G('/api/shops?q[]=a&q[]=b'); check('array param ignored (no .or at all)', seen.some(s => s[0] === 'or'), false);
  seen.length = 0; await G('/api/shops?q=' + 'a'.repeat(500)); check('no 500-char value reaches the filter', seen[0][1].includes('a'.repeat(61)), false); check('length capped to 60', seen[0][1].length <= 2 * 60 + 'name.ilike.%%,category.ilike.%%'.length - 0, true);
  check('unicode letters kept (Ọlá, Zoë)', sec.safeSearch('Ọlá & Zoë'), 'Ọlá Zoë');
  // --- slugs ---
  check('reserved slug "admin"', sec.safeSlug('Admin'), 'admin-shop');
  check('reserved slug "api"', sec.safeSlug('API'), 'api-shop');
  check('empty/emoji-only name', sec.safeSlug('🔥🔥'), 'my-store');
  check('accents stripped', sec.safeSlug('Café Ọla'), 'cafe-ola');
  check('normal', sec.safeSlug("Star Mart!"), 'star-mart');
  check('long name trimmed, no trailing dash', /^[a-z0-9-]{1,40}$/.test(sec.safeSlug('a '.repeat(60))) && !sec.safeSlug('a '.repeat(60)).endsWith('-'), true);
  // --- error masking ---
  const b = await G('/boom'); check('5xx db message hidden', b[1].error.includes('relation'), false);
  const t = await G('/throw'); check('thrown error generic + 500', [t[0], t[1].error.includes('secret')], [500, false]);
  const bj = await G('/api/shops', 'POST', null); 
  const sres = await G('/api/shops', 'POST', { name: 'Zed', category: 'Other' });
  check('db constraint error not echoed on create', JSON.stringify(sres[1]).includes('shops_slug_key'), false);
  // --- rate limit ---
  const codes = []; for (let i = 0; i < 5; i++) codes.push((await G('/lim'))[0]); check('rate limit 3 then 429', codes, [200, 200, 200, 429, 429]);
  // --- bad JSON ---
  const bad = await new Promise(r => { const q = http.request(base + '/api/shops', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, rs => { let x = ''; rs.on('data', c => x += c); rs.on('end', () => r([rs.statusCode, x])); }); q.write('{bad'); q.end(); });
  check('malformed JSON -> 400 clean', [bad[0], bad[1].includes('SyntaxError')], [400, false]);
  console.log(ok ? '\nALL PASS' : '\nSOME FAILED'); srv.close(); process.exit(ok ? 0 : 1);
});
