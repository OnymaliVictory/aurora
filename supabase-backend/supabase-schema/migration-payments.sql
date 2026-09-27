-- ============================================================
-- Aurora — Payments migration (Paystack escrow flow)
-- Run this once in your Supabase SQL Editor, AFTER schema.sql.
-- Adds: seller payout bank details on shops, and payment/escrow
-- tracking columns on orders. Safe to re-run.
-- ============================================================

-- ---------- Seller payout account (on shops) ----------
alter table public.shops
  add column if not exists bank_code text,
  add column if not exists bank_name text,
  add column if not exists account_number text,
  add column if not exists account_name text,
  add column if not exists paystack_recipient_code text;

-- ---------- Payment + escrow tracking (on orders) ----------
alter table public.orders
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','paid','refunded','failed')),
  add column if not exists payout_status text not null default 'not_ready'
    check (payout_status in ('not_ready','pending','released','failed')),
  add column if not exists paystack_reference text,
  add column if not exists commission_amount numeric,
  add column if not exists payout_amount numeric,
  add column if not exists delivered_at timestamptz,
  add column if not exists disputed boolean not null default false,
  add column if not exists paid_at timestamptz,
  add column if not exists released_at timestamptz;

create index if not exists orders_payout_status_idx on public.orders(payout_status);
create index if not exists orders_paystack_reference_idx on public.orders(paystack_reference);

-- ============================================================
-- No RLS policy changes needed here: payment_status, payout_status, and
-- the other new columns are only ever written by the server using the
-- service-role key, which bypasses Row Level Security entirely. The
-- existing orders_update_seller policy (from schema.sql) still correctly
-- restricts who can update an order at all.
-- ============================================================