-- ============================================================
-- Aurora — Settings + a IMPORTANT security lock-down
-- Run once in the Supabase SQL Editor, AFTER migration-notifications.sql.
-- Safe to re-run.
-- ============================================================

-- ---------- 1. New shop fields: social links, tagline, logo, banner ----------
alter table public.shops
  add column if not exists tagline text not null default '',
  add column if not exists socials jsonb not null default '{}',
  add column if not exists logo_url text,
  add column if not exists banner_url text;

-- The shop's accent colour already exists (shops.color). Make sure it is always #rrggbb.
-- NOT VALID = only checked for new/changed rows, so old rows can never block this migration.
alter table public.shops drop constraint if exists shops_color_hex;
alter table public.shops add constraint shops_color_hex check (color ~* '^#[0-9a-f]{6}$') not valid;

-- ---------- 2. SECURITY: the browser may not touch these tables directly ----------
-- Your website only ever talks to your own API (which uses the service key and checks
-- permissions itself). But Supabase also exposes every table to anyone holding the public
-- "anon" key (it is in your page source), and the old policies allowed things like:
--   * a seller marking their OWN order as paid + delivered, so the payout cron pays them
--   * anyone reading every seller's bank account number straight from the shops table
--   * a seller editing their own shop rating
-- Removing the browser's table permissions closes all of that. The website keeps working
-- because it never queries these tables from the browser. Sign-in/sign-up (Supabase Auth) is unaffected.
do $$
declare t text;
begin
  foreach t in array array['profiles', 'shops', 'products', 'orders', 'messages'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;
