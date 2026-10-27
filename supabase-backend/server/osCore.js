// Shared logic for Aurora OS subscriptions: settings, licence periods, reminders.
const supabaseAdmin = require('./supabaseAdmin');
const lic = require('./license');
const { notify } = require('./notify');

const DAY = 86400000;
const naira = n => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
const dateOnly = d => new Date(d).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(dateOnly(a)) - Date.parse(dateOnly(b))) / DAY);

async function getSettings() {
  const { data } = await supabaseAdmin.from('os_settings').select('*').eq('id', 1).maybeSingle();
  return data || { enabled: true, monthly_price: 5000, yearly_price: 50000, bank_name: '', account_number: '', account_name: '', download_url: '', app_version: '1.0.0' };
}
const priceOf = (s, plan) => Number(plan === 'yearly' ? s.yearly_price : s.monthly_price);

// What the customer (and the admin table) sees about a licence.
function describe(row, now = new Date()) {
  if (!row) return null;
  const left = daysBetween(row.expires_at, now);           // 0 = last working day
  let state = 'active';
  if (row.status === 'revoked') state = 'revoked';
  else if (left < 0) state = 'expired';
  else if (left <= 7) state = 'expiring';
  return { businessName: row.business_name, plan: row.plan, status: row.status, state, startedAt: row.started_at,
           expiresAt: row.expires_at, daysLeft: left, key: state === 'revoked' ? null : row.token };
}

// Turn a confirmed payment (or an admin grant) into a licence. Renewing early ADDS time to what is left.
async function applyPeriod({ userId, business, plan, orderId, adminId }) {
  const { data: cur } = await supabaseAdmin.from('os_licenses').select('*').eq('user_id', userId).maybeSingle();
  const now = new Date();
  const stillRunning = cur && cur.status === 'active' && new Date(cur.expires_at) > now;
  const start = stillRunning ? new Date(cur.expires_at) : now;
  const end = lic.addMonths(start, lic.PLAN_MONTHS[plan]);
  const token = lic.issue({ userId, business, plan, expiresAt: end, startedAt: cur ? cur.started_at : now });
  const row = { user_id: userId, business_name: business, plan, status: 'active', started_at: cur ? cur.started_at : now.toISOString(),
                expires_at: end.toISOString(), token, reminders: {}, updated_at: now.toISOString() };
  const { error } = await supabaseAdmin.from('os_licenses').upsert(row, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  if (orderId) {
    await supabaseAdmin.from('os_orders').update({
      status: 'confirmed', confirmed_at: now.toISOString(), confirmed_by: adminId || null,
      period_start: start.toISOString(), period_end: end.toISOString(),
    }).eq('id', orderId);
  }
  return { ...row, periodStart: start, periodEnd: end };
}

// Called once a day from the existing daily cron. Counts down through the final week.
async function sendReminders(deadline) {
  const out = { reminded: 0, expiredNotices: 0 };
  const soon = new Date(Date.now() + 8 * DAY).toISOString();
  const ago = new Date(Date.now() - 3 * DAY).toISOString();
  const { data: rows } = await supabaseAdmin.from('os_licenses').select('*')
    .eq('status', 'active').lte('expires_at', soon).gte('expires_at', ago).limit(300);
  const site = '/supermarket.html';
  for (const r of rows || []) {
    if (Date.now() > deadline) break;
    const left = daysBetween(r.expires_at, new Date());
    const key = `${dateOnly(r.expires_at)}:${left}`;
    const sent = r.reminders || {};
    if (sent[key] || left < -1) continue;
    const when = new Date(r.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    let title, body;
    if (left < 0) {
      title = 'Aurora OS is paused';
      body = `Your Aurora OS subscription for ${r.business_name} ended on ${when}, so the app is paused. Your data is safe — renew and enter the new key to carry on.`;
      out.expiredNotices++;
    } else {
      title = left === 0 ? 'Aurora OS ends today' : left === 1 ? 'Aurora OS ends tomorrow' : `Aurora OS ends in ${left} days`;
      body = `Your Aurora OS subscription for ${r.business_name} ends on ${when}. Renew now so your till never stops — extra time is added on top of what you have left.`;
      out.reminded++;
    }
    await notify(r.user_id, { kind: 'os', title, body, url: site, dedupeKey: 'os:renew' });
    sent[key] = true;
    await supabaseAdmin.from('os_licenses').update({ reminders: sent }).eq('user_id', r.user_id);
  }
  return out;
}

module.exports = { getSettings, priceOf, describe, applyPeriod, sendReminders, naira, daysBetween, dateOnly };
