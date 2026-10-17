# Bank transfer payments (pay the shop, upload receipt, seller confirms)

## 1. Database (once) — Supabase → SQL Editor → paste supabase-backend/supabase-schema/migration-transfer.sql → Run
Creates a private table for shop transfer accounts, the new order columns, a safety trigger
(manual-transfer orders can never be paid out through Paystack), and a PRIVATE storage bucket "payment-proofs".

## 2. Code — copy these files over the same paths in your repo
public/: checkout.html, buyer.html, seller.html, transfer.html (new), receipt.html (new), js/receipt-scan.js (new), js/seller-transfers.js (new)
api/index.js, vercel.json
supabase-backend/server/: transfer.js (new), routes/transfers.js (new), orderCreation.js, orderNotify.js, index.js, security.js
(vercel.json: if you changed it yourself, only add the 3 CSP changes: 'wasm-unsafe-eval' in script-src, https://cdn.jsdelivr.net in connect-src, worker-src 'self' blob:.)

Then:  git add .  &&  git commit -m "Bank transfer payments with receipt check"  &&  git push

## 3. Before your first real order
- Each seller: Seller dashboard → Earnings → "Bank Transfer Account" → save bank + account number + name.
  (A shop without it cannot be paid by transfer; buyers get a clear message.)
- Buyer: Checkout → "Bank Transfer to the Shop".

## Things to know
- Direct transfers have NO Aurora markup and NO commission, and Aurora does not hold the money (no escrow/refund protection).
- The receipt scan only HELPS; the seller must tick "I can see ₦X in my account" before confirming.
- Unpaid transfer orders keep their stock reserved until cancelled (no auto-expiry yet).
