// ============================================================
// Aurora notifications — ONE function other files call:
//
//   await notify(userId, { kind, title, body, url, dedupeKey, emailKind })
//
// It (1) puts a line in the user's in-app inbox (the bell),
//    (2) pops a notification on their devices (Web Push), and
//    (3) emails them — each only if it's set up and the user allows it.
// It NEVER throws: a notification problem must not break the real action
// (sending a message, placing an order...).
// ============================================================
const supabaseAdmin = require('./supabaseAdmin');

const APP_URL = () => (process.env.APP_URL || 'https://aurora-wheat-seven.vercel.app').replace(/\/$/, '');
const EMAIL_WINDOW_MS = 15 * 60 * 1000; // at most one email per conversation per 15 min
const PUSH_WINDOW_MS = 2 * 60 * 1000;   // at most one pop-up per conversation per 2 min
const SEND_TIMEOUT_MS = 6000;

// ---------- tiny helpers ----------
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const absUrl = u => (!u ? APP_URL() + '/' : /^https?:/i.test(u) ? u : APP_URL() + '/' + String(u).replace(/^\//, ''));
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// ---------- email (Resend) ----------
const emailReady = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

function emailHtml({ title, body, url }) {
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#111">
  <div style="font-size:20px;font-weight:700;color:#0d9488">✦ AURORA</div>
  <h2 style="margin:18px 0 8px">${esc(title)}</h2>
  <p style="font-size:15px;line-height:1.5;color:#333;white-space:pre-line">${esc(body)}</p>
  ${url ? `<p style="margin:22px 0"><a href="${esc(absUrl(url))}" style="background:#0d9488;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">Open on Aurora</a></p>` : ''}
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="font-size:12px;color:#888">You get this because of your Aurora account. <a href="${esc(APP_URL())}/index.html?notif=1" style="color:#888">Manage notifications</a></p>
</div>`;
}

// messages = [{ to, subject, html, text }]; sends in batches of 100
async function sendEmails(messages) {
  if (!emailReady() || !messages.length) return { sent: 0, skipped: messages.length };
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100).map(m => ({ from: process.env.EMAIL_FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text }));
    try {
      const r = await withTimeout(fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      }), SEND_TIMEOUT_MS);
      if (r.ok) sent += batch.length;
      else console.error('[notify] email provider said', r.status, (await r.text()).slice(0, 200));
    } catch (err) { console.error('[notify] email failed:', err.message); }
  }
  return { sent };
}

// ---------- device push (Web Push) ----------
let _webpush;
function webpush() {
  if (_webpush !== undefined) return _webpush;
  try {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) { _webpush = null; return null; }
    _webpush = require('web-push');
    _webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:support@aurora.example', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  } catch (err) { console.error('[notify] web-push unavailable:', err.message); _webpush = null; }
  return _webpush;
}
const pushReady = () => !!webpush();

async function pushToUsers(userIds, payload) {
  const wp = webpush();
  if (!wp || !userIds.length) return 0;
  const { data: subs } = await supabaseAdmin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', userIds);
  let ok = 0; const dead = [];
  await Promise.all((subs || []).map(async s => {
    try {
      await withTimeout(wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 86400 }), SEND_TIMEOUT_MS);
      ok++;
    } catch (err) {
      // 404/410 = the device unsubscribed or the browser data was cleared. Forget it.
      if (err && (err.statusCode === 404 || err.statusCode === 410)) dead.push(s.id);
      else console.error('[notify] push failed:', err && (err.statusCode || err.message));
    }
  }));
  if (dead.length) await supabaseAdmin.from('push_subscriptions').delete().in('id', dead);
  return ok;
}

// ---------- who is this person, and what do they allow? ----------
async function emailOf(userId) {
  try { const { data } = await supabaseAdmin.auth.admin.getUserById(userId); return data && data.user ? data.user.email : null; }
  catch { return null; }
}
async function prefsOf(userId) {
  const { data } = await supabaseAdmin.from('notification_prefs').select('*').eq('user_id', userId).maybeSingle();
  return { email_messages: true, email_products: true, email_reminders: true, ...(data || {}) };
}
const EMAIL_PREF = { chat: 'email_messages', order: 'email_messages', support: 'email_messages', new_product: 'email_products', cart: 'email_reminders', digest: 'email_reminders' };

// ============================================================
// notify(userId, { kind, title, body, url, dedupeKey })
// ============================================================
async function notify(userId, n) {
  try {
    if (!userId) return;
    const title = clip(n.title, 120), body = clip(n.body, 300), url = n.url || '';
    const now = Date.now();

    // 1) in-app inbox — collapse into an unread one with the same key
    let row = null, existing = null;
    if (n.dedupeKey) {
      const { data } = await supabaseAdmin.from('notifications').select('*')
        .eq('user_id', userId).eq('dedupe_key', n.dedupeKey).is('read_at', null).maybeSingle();
      existing = data || null;
    }
    if (existing) {
      const { data } = await supabaseAdmin.from('notifications')
        .update({ title, body, url, created_at: new Date(now).toISOString() }).eq('id', existing.id).select().maybeSingle();
      row = data || existing;
    } else {
      const { data } = await supabaseAdmin.from('notifications')
        .insert({ user_id: userId, kind: n.kind, title, body, url, dedupe_key: n.dedupeKey || null }).select().maybeSingle();
      row = data;
    }
    const age = t => (t ? now - new Date(t).getTime() : Infinity);

    // 2) device pop-up (throttled per conversation)
    const stamps = {};
    if (pushReady() && age(existing && existing.pushed_at) > PUSH_WINDOW_MS) {
      const delivered = await pushToUsers([userId], { title, body, url: url || 'index.html', tag: n.dedupeKey || n.kind });
      if (delivered) stamps.pushed_at = new Date().toISOString();
    }

    // 3) email (throttled per conversation, and only if the user allows it)
    if (emailReady() && age(existing && existing.emailed_at) > EMAIL_WINDOW_MS) {
      const prefs = await prefsOf(userId);
      if (prefs[EMAIL_PREF[n.kind] || 'email_messages'] !== false) {
        const to = await emailOf(userId);
        if (to) {
          const r = await sendEmails([{ to, subject: title, html: emailHtml({ title, body, url }), text: `${title}\n\n${body}\n\n${absUrl(url)}` }]);
          if (r.sent) stamps.emailed_at = new Date().toISOString();
        }
      }
    }
    if (row && Object.keys(stamps).length) await supabaseAdmin.from('notifications').update(stamps).eq('id', row.id);
  } catch (err) { console.error('[notify] failed:', err && err.message); }
}

// Many recipients at once (new product -> every follower). Same rules, done in bulk.
async function notifyMany(userIds, n) {
  try {
    userIds = [...new Set(userIds || [])];
    if (!userIds.length) return { users: 0 };
    const title = clip(n.title, 120), body = clip(n.body, 300), url = n.url || '';
    const nowIso = new Date().toISOString();

    // inbox: update unread duplicates, insert the rest
    let dup = [];
    if (n.dedupeKey) {
      const { data } = await supabaseAdmin.from('notifications').select('id, user_id')
        .eq('dedupe_key', n.dedupeKey).is('read_at', null).in('user_id', userIds);
      dup = data || [];
      if (dup.length) await supabaseAdmin.from('notifications').update({ title, body, url, created_at: nowIso }).in('id', dup.map(d => d.id));
    }
    const have = new Set(dup.map(d => d.user_id));
    const fresh = userIds.filter(u => !have.has(u));
    if (fresh.length) await supabaseAdmin.from('notifications').insert(fresh.map(u => ({ user_id: u, kind: n.kind, title, body, url, dedupe_key: n.dedupeKey || null })));

    // device pop-ups
    if (pushReady()) await pushToUsers(userIds, { title, body, url: url || 'index.html', tag: n.dedupeKey || n.kind });

    // emails: only those who allow it, and only users who did not just get one for this key
    if (emailReady()) {
      const prefKey = EMAIL_PREF[n.kind] || 'email_messages';
      const { data: off } = await supabaseAdmin.from('notification_prefs').select('user_id').eq(prefKey, false).in('user_id', userIds);
      const blocked = new Set((off || []).map(o => o.user_id));
      const recent = new Set();
      if (n.dedupeKey) {
        const since = new Date(Date.now() - EMAIL_WINDOW_MS).toISOString();
        const { data: r } = await supabaseAdmin.from('notifications').select('user_id, emailed_at').eq('dedupe_key', n.dedupeKey).in('user_id', userIds);
        (r || []).forEach(x => { if (x.emailed_at && x.emailed_at > since) recent.add(x.user_id); });
      }
      const msgs = [];
      for (const u of userIds) {
        if (blocked.has(u) || recent.has(u)) continue;
        const to = await emailOf(u);
        if (to) msgs.push({ to, userId: u, subject: title, html: emailHtml({ title, body, url }), text: `${title}\n\n${body}\n\n${absUrl(url)}` });
      }
      const r = await sendEmails(msgs);
      if (r.sent && n.dedupeKey) await supabaseAdmin.from('notifications').update({ emailed_at: nowIso }).eq('dedupe_key', n.dedupeKey).is('read_at', null).in('user_id', msgs.map(m => m.userId));
    }
    return { users: userIds.length };
  } catch (err) { console.error('[notify] bulk failed:', err && err.message); return { users: 0 }; }
}

// Everyone with the admin role (for new support tickets).
async function adminIds() {
  const { data } = await supabaseAdmin.from('profiles').select('id').eq('role', 'admin');
  return (data || []).map(a => a.id);
}

module.exports = { notify, notifyMany, adminIds, sendEmails, emailHtml, pushReady, emailReady, absUrl, esc, clip };
