// Paystack dashboard → Settings → API Keys & Webhooks → "Public Key"
// This is safe to put in frontend code — it can only open a checkout
// popup, not authorize a transfer or refund. Use pk_test_... while
// developing, switch to pk_live_... only when ready for real payments.
const PAYSTACK_PUBLIC_KEY = "pk_test_replace_with_your_real_test_key";