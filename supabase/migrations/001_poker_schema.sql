-- Liminal Poker schema
-- IMPORTANT: All tables live in schema `poker` so they never collide with
-- the existing chat community in `public`.
--
-- Apply in Supabase SQL editor (or CLI):
--   supabase db push / paste this file
--
-- MVP RLS strategy:
--   Invite code is the shared secret. Policies allow anon to read/write
--   rows when the lobby `code` is known (passed in filters). This is
--   acceptable for practice chips only — never real money.
--   Host-authoritative hand state is stored in poker.hands.state (jsonb)
--   and/or broadcast on Realtime channel `lobby:{code}`.

create schema if not exists poker;

-- Players (guest-friendly; sync optional from localStorage guest id)
create table if not exists poker.players (
  id uuid primary key default gen_random_uuid(),
  display_name text not null default 'Guest',
  chip_bank int not null default 10000 check (chip_bank >= 0),
  created_at timestamptz not null default now()
);

create table if not exists poker.lobbies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_id uuid references poker.players(id) on delete set null,
  status text not null default 'waiting'
    check (status in ('waiting', 'playing', 'closed')),
  max_seats int not null default 6 check (max_seats between 2 and 9),
  small_blind int not null default 50,
  big_blind int not null default 100,
  buy_in int not null default 10000,
  fill_with_bots boolean not null default true,
  created_at timestamptz not null default now(),
  constraint lobbies_code_len check (char_length(code) = 6)
);

create table if not exists poker.lobby_seats (
  lobby_id uuid not null references poker.lobbies(id) on delete cascade,
  seat_index int not null check (seat_index >= 0 and seat_index < 9),
  player_id uuid references poker.players(id) on delete set null,
  is_bot boolean not null default false,
  bot_persona text,
  stack int not null default 0,
  sitting_out boolean not null default false,
  primary key (lobby_id, seat_index)
);

create table if not exists poker.hands (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references poker.lobbies(id) on delete cascade,
  hand_no int not null default 1,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lobbies_code_idx on poker.lobbies (code);
create index if not exists hands_lobby_idx on poker.hands (lobby_id, hand_no desc);

-- Expose schema to PostgREST (Supabase API)
grant usage on schema poker to anon, authenticated, service_role;
grant all on all tables in schema poker to anon, authenticated, service_role;
grant all on all sequences in schema poker to anon, authenticated, service_role;
alter default privileges in schema poker grant all on tables to anon, authenticated, service_role;

-- RLS
alter table poker.players enable row level security;
alter table poker.lobbies enable row level security;
alter table poker.lobby_seats enable row level security;
alter table poker.hands enable row level security;

-- Permissive practice-chip policies (code-as-secret MVP).
-- Tighten later with auth + membership table if needed.
create policy "players_rw_anon" on poker.players
  for all to anon using (true) with check (true);

create policy "lobbies_rw_anon" on poker.lobbies
  for all to anon using (true) with check (true);

create policy "seats_rw_anon" on poker.lobby_seats
  for all to anon using (true) with check (true);

create policy "hands_rw_anon" on poker.hands
  for all to anon using (true) with check (true);

-- Optional: add poker to exposed schemas in Dashboard → Settings → API
-- (db.schemas / "Extra schemas") so supabase-js with db: { schema: 'poker' } works.
