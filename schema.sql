-- Tables for optional group sharing. Run this once in your own Supabase project (SQL Editor).
-- It stores the shared plan and each person's latest map position, keyed by a long random group code.

create table if not exists disney_plan (
  slug text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists disney_pos (
  slug text not null,
  person text not null,
  lat double precision not null,
  lon double precision not null,
  acc double precision,
  updated_at timestamptz not null default now(),
  primary key (slug, person)
);

alter table disney_plan enable row level security;
alter table disney_pos enable row level security;

-- The app sends the group code in an "x-group" header on every request. A row can only be read or written
-- when the request carries that row's group code, so the publishable key alone cannot list or change other groups.
-- Keep the group code private (the invite link carries it) and delete the project after the trip.
-- Already ran an older version of this file? Run this whole file again; it replaces the old open policies.
drop policy if exists "plan read" on disney_plan;
drop policy if exists "plan write" on disney_plan;
drop policy if exists "plan update" on disney_plan;
create policy "plan read" on disney_plan for select
  using (slug = coalesce(current_setting('request.headers', true)::json ->> 'x-group', ''));
create policy "plan write" on disney_plan for insert
  with check (length(slug) >= 8 and slug = coalesce(current_setting('request.headers', true)::json ->> 'x-group', ''));
create policy "plan update" on disney_plan for update
  using (slug = coalesce(current_setting('request.headers', true)::json ->> 'x-group', ''))
  with check (slug = coalesce(current_setting('request.headers', true)::json ->> 'x-group', ''));

drop policy if exists "pos read" on disney_pos;
drop policy if exists "pos write" on disney_pos;
drop policy if exists "pos update" on disney_pos;
create policy "pos read" on disney_pos for select
  using (slug = coalesce(current_setting('request.headers', true)::json ->> 'x-group', ''));
create policy "pos write" on disney_pos for insert
  with check (length(slug) >= 8 and slug = coalesce(current_setting('request.headers', true)::json ->> 'x-group', ''));
create policy "pos update" on disney_pos for update
  using (slug = coalesce(current_setting('request.headers', true)::json ->> 'x-group', ''))
  with check (slug = coalesce(current_setting('request.headers', true)::json ->> 'x-group', ''));
