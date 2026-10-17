// Small, pure helpers for manual bank-transfer payments (no database in here, so they are easy to test).
const crypto = require('crypto');

// No I, L, O, 0 or 1 — nothing that can be misread when typed into a bank app.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function pick(n) {
  const bytes = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

// What the buyer types into the transfer "narration / remark" box. Short on purpose (banks cut long remarks).
const newReference = () => 'AU' + pick(6);
// Same shape the tracking page already understands: AUR-XXXX-XXXX
const newTrackingId = () => `AUR-${pick(4)}-${pick(4)}`;

// ---- seller's receiving account ----
function cleanAccount(body) {
  const b = body || {};
  const bank = typeof b.bankName === 'string' ? b.bankName.trim() : '';
  const number = typeof b.accountNumber === 'string' || typeof b.accountNumber === 'number' ? String(b.accountNumber).replace(/\s+/g, '') : '';
  const name = typeof b.accountName === 'string' ? b.accountName.trim().replace(/\s+/g, ' ') : '';
  if (bank.length < 2 || bank.length > 60) return { error: 'Enter the bank name (for example GTBank, Access, Opay).' };
  if (!/^\d{10}$/.test(number)) return { error: 'Account number must be exactly 10 digits.' };
  if (name.length < 3 || name.length > 80 || !/^[\p{L}][\p{L} .'\-&]*$/u.test(name)) return { error: 'Enter the account name exactly as your bank shows it.' };
  return { value: { bank_name: bank, account_number: number, account_name: name } };
}

// ---- receipt images ----
// Never trust the browser's "this is a PNG" claim — look at the first bytes of the file itself.
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return { ext: 'png', mime: 'image/png' };
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

const maskAccount = n => (n ? '••••••' + String(n).slice(-4) : '');
const receiptNo = id => 'RCP-' + String(id).padStart(6, '0');

module.exports = { newReference, newTrackingId, cleanAccount, sniffImage, sha256, maskAccount, receiptNo, ALPHABET };
