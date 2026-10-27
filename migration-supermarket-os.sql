-- ============================================================
-- Aurora — Supermarket OS subscriptions
-- Run ONCE in the Supabase SQL Editor (safe to re-run).
-- ============================================================

-- 1) Admin-controlled settings (one row). Prices are in naira.
create table if not exists public.os_settings (
  id             int primary key default 1 check (id = 1),
  enabled        boolean not null default true,
  monthly_price  numeric not null default 5000,
  yearly_price   numeric not null default 50000,
  bank_name      text not null default '',
  account_number text not null default '',
  account_name   text not null default '',
  download_url   text not null default '',
  app_version    text not null default '1.0.0',
  updated_at     timestamptz not null default now()
);
insert into public.os_settings (id) values (1) on conflict (id) do nothing;
alter table public.os_settings enable row level security;   -- no policies: only the server can read/write

-- 2) Every purchase / renewal. One row per payment.
create table if not exists public.os_orders (
  id             bigserial primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  business_name  text not null,
  plan           text not null check (plan in ('monthly','yearly')),
  kind           text not null default 'new' check (kind in ('new','renewal','grant')),
  amount         numeric not null default 0,
  reference      text not null unique,
  status         text not null default 'awaiting_proof'
                 check (status in ('awaiting_proof','proof_submitted','confirmed','rejected','cancelled')),
  proof_path     text,
  proof_hash     text,
  proof_uploaded_at timestamptz,
  reject_reason  text,
  confirmed_at   timestamptz,
  confirmed_by   uuid references public.profiles(id),
  period_start   timestamptz,
  period_end     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists os_orders_user_idx on public.os_orders(user_id, created_at desc);
create index if not exists os_orders_status_idx on public.os_orders(status);
alter table public.os_orders enable row level security;

-- 3) The current license of each customer (one row per customer).
create table if not exists public.os_licenses (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  business_name text not null,
  plan          text not null check (plan in ('monthly','yearly')),
  status        text not null default 'active' check (status in ('active','revoked')),
  started_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  token         text not null,
  reminders     jsonb not null default '{}'::jsonb,   -- which warnings were already sent
  updated_at    timestamptz not null default now()
);
create index if not exists os_licenses_exp_idx on public.os_licenses(expires_at);
alter table public.os_licenses enable row level security;

-- Payment receipts reuse the private 'payment-proofs' bucket (already created by migration-transfer.sql).
insert into storage.buckets (id, name, public) values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do update set public = false;

-- Supermarket directory: subscriber can choose to be listed (safe to re-run)
alter table public.os_licenses add column if not exists listed boolean not null default true;
