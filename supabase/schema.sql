-- Hagen Score realtime database
-- Run this entire file in Supabase Dashboard > SQL Editor.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code = upper(code) and code ~ '^[A-Z0-9-]{3,20}$'),
  name text not null default '陀螺 Fun Day',
  school_name text not null default '香港佛教劉金龍中學',
  active_round integer not null default 0 check (active_round between 0 and 8),
  round_count integer not null default 9,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Password hashes are deliberately isolated from the API-facing events table.
create table if not exists public.event_secrets (
  event_id uuid primary key references public.events(id) on delete cascade,
  helper_password_hash text not null
);

create table if not exists public.event_members (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'helper' check (role in ('owner', 'helper')),
  joined_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.endurance_entries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  category text not null check (category in ('electric', 'manual')),
  name text not null,
  position integer not null default 0,
  elapsed_ms bigint not null default 0 check (elapsed_ms >= 0),
  started_at timestamptz,
  status text not null default 'idle' check (status in ('idle', 'running', 'done')),
  archived boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists endurance_entries_event_category_idx
  on public.endurance_entries(event_id, category, position);

create table if not exists public.battle_teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  team_number integer not null check (team_number between 1 and 13),
  name text not null,
  updated_at timestamptz not null default now(),
  unique (event_id, team_number)
);

create table if not exists public.battle_matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  category text not null default 'electric' check (category in ('electric', 'manual')),
  round_number integer not null check (round_number between 0 and 8),
  match_number integer not null check (match_number between 0 and 5),
  team_a_id uuid not null references public.battle_teams(id) on delete cascade,
  team_b_id uuid not null references public.battle_teams(id) on delete cascade,
  a_score integer not null default 0 check (a_score between 0 and 2),
  b_score integer not null default 0 check (b_score between 0 and 2),
  complete boolean not null default false,
  timer_elapsed_ms bigint not null default 0 check (timer_elapsed_ms >= 0),
  timer_started_at timestamptz,
  timer_running boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (event_id, category, round_number, match_number),
  check (team_a_id <> team_b_id)
);

-- Keep the script safe to re-run after upgrading an earlier version.
alter table public.endurance_entries
  add column if not exists archived boolean not null default false;
alter table public.endurance_entries
  add column if not exists battle_team_id uuid references public.battle_teams(id) on delete cascade;
alter table public.endurance_entries
  add column if not exists best_elapsed_ms bigint not null default 0;
alter table public.endurance_entries
  drop constraint if exists endurance_entries_best_elapsed_ms_check;
alter table public.endurance_entries
  add constraint endurance_entries_best_elapsed_ms_check check (best_elapsed_ms >= 0);

update public.endurance_entries
set best_elapsed_ms = elapsed_ms
where best_elapsed_ms = 0 and elapsed_ms > 0 and status = 'done';
alter table public.events
  add column if not exists round_count integer not null default 9;
alter table public.battle_matches
  add column if not exists timer_elapsed_ms bigint not null default 0;
alter table public.battle_matches
  add column if not exists timer_started_at timestamptz;
alter table public.battle_matches
  add column if not exists timer_running boolean not null default false;
alter table public.events
  add column if not exists electric_round_count integer not null default 9;
alter table public.events
  add column if not exists manual_round_count integer not null default 9;
alter table public.events
  add column if not exists electric_active_round integer not null default 0;
alter table public.events
  add column if not exists manual_active_round integer not null default 0;
alter table public.battle_matches
  add column if not exists category text;
update public.battle_matches set category = 'electric' where category is null;
alter table public.battle_matches
  alter column category set default 'electric';
update public.battle_matches set category = 'electric' where category is null;
alter table public.battle_matches
  alter column category set not null;
alter table public.battle_matches
  drop constraint if exists battle_matches_category_check;
alter table public.battle_matches
  add constraint battle_matches_category_check check (category in ('electric', 'manual'));
alter table public.battle_matches
  drop constraint if exists battle_matches_event_id_round_number_match_number_key;
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'battle_matches'
      and con.contype = 'u'
      and pg_get_constraintdef(con.oid) = 'UNIQUE (event_id, round_number, match_number)'
  loop
    execute format('alter table public.battle_matches drop constraint if exists %I', constraint_name);
  end loop;
end $$;
create unique index if not exists battle_matches_event_category_round_match_idx
  on public.battle_matches(event_id, category, round_number, match_number);

update public.events e
set
  electric_round_count = e.round_count,
  manual_round_count = e.round_count,
  electric_active_round = e.active_round
where not exists (
  select 1 from public.battle_matches m
  where m.event_id = e.id and m.category = 'manual'
);

insert into public.battle_matches (
  event_id, category, round_number, match_number, team_a_id, team_b_id
)
select event_id, 'manual', round_number, match_number, team_a_id, team_b_id
from public.battle_matches m
where m.category = 'electric'
  and not exists (
    select 1 from public.battle_matches x
    where x.event_id = m.event_id
      and x.category = 'manual'
      and x.round_number = m.round_number
      and x.match_number = m.match_number
  );

alter table public.events drop constraint if exists events_active_round_check;
alter table public.events drop constraint if exists events_active_round_dynamic_check;
alter table public.events add constraint events_active_round_dynamic_check check (active_round >= 0);
alter table public.events drop constraint if exists events_round_count_check;
alter table public.events add constraint events_round_count_check check (round_count >= 1);
alter table public.battle_teams drop constraint if exists battle_teams_team_number_check;
alter table public.battle_teams add constraint battle_teams_team_number_check check (team_number >= 1);
alter table public.battle_matches drop constraint if exists battle_matches_round_number_check;
alter table public.battle_matches add constraint battle_matches_round_number_check check (round_number >= 0);
alter table public.battle_matches drop constraint if exists battle_matches_match_number_check;
alter table public.battle_matches add constraint battle_matches_match_number_check check (match_number >= 0);

-- Link leftover endurance rows to teams by position, one row per team + category.
update public.endurance_entries e
set battle_team_id = s.team_id
from (
  select distinct on (e.event_id, e.category, t.id)
    e.id as entry_id,
    t.id as team_id
  from public.endurance_entries e
  join public.battle_teams t
    on t.event_id = e.event_id
   and t.team_number = e.position + 1
  where e.battle_team_id is null
    and not exists (
      select 1
      from public.endurance_entries existing
      where existing.event_id = e.event_id
        and existing.category = e.category
        and existing.battle_team_id = t.id
    )
  order by e.event_id, e.category, t.id, e.archived,
    greatest(e.best_elapsed_ms, e.elapsed_ms) desc, e.updated_at desc, e.id
) s
where e.id = s.entry_id;

-- A previous run can leave duplicate (event, category, team) rows, which
-- blocks the unique index. Keep the strongest record and archive the rest.
with ranked as (
  select
    id,
    row_number() over (
      partition by event_id, category, battle_team_id
      order by archived, greatest(best_elapsed_ms, elapsed_ms) desc, updated_at desc, id
    ) as rn
  from public.endurance_entries
  where battle_team_id is not null
)
update public.endurance_entries e
set archived = true,
    battle_team_id = null
from ranked
where e.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists endurance_entries_team_category_idx
  on public.endurance_entries(event_id, category, battle_team_id)
  where battle_team_id is not null;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at before update on public.events
for each row execute function public.touch_updated_at();

drop trigger if exists endurance_touch_updated_at on public.endurance_entries;
create trigger endurance_touch_updated_at before update on public.endurance_entries
for each row execute function public.touch_updated_at();

drop trigger if exists battle_teams_touch_updated_at on public.battle_teams;
create trigger battle_teams_touch_updated_at before update on public.battle_teams
for each row execute function public.touch_updated_at();

drop trigger if exists battle_matches_touch_updated_at on public.battle_matches;
create trigger battle_matches_touch_updated_at before update on public.battle_matches
for each row execute function public.touch_updated_at();

create or replace function public.is_event_member(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.event_members
    where event_id = target_event_id and user_id = auth.uid()
  );
$$;

revoke all on function public.is_event_member(uuid) from public;
grant execute on function public.is_event_member(uuid) to authenticated;

alter table public.events enable row level security;
alter table public.event_secrets enable row level security;
alter table public.event_members enable row level security;
alter table public.endurance_entries enable row level security;
alter table public.battle_teams enable row level security;
alter table public.battle_matches enable row level security;

drop policy if exists "members read events" on public.events;
create policy "members read events" on public.events for select
to authenticated using (public.is_event_member(id));

drop policy if exists "members update events" on public.events;
create policy "members update events" on public.events for update
to authenticated using (public.is_event_member(id))
with check (public.is_event_member(id));

drop policy if exists "members read memberships" on public.event_members;
create policy "members read memberships" on public.event_members for select
to authenticated using (public.is_event_member(event_id));

drop policy if exists "members manage endurance" on public.endurance_entries;
create policy "members manage endurance" on public.endurance_entries for all
to authenticated using (public.is_event_member(event_id))
with check (public.is_event_member(event_id));

drop policy if exists "members manage battle teams" on public.battle_teams;
create policy "members manage battle teams" on public.battle_teams for all
to authenticated using (public.is_event_member(event_id))
with check (public.is_event_member(event_id));

drop policy if exists "members manage battle matches" on public.battle_matches;
create policy "members manage battle matches" on public.battle_matches for all
to authenticated using (public.is_event_member(event_id))
with check (public.is_event_member(event_id));

drop function if exists public.regenerate_battle_schedule(uuid, integer);
drop function if exists public.regenerate_battle_schedule(uuid, integer, text);

create or replace function public.regenerate_battle_schedule(
  target_event_id uuid,
  requested_rounds integer default null,
  target_category text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  team_ids uuid[];
  rotation integer[];
  team_count integer;
  slot_count integer;
  maximum_rounds integer;
  actual_rounds integer;
  round_idx integer;
  pair_idx integer;
  match_idx integer;
  a integer;
  b integer;
  a_team_id uuid;
  b_team_id uuid;
  categories text[];
  current_category text;
  current_requested integer;
  electric_rounds integer;
  manual_rounds integer;
  last_rounds integer := 0;
begin
  if not public.is_event_member(target_event_id) then raise exception 'No access to this event'; end if;
  if target_category is not null and target_category not in ('electric', 'manual') then
    raise exception '無效的格鬥賽類別';
  end if;
  categories := case
    when target_category is null then array['electric', 'manual']
    else array[target_category]
  end;
  if exists (
    select 1 from public.battle_matches
    where event_id = target_event_id
      and category = any(categories)
      and (complete or a_score > 0 or b_score > 0 or timer_elapsed_ms > 0 or timer_running)
  ) then
    raise exception '已有格鬥賽紀錄，請先重設該場格鬥賽才可重排賽程';
  end if;

  select array_agg(id order by team_number) into team_ids
  from public.battle_teams where event_id = target_event_id;
  team_count := coalesce(array_length(team_ids, 1), 0);
  if team_count < 2 then raise exception '格鬥賽最少需要 2 組'; end if;

  maximum_rounds := case when team_count % 2 = 0 then team_count - 1 else team_count end;
  select electric_round_count, manual_round_count into electric_rounds, manual_rounds
  from public.events where id = target_event_id;

  foreach current_category in array categories loop
    current_requested := coalesce(
      requested_rounds,
      case when current_category = 'electric' then electric_rounds else manual_rounds end,
      9
    );
    actual_rounds := greatest(1, least(current_requested, maximum_rounds));
    rotation := array(select generate_series(1, team_count));
    if team_count % 2 = 1 then rotation := array_append(rotation, 0); end if;
    slot_count := array_length(rotation, 1);

    delete from public.battle_matches
    where event_id = target_event_id and category = current_category;
    for round_idx in 0..actual_rounds - 1 loop
      match_idx := 0;
      for pair_idx in 1..slot_count / 2 loop
        a := rotation[pair_idx];
        b := rotation[slot_count + 1 - pair_idx];
        if a > 0 and b > 0 then
          a_team_id := team_ids[case when round_idx % 2 = 0 then a else b end];
          b_team_id := team_ids[case when round_idx % 2 = 0 then b else a end];
          insert into public.battle_matches(
            event_id, category, round_number, match_number, team_a_id, team_b_id
          ) values (target_event_id, current_category, round_idx, match_idx, a_team_id, b_team_id);
          match_idx := match_idx + 1;
        end if;
      end loop;
      rotation := array[rotation[1], rotation[slot_count]] || rotation[2:slot_count - 1];
    end loop;

    if current_category = 'electric' then
      update public.events
      set
        electric_round_count = actual_rounds,
        electric_active_round = least(electric_active_round, actual_rounds - 1),
        round_count = actual_rounds,
        active_round = least(active_round, actual_rounds - 1)
      where id = target_event_id;
    else
      update public.events
      set
        manual_round_count = actual_rounds,
        manual_active_round = least(manual_active_round, actual_rounds - 1)
      where id = target_event_id;
    end if;
    last_rounds := actual_rounds;
  end loop;

  return last_rounds;
end;
$$;

create or replace function public.add_battle_team(target_event_id uuid, team_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_team_id uuid;
  next_number integer;
begin
  if not public.is_event_member(target_event_id) then raise exception 'No access to this event'; end if;
  select coalesce(max(team_number), 0) + 1 into next_number
  from public.battle_teams where event_id = target_event_id;
  insert into public.battle_teams(event_id, team_number, name)
  values (
    target_event_id,
    next_number,
    coalesce(nullif(trim(team_name), ''), '第 ' || next_number || ' 組')
  ) returning id into new_team_id;
  insert into public.endurance_entries(event_id, battle_team_id, category, name, position)
  values
    (target_event_id, new_team_id, 'electric', coalesce(nullif(trim(team_name), ''), '第 ' || next_number || ' 組'), next_number - 1),
    (target_event_id, new_team_id, 'manual', coalesce(nullif(trim(team_name), ''), '第 ' || next_number || ' 組'), next_number - 1);
  perform public.regenerate_battle_schedule(target_event_id, null, null);
  return new_team_id;
end;
$$;

create or replace function public.delete_battle_team(target_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event_id uuid;
  existing_count integer;
begin
  select event_id into target_event_id from public.battle_teams where id = target_team_id;
  if target_event_id is null or not public.is_event_member(target_event_id) then raise exception 'No access to this team'; end if;
  if exists (
    select 1 from public.battle_matches
    where event_id = target_event_id
      and (complete or a_score > 0 or b_score > 0 or timer_elapsed_ms > 0 or timer_running)
  ) then
    raise exception '已有格鬥賽紀錄，請先重設格鬥賽才可刪除組別';
  end if;
  select count(*) into existing_count
  from public.battle_teams
  where event_id = target_event_id;
  if existing_count <= 2 then raise exception '格鬥賽最少需要 2 組'; end if;
  delete from public.battle_teams where id = target_team_id;
  perform public.regenerate_battle_schedule(target_event_id, null, null);
end;
$$;

-- Creates one event and seeds both endurance rosters plus the initial battle schedule.
create or replace function public.create_event(
  event_code text,
  helper_password text,
  event_name text default '陀螺 Fun Day',
  school text default '香港佛教劉金龍中學'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_event_id uuid;
  new_team_id uuid;
  normalized_code text := upper(trim(event_code));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if normalized_code !~ '^[A-Z0-9-]{3,20}$' then raise exception '活動代碼須為 3–20 個英文字母、數字或連字號'; end if;
  if length(helper_password) < 4 then raise exception 'Helper 密碼最少 4 個字元'; end if;

  insert into public.events(code, name, school_name, created_by)
  values (normalized_code, coalesce(nullif(trim(event_name), ''), '陀螺 Fun Day'),
          coalesce(nullif(trim(school), ''), '香港佛教劉金龍中學'), auth.uid())
  returning id into new_event_id;

  insert into public.event_secrets(event_id, helper_password_hash)
  values (new_event_id, extensions.crypt(helper_password, extensions.gen_salt('bf')));

  insert into public.event_members(event_id, user_id, role)
  values (new_event_id, auth.uid(), 'owner');

  for i in 1..13 loop
    insert into public.battle_teams(event_id, team_number, name)
    values (new_event_id, i, '第 ' || i || ' 組')
    returning id into new_team_id;

    insert into public.endurance_entries(event_id, battle_team_id, category, name, position)
    values
      (new_event_id, new_team_id, 'electric', '第 ' || i || ' 組', i - 1),
      (new_event_id, new_team_id, 'manual', '第 ' || i || ' 組', i - 1);
  end loop;

  perform public.regenerate_battle_schedule(new_event_id, 9);

  return new_event_id;
end;
$$;

-- Verifies the shared password without exposing its hash, then grants this anonymous user access.
create or replace function public.join_event(event_code text, helper_password text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_event_id uuid;
  stored_hash text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select e.id, s.helper_password_hash into found_event_id, stored_hash
  from public.events e
  join public.event_secrets s on s.event_id = e.id
  where e.code = upper(trim(event_code));

  if found_event_id is null or extensions.crypt(helper_password, stored_hash) <> stored_hash then
    raise exception '活動代碼或 Helper 密碼不正確';
  end if;

  insert into public.event_members(event_id, user_id, role)
  values (found_event_id, auth.uid(), 'helper')
  on conflict (event_id, user_id) do nothing;

  return found_event_id;
end;
$$;

create or replace function public.start_endurance(entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.endurance_entries
  set started_at = now(), status = 'running', elapsed_ms = 0
  where id = entry_id
    and status <> 'running'
    and public.is_event_member(event_id);
  if found then return; end if;
  if exists (
    select 1 from public.endurance_entries
    where id = entry_id
      and status = 'running'
      and public.is_event_member(event_id)
  ) then
    return;
  end if;
  raise exception 'Unable to start timer';
end;
$$;

create or replace function public.finish_endurance(entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_ms bigint;
begin
  update public.endurance_entries
  set elapsed_ms = elapsed_ms + greatest(0, floor(extract(epoch from (now() - started_at)) * 1000))::bigint,
      started_at = null,
      status = 'done'
  where id = entry_id
    and status = 'running'
    and public.is_event_member(event_id)
  returning elapsed_ms into attempt_ms;
  if not found then raise exception 'Timer is not running'; end if;

  update public.endurance_entries
  set best_elapsed_ms = attempt_ms
  where id = entry_id
    and attempt_ms > best_elapsed_ms
    and public.is_event_member(event_id);
end;
$$;

create or replace function public.reset_endurance(entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.endurance_entries
  set elapsed_ms = 0, started_at = null, status = 'idle'
  where id = entry_id and public.is_event_member(event_id);
  if not found then raise exception 'Unable to reset timer'; end if;
end;
$$;

create or replace function public.start_battle_timer(match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.battle_matches
  set timer_started_at = now(), timer_running = true
  where id = match_id
    and not timer_running
    and public.is_event_member(event_id);
  if not found then raise exception 'Unable to start match timer'; end if;
end;
$$;

create or replace function public.pause_battle_timer(match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.battle_matches
  set timer_elapsed_ms = least(
        120000,
        timer_elapsed_ms + greatest(0, floor(extract(epoch from (now() - timer_started_at)) * 1000))::bigint
      ),
      timer_started_at = null,
      timer_running = false
  where id = match_id
    and timer_running
    and public.is_event_member(event_id);
  if not found then raise exception 'Match timer is not running'; end if;
end;
$$;

revoke all on function public.create_event(text, text, text, text) from public;
revoke all on function public.join_event(text, text) from public;
revoke all on function public.regenerate_battle_schedule(uuid, integer, text) from public;
revoke all on function public.add_battle_team(uuid, text) from public;
revoke all on function public.delete_battle_team(uuid) from public;
revoke all on function public.start_endurance(uuid) from public;
revoke all on function public.finish_endurance(uuid) from public;
revoke all on function public.reset_endurance(uuid) from public;
revoke all on function public.start_battle_timer(uuid) from public;
revoke all on function public.pause_battle_timer(uuid) from public;
grant execute on function public.create_event(text, text, text, text) to authenticated;
grant execute on function public.join_event(text, text) to authenticated;
grant execute on function public.regenerate_battle_schedule(uuid, integer, text) to authenticated;
grant execute on function public.add_battle_team(uuid, text) to authenticated;
grant execute on function public.delete_battle_team(uuid) to authenticated;
grant execute on function public.start_endurance(uuid) to authenticated;
grant execute on function public.finish_endurance(uuid) to authenticated;
grant execute on function public.reset_endurance(uuid) to authenticated;
grant execute on function public.start_battle_timer(uuid) to authenticated;
grant execute on function public.pause_battle_timer(uuid) to authenticated;

grant select on public.events to authenticated;
grant update (name, school_name, active_round, round_count, electric_round_count, manual_round_count, electric_active_round, manual_active_round) on public.events to authenticated;
grant select on public.event_members to authenticated;
grant select, insert, update, delete on public.endurance_entries to authenticated;
grant select, insert, update, delete on public.battle_teams to authenticated;
grant select, insert, update, delete on public.battle_matches to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events'
  ) then alter publication supabase_realtime add table public.events; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'endurance_entries'
  ) then alter publication supabase_realtime add table public.endurance_entries; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'battle_teams'
  ) then alter publication supabase_realtime add table public.battle_teams; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'battle_matches'
  ) then alter publication supabase_realtime add table public.battle_matches; end if;
end $$;
