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

-- ---------------------------------------------------------------------------------------------
-- FEEDBACK TABLE (only for the person who makes the planner; families do not need this).
-- Run in the project whose address is in config.js under "feedback". The app can add notes but never read them.
create table if not exists planner_feedback (
  id uuid primary key default gen_random_uuid(),
  message text not null check (length(message) between 1 and 2000),
  email text check (email is null or length(email) <= 200),
  screen text check (screen is null or length(screen) <= 40),
  app_version text check (app_version is null or length(app_version) <= 40),
  user_agent text check (user_agent is null or length(user_agent) <= 300),
  created_at timestamptz not null default now()
);
alter table planner_feedback enable row level security;
drop policy if exists "feedback add" on planner_feedback;
create policy "feedback add" on planner_feedback for insert to anon, authenticated with check (true);
revoke all on planner_feedback from anon, authenticated;
grant insert on planner_feedback to anon, authenticated;
