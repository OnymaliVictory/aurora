// Quick checks for the Aurora OS subscription code.   Run:  node scripts/test-os.js
const assert = require('assert');
const crypto = require('crypto');
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
process.env.OS_LICENSE_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
const lic = require('../supabase-backend/server/license');

assert(lic.ready(), 'signing key should load');
const t = lic.issue({ userId: 'abcdef12-0000', business: 'Test', plan: 'monthly', expiresAt: new Date('2027-03-15T10:00:00Z'), startedAt: new Date('2027-02-15') });
const p = lic.verify(t, pubRaw);
assert(p && p.exp === '2027-03-15' && p.plan === 'monthly', 'valid key verifies');
const bad = t.split('.'); bad[1] = bad[1].slice(0, -2) + 'AA';
assert(!lic.verify(bad.join('.'), pubRaw), 'tampered key is rejected');
const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
assert(!lic.verify(t, other), 'wrong public key is rejected');
assert.strictEqual(lic.addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString().slice(0, 10), '2026-02-28', 'month-end rolls to the last day');
assert.strictEqual(lic.addMonths(new Date('2026-10-24T00:00:00Z'), 12).toISOString().slice(0, 10), '2027-10-24', 'a year is a year');

const core = require('../supabase-backend/server/osCore');
const now = new Date('2026-10-24T12:00:00Z');
const row = d => ({ business_name: 'x', plan: 'yearly', status: 'active', expires_at: d, token: 'k', started_at: d });
assert.strictEqual(core.describe(row('2026-11-30T00:00:00Z'), now).state, 'active');
assert.strictEqual(core.describe(row('2026-10-31T00:00:00Z'), now).state, 'expiring');
assert.strictEqual(core.describe(row('2026-10-31T00:00:00Z'), now).daysLeft, 7);
assert.strictEqual(core.describe(row('2026-10-24T00:00:00Z'), now).daysLeft, 0);
assert.strictEqual(core.describe(row('2026-10-23T00:00:00Z'), now).state, 'expired');
assert.strictEqual(core.describe({ ...row('2026-12-30'), status: 'revoked' }, now).key, null);
console.log('os subscription checks passed');
