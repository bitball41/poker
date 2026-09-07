-- Secure multiplayer upgrade for Liminal Poker.
-- Requires Supabase Anonymous Sign-Ins to be enabled.
-- Keep schema `poker` exposed through PostgREST, as in migration 001.

alter table poker.lobby_seats
  add column if not exists display_name text not null default 'Player',
  add column if not exists ready boolean not null default false,
  add column if not exists last_seen timestamptz not null default now();

alter table poker.hands
  add column if not exists revision int not null default 0;

create unique index if not exists hands_lobby_hand_uidx
  on poker.hands (lobby_id, hand_no);

create table if not exists poker.hand_public (
  lobby_id uuid primary key references poker.lobbies(id) on delete cascade,
  hand_no int not null,
  revision int not null default 0,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists poker.hole_cards (
  lobby_id uuid not null references poker.lobbies(id) on delete cascade,
  hand_no int not null,
  player_id uuid not null references poker.players(id) on delete cascade,
  cards jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (lobby_id, hand_no, player_id)
);

create table if not exists poker.action_requests (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references poker.lobbies(id) on delete cascade,
  player_id uuid not null default auth.uid() references poker.players(id) on delete cascade,
  hand_no int not null,
  revision int not null,
  action_type text not null check (action_type in ('fold','check','call','bet','raise','all-in')),
  amount int,
  created_at timestamptz not null default now()
);

create index if not exists action_requests_lobby_idx
  on poker.action_requests (lobby_id, created_at);

alter table poker.hand_public enable row level security;
alter table poker.hole_cards enable row level security;
alter table poker.action_requests enable row level security;

-- Remove the intentionally permissive MVP policies from migration 001.
drop policy if exists "players_rw_anon" on poker.players;
drop policy if exists "lobbies_rw_anon" on poker.lobbies;
drop policy if exists "seats_rw_anon" on poker.lobby_seats;
drop policy if exists "hands_rw_anon" on poker.hands;

-- Helpers run as the migration owner so policy checks do not recurse through
-- lobby_seats/lobbies RLS.
create or replace function poker.is_lobby_member(target_lobby uuid)
returns boolean
language sql
stable
security definer
set search_path = poker, public
as $$
  select exists (
    select 1 from poker.lobby_seats s
    where s.lobby_id = target_lobby
      and s.player_id = auth.uid()
      and not s.is_bot
  );
$$;

create or replace function poker.is_lobby_host(target_lobby uuid)
returns boolean
language sql
stable
security definer
set search_path = poker, public
as $$
  select exists (
    select 1 from poker.lobbies l
    where l.id = target_lobby and l.host_id = auth.uid()
  );
$$;

-- Replace any previous secure-policy names so this migration is safe to rerun.
drop policy if exists players_self_select on poker.players;
drop policy if exists players_self_insert on poker.players;
drop policy if exists players_self_update on poker.players;
drop policy if exists lobbies_member_select on poker.lobbies;
drop policy if exists lobbies_host_insert on poker.lobbies;
drop policy if exists lobbies_host_update on poker.lobbies;
drop policy if exists lobbies_host_delete on poker.lobbies;
drop policy if exists seats_member_select on poker.lobby_seats;
drop policy if exists hands_host_all on poker.hands;
drop policy if exists hand_public_member_select on poker.hand_public;
drop policy if exists hand_public_host_insert on poker.hand_public;
drop policy if exists hand_public_host_update on poker.hand_public;
drop policy if exists hole_cards_private_select on poker.hole_cards;
drop policy if exists hole_cards_host_insert on poker.hole_cards;
drop policy if exists hole_cards_host_update on poker.hole_cards;
drop policy if exists action_request_own_insert on poker.action_requests;
drop policy if exists action_request_host_select on poker.action_requests;
drop policy if exists action_request_host_delete on poker.action_requests;

create policy players_self_select on poker.players
  for select to authenticated using (id = auth.uid());
create policy players_self_insert on poker.players
  for insert to authenticated with check (id = auth.uid());
create policy players_self_update on poker.players
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy lobbies_member_select on poker.lobbies
  for select to authenticated
  using (host_id = auth.uid() or poker.is_lobby_member(id));
create policy lobbies_host_insert on poker.lobbies
  for insert to authenticated with check (host_id = auth.uid());
create policy lobbies_host_update on poker.lobbies
  for update to authenticated
  using (poker.is_lobby_host(id)) with check (host_id = auth.uid());
create policy lobbies_host_delete on poker.lobbies
  for delete to authenticated using (poker.is_lobby_host(id));

create policy seats_member_select on poker.lobby_seats
  for select to authenticated
  using (poker.is_lobby_member(lobby_id) or poker.is_lobby_host(lobby_id));

create policy hands_host_all on poker.hands
  for all to authenticated
  using (poker.is_lobby_host(lobby_id))
  with check (poker.is_lobby_host(lobby_id));

create policy hand_public_member_select on poker.hand_public
  for select to authenticated
  using (poker.is_lobby_member(lobby_id) or poker.is_lobby_host(lobby_id));
create policy hand_public_host_insert on poker.hand_public
  for insert to authenticated with check (poker.is_lobby_host(lobby_id));
create policy hand_public_host_update on poker.hand_public
  for update to authenticated
  using (poker.is_lobby_host(lobby_id)) with check (poker.is_lobby_host(lobby_id));

create policy hole_cards_private_select on poker.hole_cards
  for select to authenticated
  using (player_id = auth.uid() or poker.is_lobby_host(lobby_id));
create policy hole_cards_host_insert on poker.hole_cards
  for insert to authenticated with check (poker.is_lobby_host(lobby_id));
create policy hole_cards_host_update on poker.hole_cards
  for update to authenticated
  using (poker.is_lobby_host(lobby_id)) with check (poker.is_lobby_host(lobby_id));

create policy action_request_own_insert on poker.action_requests
  for insert to authenticated
  with check (player_id = auth.uid() and poker.is_lobby_member(lobby_id));
create policy action_request_host_select on poker.action_requests
  for select to authenticated using (poker.is_lobby_host(lobby_id));
create policy action_request_host_delete on poker.action_requests
  for delete to authenticated using (poker.is_lobby_host(lobby_id));

-- Public API is RPC-driven for membership mutations. Direct anonymous table access
-- now fails RLS even though migration 001 granted table privileges.
revoke execute on function poker.is_lobby_member(uuid) from public, anon;
revoke execute on function poker.is_lobby_host(uuid) from public, anon;
grant execute on function poker.is_lobby_member(uuid) to authenticated;
grant execute on function poker.is_lobby_host(uuid) to authenticated;

create or replace function poker.create_lobby(
  p_code text,
  p_max_seats int,
  p_small_blind int,
  p_big_blind int,
  p_buy_in int,
  p_fill_with_bots boolean,
  p_display_name text
)
returns table(lobby_id uuid, seat_index int, host_id uuid, lobby_code text)
language plpgsql
security definer
set search_path = poker, public
as $$
declare
  uid uuid := auth.uid();
  new_lobby poker.lobbies%rowtype;
  clean_name text := left(coalesce(nullif(trim(p_display_name), ''), 'Player'), 20);
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if char_length(upper(trim(p_code))) <> 6 then raise exception 'Lobby code must be 6 characters'; end if;

  insert into poker.players(id, display_name)
  values(uid, clean_name)
  on conflict(id) do update set display_name = excluded.display_name;

  insert into poker.lobbies(code, host_id, status, max_seats, small_blind, big_blind, buy_in, fill_with_bots)
  values(
    upper(trim(p_code)), uid, 'waiting',
    least(9, greatest(2, p_max_seats)),
    least(greatest(0, p_small_blind), greatest(0, p_big_blind)),
    greatest(0, p_big_blind),
    greatest(1, p_buy_in),
    coalesce(p_fill_with_bots, true)
  )
  returning * into new_lobby;

  insert into poker.lobby_seats(lobby_id, seat_index, player_id, is_bot, stack, sitting_out, display_name, ready, last_seen)
  values(new_lobby.id, 0, uid, false, new_lobby.buy_in, false, clean_name, true, now());

  return query select new_lobby.id, 0, uid, new_lobby.code;
end;
$$;

create or replace function poker.join_lobby(p_code text, p_display_name text)
returns table(lobby_id uuid, seat_index int, host_id uuid, lobby_code text)
language plpgsql
security definer
set search_path = poker, public
as $$
declare
  uid uuid := auth.uid();
  target poker.lobbies%rowtype;
  chosen_seat int;
  clean_name text := left(coalesce(nullif(trim(p_display_name), ''), 'Player'), 20);
begin
  if uid is null then raise exception 'Authentication required'; end if;

  select * into target
  from poker.lobbies
  where code = upper(trim(p_code)) and status = 'waiting'
  for update;
  if not found then raise exception 'Lobby not found or already started'; end if;

  insert into poker.players(id, display_name)
  values(uid, clean_name)
  on conflict(id) do update set display_name = excluded.display_name;

  select s.seat_index into chosen_seat
  from poker.lobby_seats s
  where s.lobby_id = target.id and s.player_id = uid and not s.is_bot
  limit 1;

  if chosen_seat is null then
    select gs into chosen_seat
    from generate_series(0, target.max_seats - 1) gs
    where not exists (
      select 1 from poker.lobby_seats s
      where s.lobby_id = target.id and s.seat_index = gs
    )
    order by gs
    limit 1;
  end if;

  if chosen_seat is null then raise exception 'Lobby is full'; end if;

  insert into poker.lobby_seats(lobby_id, seat_index, player_id, is_bot, stack, sitting_out, display_name, ready, last_seen)
  values(target.id, chosen_seat, uid, false, target.buy_in, false, clean_name, false, now())
  on conflict(lobby_id, seat_index) do update
    set player_id = excluded.player_id,
        is_bot = false,
        stack = excluded.stack,
        sitting_out = false,
        display_name = excluded.display_name,
        ready = false,
        last_seen = now();

  return query select target.id, chosen_seat, target.host_id, target.code;
end;
$$;

create or replace function poker.set_lobby_ready(p_lobby_id uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = poker, public
as $$
begin
  update poker.lobby_seats s
  set ready = coalesce(p_ready, false), last_seen = now()
  where s.lobby_id = p_lobby_id
    and s.player_id = auth.uid()
    and not s.is_bot
    and exists (select 1 from poker.lobbies l where l.id = p_lobby_id and l.status = 'waiting');
  if not found then raise exception 'Seat not found or lobby already started'; end if;
end;
$$;

create or replace function poker.touch_lobby(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = poker, public
as $$
begin
  update poker.lobby_seats
  set last_seen = now()
  where lobby_id = p_lobby_id and player_id = auth.uid() and not is_bot;
end;
$$;

create or replace function poker.leave_lobby(p_lobby_id uuid)
returns uuid
language plpgsql
security definer
set search_path = poker, public
as $$
declare
  uid uuid := auth.uid();
  old_host uuid;
  new_host uuid;
begin
  select host_id into old_host from poker.lobbies where id = p_lobby_id for update;
  delete from poker.lobby_seats where lobby_id = p_lobby_id and player_id = uid and not is_bot;

  if old_host = uid then
    select player_id into new_host
    from poker.lobby_seats
    where lobby_id = p_lobby_id and not is_bot and player_id is not null
    order by seat_index limit 1;

    if new_host is null then
      delete from poker.lobbies where id = p_lobby_id;
      return null;
    end if;
    update poker.lobbies set host_id = new_host where id = p_lobby_id;
  else
    new_host := old_host;
  end if;
  return new_host;
end;
$$;

create or replace function poker.kick_lobby_player(p_lobby_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = poker, public
as $$
begin
  if not poker.is_lobby_host(p_lobby_id) then raise exception 'Host only'; end if;
  if p_player_id = auth.uid() then raise exception 'Use leave lobby instead'; end if;
  if not exists (select 1 from poker.lobbies where id = p_lobby_id and status = 'waiting') then
    raise exception 'Players can only be kicked before the game starts';
  end if;
  delete from poker.lobby_seats
  where lobby_id = p_lobby_id and player_id = p_player_id and not is_bot;
end;
$$;

create or replace function poker.start_lobby(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = poker, public
as $$
declare
  target poker.lobbies%rowtype;
  human_count int;
begin
  if not poker.is_lobby_host(p_lobby_id) then raise exception 'Host only'; end if;
  select * into target from poker.lobbies where id = p_lobby_id for update;
  if target.status <> 'waiting' then raise exception 'Lobby already started'; end if;

  if exists (
    select 1 from poker.lobby_seats
    where lobby_id = p_lobby_id and not is_bot and player_id <> auth.uid() and not ready
  ) then raise exception 'Everyone must be ready'; end if;

  select count(*) into human_count from poker.lobby_seats
  where lobby_id = p_lobby_id and not is_bot and player_id is not null;
  if human_count < 2 and not target.fill_with_bots then
    raise exception 'Need at least two players when bot fill is off';
  end if;

  update poker.lobbies set status = 'playing' where id = p_lobby_id;
end;
$$;

create or replace function poker.claim_lobby_host(p_lobby_id uuid)
returns boolean
language plpgsql
security definer
set search_path = poker, public
as $$
declare
  target poker.lobbies%rowtype;
  host_seen timestamptz;
  candidate uuid;
begin
  if not poker.is_lobby_member(p_lobby_id) then return false; end if;
  select * into target from poker.lobbies where id = p_lobby_id for update;
  if target.host_id = auth.uid() then return true; end if;

  select last_seen into host_seen from poker.lobby_seats
  where lobby_id = p_lobby_id and player_id = target.host_id and not is_bot;
  if host_seen is not null and host_seen > now() - interval '45 seconds' then return false; end if;

  select player_id into candidate
  from poker.lobby_seats
  where lobby_id = p_lobby_id
    and not is_bot
    and player_id is not null
    and last_seen > now() - interval '60 seconds'
  order by seat_index
  limit 1;

  if candidate = auth.uid() then
    update poker.lobbies set host_id = candidate where id = p_lobby_id;
    return true;
  end if;
  return false;
end;
$$;

revoke execute on function poker.create_lobby(text,int,int,int,int,boolean,text) from public, anon;
revoke execute on function poker.join_lobby(text,text) from public, anon;
revoke execute on function poker.set_lobby_ready(uuid,boolean) from public, anon;
revoke execute on function poker.touch_lobby(uuid) from public, anon;
revoke execute on function poker.leave_lobby(uuid) from public, anon;
revoke execute on function poker.kick_lobby_player(uuid,uuid) from public, anon;
revoke execute on function poker.start_lobby(uuid) from public, anon;
revoke execute on function poker.claim_lobby_host(uuid) from public, anon;

grant execute on function poker.create_lobby(text,int,int,int,int,boolean,text) to authenticated;
grant execute on function poker.join_lobby(text,text) to authenticated;
grant execute on function poker.set_lobby_ready(uuid,boolean) to authenticated;
grant execute on function poker.touch_lobby(uuid) to authenticated;
grant execute on function poker.leave_lobby(uuid) to authenticated;
grant execute on function poker.kick_lobby_player(uuid,uuid) to authenticated;
grant execute on function poker.start_lobby(uuid) to authenticated;
grant execute on function poker.claim_lobby_host(uuid) to authenticated;

-- Postgres Changes drives lobby membership, public game state, and action requests.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='poker' and tablename='lobbies') then
      alter publication supabase_realtime add table poker.lobbies;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='poker' and tablename='lobby_seats') then
      alter publication supabase_realtime add table poker.lobby_seats;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='poker' and tablename='hand_public') then
      alter publication supabase_realtime add table poker.hand_public;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='poker' and tablename='hole_cards') then
      alter publication supabase_realtime add table poker.hole_cards;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='poker' and tablename='action_requests') then
      alter publication supabase_realtime add table poker.action_requests;
    end if;
  end if;
end $$;
