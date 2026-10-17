-- ============================================================
-- Aurora — Manual bank transfer payments
-- Run ONCE in the Supabase SQL Editor (safe to re-run).
-- ============================================================

-- 1) Each shop's account that buyers transfer to.
--    Kept in its OWN table with Row Level Security ON and NO policies:
--    that means nobody using the public/anon key can ever read it.
--    Only your server (service role) can, and it only shows the details
--    to the buyer of an order, the shop owner, and admins.
create table if not exists public.shop_transfer_accounts (
  shop_id        bigint primary key references public.shops(id) on delete cascade,
  bank_name      text not null,
  account_number text not null check (account_number ~ '^[0-9]{10}$'),
  account_name   text not null,
  updated_at     timestamptz not null default now()
);
alter table public.shop_transfer_accounts enable row level security;

-- 2) Transfer fields on orders.
alter table public.orders
  add column if not exists transfer_reference   text unique,
  add column if not exists transfer_status      text
    check (transfer_status in ('awaiting_proof','proof_submitted','confirmed','rejected')),
  add column if not exists proof_path           text,
  add column if not exists proof_hash           text,
  add column if not exists proof_uploaded_at    timestamptz,
  add column if not exists proof_count          int not null default 0,
  add column if not exists transfer_confirmed_at timestamptz,
  add column if not exists transfer_reject_reason text;

create index if not exists orders_proof_hash_idx on public.orders(proof_hash);
create index if not exists orders_transfer_status_idx on public.orders(transfer_status);

-- 3) SAFETY: an order paid by manual transfer already put the money in the
--    seller's own account, so Aurora must never also "pay it out" through
--    Paystack. This trigger forces payout_status to stay 'not_ready'.
create or replace function public.guard_manual_payout()
returns trigger language plpgsql as $$
begin
  if new.payment_method = 'manual' then
    new.payout_status := 'not_ready';
  end if;
  return new;
end $$;

drop trigger if exists guard_manual_payout on public.orders;
create trigger guard_manual_payout
  before insert or update on public.orders
  for each row execute function public.guard_manual_payout();

-- 4) Private storage bucket for payment receipts (screenshots).
--    public = false  ->  there is no public link; the server hands out
--    short-lived signed links to the buyer, the seller and admins only.
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do update set public = false;
