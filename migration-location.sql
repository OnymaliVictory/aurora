-- Shop position for "shops near me". Safe to run more than once.
alter table public.shops add column if not exists lat double precision;
alter table public.shops add column if not exists lng double precision;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'shops_lat_range') then
    alter table public.shops add constraint shops_lat_range check (lat is null or (lat between -90 and 90));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shops_lng_range') then
    alter table public.shops add constraint shops_lng_range check (lng is null or (lng between -180 and 180));
  end if;
end $$;
create index if not exists shops_lat_lng_idx on public.shops (lat, lng);
