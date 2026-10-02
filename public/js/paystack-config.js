// Paystack dashboard → Settings → API Keys & Webhooks → "Public Key"
// This is safe to put in frontend code — it can only open a checkout
// popup, not authorize a transfer or refund. Use pk_test_... while
// developing, switch to pk_live_... only when ready for real payments.
const PAYSTACK_PUBLIC_KEY = "pk_test_9941b550718f2222c9d16c4d3b07bb3b929063e7";