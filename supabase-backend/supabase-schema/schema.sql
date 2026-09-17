-- ============================================================
-- Aurora — Supabase schema
-- Run this whole file once in your Supabase project's SQL Editor:
-- Dashboard → SQL Editor → New query → paste this → Run.
-- Safe to re-run: it drops and recreates Aurora's own objects only.
-- ============================================================

-- ---------- PROFILES ----------
-- Extra account info Supabase Auth doesn't store itself (name, role, etc).
-- One row per auth user, created automatically on signup (see trigger below).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  phone text not null default '',
  role text not null default 'buyer' check (role in ('buyer','seller')),
  city text not null default '',
  area text not null default '',
  created_at timestamptz not null default now()
);

-- ---------- SHOPS ----------
create table if not exists public.shops (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  slug text not null unique,
  category text not null,
  description text not null default '',
  color text not null default '#00ffb3',
  city text not null default '',
  area text not null default '',
  address text not null default '',
  phone text not null default '',
  open_days text[] not null default array['Mon','Tue','Wed','Thu','Fri','Sat'],
  open_time text not null default '09:00',
  close_time text not null default '21:00',
  delivery_home boolean not null default false,
  delivery_pickup boolean not null default false,
  pay_on_delivery boolean not null default false,
  emoji text not null default '🏪',
  rating numeric,
  review_count int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists shops_one_per_owner on public.shops(owner_id);
create index if not exists shops_category_idx on public.shops(category);

-- ---------- PRODUCTS ----------
create table if not exists public.products (
  id bigint generated always as identity primary key,
  shop_id bigint not null references public.shops(id) on delete cascade,
  name text not null,
  price numeric not null check (price > 0),
  stock int not null default 0,
  sold int not null default 0,
  category text not null default 'Other',
  description text not null default '',
  emoji text not null default '📦',
  image_url text,
  sizes text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists products_shop_id_idx on public.products(shop_id);

-- ---------- ORDERS ----------
create table if not exists public.orders (
  id bigint generated always as identity primary key,
  buyer_id uuid not null references public.profiles(id),
  shop_id bigint not null references public.shops(id),
  status text not null default 'pending' check (status in ('pending','processing','delivered','cancelled')),
  delivery_type text not null default 'standard',
  delivery_fee numeric not null default 0,
  subtotal numeric not null default 0,
  total numeric not null default 0,
  address text not null default '',
  city text not null default '',
  area text not null default '',
  phone text not null default '',
  payment_method text not null default 'card',
  note text not null default '',
  items jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists orders_buyer_id_idx on public.orders(buyer_id);
create index if not exists orders_shop_id_idx on public.orders(shop_id);

-- ---------- MESSAGES ----------
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  shop_id bigint not null references public.shops(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id),
  sender text not null check (sender in ('buyer','seller')),
  sender_id uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_shop_buyer_idx on public.messages(shop_id, buyer_id);

-- ============================================================
-- Auto-create a profile row whenever someone signs up via Supabase Auth.
-- Reads first_name/last_name/phone/role out of the signUp() "options.data"
-- you pass from the frontend.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', ''),
    coalesce(new.raw_user_meta_data->>'last_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'role', 'buyer')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- Row Level Security
-- The Node backend uses your service-role key, which bypasses RLS —
-- these policies are what protects the data if anything ever queries
-- Supabase directly from the browser with the public anon key.
-- ============================================================
alter table public.profiles enable row level security;
alter table public.shops enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.messages enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select
  to authenticated using (true); -- name/role visible to logged-in users (needed to show buyer/seller names)

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update
  to authenticated using (auth.uid() = id);

drop policy if exists "shops_select_public" on public.shops;
create policy "shops_select_public" on public.shops for select
  to anon, authenticated using (true);

drop policy if exists "shops_insert_own" on public.shops;
create policy "shops_insert_own" on public.shops for insert
  to authenticated with check (auth.uid() = owner_id);

drop policy if exists "shops_update_own" on public.shops;
create policy "shops_update_own" on public.shops for update
  to authenticated using (auth.uid() = owner_id);

drop policy if exists "products_select_public" on public.products;
create policy "products_select_public" on public.products for select
  to anon, authenticated using (true);

drop policy if exists "products_write_own_shop" on public.products;
create policy "products_write_own_shop" on public.products for all
  to authenticated
  using (exists (select 1 from public.shops where shops.id = products.shop_id and shops.owner_id = auth.uid()))
  with check (exists (select 1 from public.shops where shops.id = products.shop_id and shops.owner_id = auth.uid()));

drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders for select
  to authenticated using (
    auth.uid() = buyer_id
    or exists (select 1 from public.shops where shops.id = orders.shop_id and shops.owner_id = auth.uid())
  );

drop policy if exists "orders_insert_own" on public.orders;
create policy "orders_insert_own" on public.orders for insert
  to authenticated with check (auth.uid() = buyer_id);

drop policy if exists "orders_update_seller" on public.orders;
create policy "orders_update_seller" on public.orders for update
  to authenticated using (exists (select 1 from public.shops where shops.id = orders.shop_id and shops.owner_id = auth.uid()));

drop policy if exists "messages_select_participant" on public.messages;
create policy "messages_select_participant" on public.messages for select
  to authenticated using (
    auth.uid() = buyer_id
    or exists (select 1 from public.shops where shops.id = messages.shop_id and shops.owner_id = auth.uid())
  );

drop policy if exists "messages_insert_participant" on public.messages;
create policy "messages_insert_participant" on public.messages for insert
  to authenticated with check (
    auth.uid() = buyer_id
    or exists (select 1 from public.shops where shops.id = messages.shop_id and shops.owner_id = auth.uid())
  );

-- ============================================================
-- Storage bucket for product photos
-- ============================================================
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

drop policy if exists "product_images_public_read" on storage.objects;
create policy "product_images_public_read" on storage.objects for select
  to anon, authenticated using (bucket_id = 'product-images');

drop policy if exists "product_images_authenticated_write" on storage.objects;
create policy "product_images_authenticated_write" on storage.objects for insert
  to authenticated with check (bucket_id = 'product-images');

drop policy if exists "product_images_authenticated_update" on storage.objects;
create policy "product_images_authenticated_update" on storage.objects for update
  to authenticated using (bucket_id = 'product-images');

drop policy if exists "product_images_authenticated_delete" on storage.objects;
create policy "product_images_authenticated_delete" on storage.objects for delete
  to authenticated using (bucket_id = 'product-images');
