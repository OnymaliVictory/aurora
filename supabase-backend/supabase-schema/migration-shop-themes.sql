-- ============================================================
-- Aurora — shop templates (Christmas, Halloween, ...)
-- Run ONCE in the Supabase SQL Editor (safe to re-run).
-- ============================================================
alter table public.shops
  add column if not exists theme text not null default 'classic';

-- Only known template names can be stored.
alter table public.shops drop constraint if exists shops_theme_check;
alter table public.shops add constraint shops_theme_check
  check (theme in ('classic','christmas','halloween','valentine','newyear','eid','blackfriday','naija','spring'));
