const crypto = require('crypto');

const BASE = 'https://api.paystack.co';
const SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

if (!SECRET_KEY) {
  console.warn(
    '⚠️  PAYSTACK_SECRET_KEY is missing.\n' +
    '   Copy .env.example to .env and fill it in from your Paystack dashboard\n' +
    '   (Settings → API Keys & Webhooks). Payment routes will fail until this is set.'
  );
}

async function paystackRequest(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) {
    throw new Error(data.message || `Paystack request failed (${res.status})`);
  }
  return data.data;
}

// ---------- Payments ----------

// Starts a checkout — returns an authorization_url / access_code the
// frontend uses to open the Paystack popup. Amount is in kobo (Naira x100).
function initializeTransaction({ email, amountKobo, reference, metadata }) {
  return paystackRequest('POST', '/transaction/initialize', {
    email,
    amount: amountKobo,
    reference,
    metadata,
  });
}

// Server-side truth check — never trust the frontend's "payment succeeded"
// callback alone. Call this (or rely on the webhook) before marking an
// order paid.
function verifyTransaction(reference) {
  return paystackRequest('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
}

// Confirms a webhook payload actually came from Paystack, not a spoofed
// request — Paystack signs every webhook with your secret key.
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const hash = crypto.createHmac('sha512', SECRET_KEY).update(rawBody).digest('hex');
  return hash === signatureHeader;
}

// ---------- Seller payouts ----------

function listBanks() {
  return paystackRequest('GET', '/bank?country=nigeria&currency=NGN');
}

// Confirms an account number actually belongs to the name on file before
// we ever save it or send money to it.
function resolveAccountNumber(accountNumber, bankCode) {
  return paystackRequest('GET', `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
}

function createTransferRecipient({ name, accountNumber, bankCode }) {
  return paystackRequest('POST', '/transferrecipient', {
    type: 'nuban',
    name,
    account_number: accountNumber,
    bank_code: bankCode,
    currency: 'NGN',
  });
}

// Actually moves money to a seller. amountKobo = their payout (order total
// minus commission), already computed by the caller.
function initiateTransfer({ recipientCode, amountKobo, reason, reference }) {
  return paystackRequest('POST', '/transfer', {
    source: 'balance',
    amount: amountKobo,
    recipient: recipientCode,
    reason,
    reference,
  });
}

module.exports = {
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature,
  listBanks,
  resolveAccountNumber,
  createTransferRecipient,
  initiateTransfer,
};