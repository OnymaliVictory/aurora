// Aurora OS licence keys. The website SIGNS a small piece of data (who, which plan, when it ends)
// with a secret key that only the server has. The desktop app holds the matching PUBLIC key and
// can check the signature with no internet. Nobody can make or extend a key without the secret.
//
//   key = AUR1.<payload, base64url>.<signature, base64url>
const crypto = require('crypto');

const b64u = buf => Buffer.from(buf).toString('base64url');

function privateKey() {
  const raw = process.env.OS_LICENSE_PRIVATE_KEY;
  if (!raw) return null;
  try {
    // Accept either the base64 value printed by scripts/make-license-keys.js, or a PEM.
    const text = raw.includes('BEGIN') ? raw.replace(/\\n/g, '\n') : null;
    return text
      ? crypto.createPrivateKey(text)
      : crypto.createPrivateKey({ key: Buffer.from(raw.trim(), 'base64'), format: 'der', type: 'pkcs8' });
  } catch { return null; }
}
const ready = () => !!privateKey();

function issue({ userId, business, plan, expiresAt, startedAt }) {
  const key = privateKey();
  if (!key) throw new Error('Licence signing key is not set on the server (OS_LICENSE_PRIVATE_KEY).');
  const payload = {
    v: 1,
    id: String(userId).slice(0, 8),
    biz: String(business || '').slice(0, 80),
    plan,
    iat: new Date(startedAt || Date.now()).toISOString().slice(0, 10),
    exp: new Date(expiresAt).toISOString().slice(0, 10),   // the LAST day the app works
  };
  const body = Buffer.from(JSON.stringify(payload));
  const sig = crypto.sign(null, body, key);                 // Ed25519
  return `AUR1.${b64u(body)}.${b64u(sig)}`;
}

// Used by tests and by the website to sanity-check a token it just made.
function verify(token, publicKeyB64) {
  const [tag, p, s] = String(token).split('.');
  if (tag !== 'AUR1' || !p || !s) return null;
  const pub = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyB64, 'base64')]),
    format: 'der', type: 'spki',
  });
  const body = Buffer.from(p, 'base64url');
  if (!crypto.verify(null, body, pub, Buffer.from(s, 'base64url'))) return null;
  return JSON.parse(body.toString());
}

// Calendar-correct "add N months": 31 Jan + 1 month = 28/29 Feb, never "3 March".
function addMonths(date, n) {
  const d = new Date(date), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
const PLAN_MONTHS = { monthly: 1, yearly: 12 };

module.exports = { issue, verify, ready, addMonths, PLAN_MONTHS };
