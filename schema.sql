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

-- The app talks to the database with the publishable key, so these tables are open to anyone who has the key
-- AND asks for a specific group code. Treat the invite link like a password and delete the project after the trip.
drop policy if exists "plan read" on disney_plan;
drop policy if exists "plan write" on disney_plan;
drop policy if exists "plan update" on disney_plan;
create policy "plan read" on disney_plan for select using (true);
create policy "plan write" on disney_plan for insert with check (true);
create policy "plan update" on disney_plan for update using (true) with check (true);

drop policy if exists "pos read" on disney_pos;
drop policy if exists "pos write" on disney_pos;
drop policy if exists "pos update" on disney_pos;
create policy "pos read" on disney_pos for select using (true);
create policy "pos write" on disney_pos for insert with check (true);
create policy "pos update" on disney_pos for update using (true) with check (true);
